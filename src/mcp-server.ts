/**
 * MCP server for building Max/MSP patches (SDK v2, serves 2025-11-25 and
 * 2026-07-28 clients via serveStdio).
 *
 * Tools talk to the running Max assistant through the local HTTP bridge
 * (.bridge.json). Docs tools read Max.app's reference pages and User Guide.
 * Resources: max://patch/current, max://object/{name}. Prompts: build_patch,
 * explain_patch, debug_patch.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CallToolResult, McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { callBridge } from "./bridge-client.ts";
import { readGuide, searchGuide } from "./guide.ts";
import { layout, originBelow } from "./layout.ts";
import {
	buildIndex,
	type ObjectEntry,
	refpageItem,
	searchIndex,
	summarizeRefpage,
} from "./object-index.ts";
import { toBoxSpec } from "./parse-object-text.ts";
import { checkPatch } from "./patch-checks.ts";
import { convertMaxpat, type PatchContext, type RawMaxpat } from "./types/max.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Overridable for tests so they never touch the live bridge file.
const BRIDGE_INFO = process.env.MAX_BRIDGE_INFO ?? join(PROJECT_ROOT, ".bridge.json");

const C74 = "/Applications/Max.app/Contents/Resources/C74";
const MAX_REFPAGES = `${C74}/docs/refpages`;
const USERGUIDE_DB = `${C74}/docs/userguide/userguide_search.sqlite`;
const MAX_APP_HELP = `${C74}/help`;
const MAX_USER_ROOTS = [
	join(homedir(), "Documents/Max 9/Library"),
	join(homedir(), "Documents/Max 9/Packages"),
	"/Users/Shared/Max 9/Packages",
];
const REF_DIRS = ["max-ref", "msp-ref", "jit-ref", "m4l-ref"];

function findHelpPatch(maxclass: string): string | null {
	const filename = `${maxclass}.maxhelp`;

	if (existsSync(MAX_APP_HELP)) {
		try {
			const flat = join(MAX_APP_HELP, filename);
			if (existsSync(flat)) return flat;
			for (const entry of readdirSync(MAX_APP_HELP, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const p = join(MAX_APP_HELP, entry.name, filename);
				if (existsSync(p)) return p;
			}
		} catch {}
	}

	for (const root of MAX_USER_ROOTS) {
		if (!existsSync(root)) continue;
		try {
			for (const entry of readdirSync(root, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const p = join(root, entry.name, "help", filename);
				if (existsSync(p)) return p;
			}
		} catch {}
	}

	return null;
}

function findRefpage(name: string): string | null {
	for (const dir of REF_DIRS) {
		const p = join(MAX_REFPAGES, dir, `${name}.maxref.xml`);
		if (existsSync(p)) return readFileSync(p, "utf-8");
	}
	return null;
}

let objectIndex: ObjectEntry[] | null = null;
const getIndex = () => (objectIndex ??= buildIndex(MAX_REFPAGES));

// ---------- result helpers ---------------------------------------------------

const json = (data: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(data) }],
});

const fail = (message: string, data?: Record<string, unknown>): CallToolResult => ({
	content: [{ type: "text", text: data ? JSON.stringify({ error: message, ...data }) : message }],
	isError: true,
});

// Patch for the model: connections by id (`osc:0 → gain:0`), not by index.
function present(ctx: PatchContext, opts: { rect?: boolean } = {}) {
	const id = (i: number) => ctx.boxes[i]?.id ?? `#${i}`;
	const warnings = checkPatch(ctx);
	return {
		patch: ctx.patch ?? "",
		objects: ctx.boxes.map((b) => ({
			id: b.id,
			maxclass: b.maxclass,
			text: b.text,
			...(opts.rect === false ? {} : { rect: b.rect }),
			inlets: b.numinlets,
			outlets: b.numoutlets,
		})),
		connections: ctx.lines.map((l) => ({ from: id(l.src[0]), outlet: l.src[1], to: id(l.dst[0]), inlet: l.dst[1] })),
		...(warnings.length ? { warnings } : {}),
	};
}

async function liveContext(): Promise<{ ctx?: PatchContext; error?: string; note?: string }> {
	const r = await callBridge(BRIDGE_INFO, "get_context");
	if (!r.ok) return { error: r.error };
	return { ctx: r.context as PatchContext, note: r.note as string | undefined };
}

// Mutating bridge command → its result + patch warnings (no full context dump).
async function mutate(type: string, params: Record<string, unknown>): Promise<CallToolResult> {
	const { context, ok, error, ...rest } = await callBridge(BRIDGE_INFO, type, params);
	const warnings = context ? checkPatch(context as PatchContext) : [];
	const body = { ok, ...rest, ...(warnings.length ? { warnings } : {}) };
	if (!ok) return fail(error ?? `${type} failed`, body);
	return json(body);
}

// ---------- schemas ------------------------------------------------------------

const BOX = z
	.enum(["object", "message", "comment"])
	.optional()
	.describe("object (default) | message (message box; text = content, commas allowed) | comment");
const PORT = z.number().int().nonnegative();

const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const INSTRUCTIONS = `Build and inspect Max/MSP patches in the user's running Max.

Workflow
1. get_patch_context — which patch you edit (\`patch\`), objects, connections (by id), warnings.
2. Unknown object → search_objects. How-to / idioms (line~ envelopes, poly~, pattr, MC…) → search_guide + read_guide.
3. Before using inlets, modes, attributes or arguments → get_object_docs (pass \`item\` for the full text of one message/attribute, e.g. mode lists). get_object_help shows a working example. Never guess.
4. Build with create_patch_fragment (many boxes + cords in one call; omit x/y for auto-layout below existing objects). Fix with connect/disconnect/delete.
5. Read \`warnings\` in every result (signal feedback loops, invalid objects) and fix them. You can't hear audio: tell the user how to test (e.g. turn on ezdac~).

Boxes: object text like 'cycle~ 440'; message boxes use box:'message' with the literal content ('1 10, 0 500'); comments box:'comment'. Hand-typed message boxes read back with empty text.
Ids: varnames or stable obj-<n>. Ports are 0-indexed from the left; the live patch doesn't expose port counts, so take them from get_object_docs (connect_objects verifies the cord and reports if Max refused it). Signal objects end with ~; ezdac~/dac~ inlets are left/right.`;

// ---------- server ---------------------------------------------------------------

function createServer(): McpServer {
	const server = new McpServer(
		{ name: "max-msp", title: "Max/MSP", version: "3.0.0" },
		{ instructions: INSTRUCTIONS },
	);

	// --- reading the patch ---

	server.registerTool(
		"get_patch_context",
		{
			title: "Read patch",
			description:
				"The live patch being edited: `patch` (window title), objects (id, maxclass, text, rect [x,y,w,h]), connections {from, outlet, to, inlet} and warnings. Inlet/outlet counts aren't available live — see get_object_docs. Call first.",
			inputSchema: z.object({}),
			annotations: READ,
		},
		async () => {
			const { ctx, error, note } = await liveContext();
			if (!ctx) return fail(error ?? "bridge error");
			return json({ ...present(ctx), ...(note ? { note } : {}) });
		},
	);

	server.registerTool(
		"get_object_connections",
		{
			title: "Object connections",
			description: "Inputs and outputs of one object by id.",
			inputSchema: z.object({ id: z.string().describe("Object id from get_patch_context") }),
			annotations: READ,
		},
		async ({ id }) => {
			const { ctx, error } = await liveContext();
			if (!ctx) return fail(error ?? "bridge error");
			const p = present(ctx);
			const obj = p.objects.find((o) => o.id === id);
			if (!obj) return fail(`Object "${id}" not found. Ids: ${p.objects.map((o) => o.id).join(", ")}`);
			return json({
				object: obj,
				inputs: p.connections.filter((c) => c.to === id),
				outputs: p.connections.filter((c) => c.from === id),
			});
		},
	);

	// --- documentation ---

	server.registerTool(
		"search_objects",
		{
			title: "Find objects",
			description:
				"Search all Max/MSP/Jitter objects by what they do ('delay line', 'lowpass filter', 'midi note in'). Returns name, category, digest, tags, related objects.",
			inputSchema: z.object({
				query: z.string().describe("English keywords"),
				limit: z.number().int().min(1).max(50).optional().describe("Default 12"),
			}),
			annotations: READ,
		},
		async ({ query, limit }) => {
			const index = getIndex();
			if (index.length === 0) return fail(`Reference pages not found at ${MAX_REFPAGES}`);
			const hits = searchIndex(index, query, limit ?? 12).map((e) => ({
				name: e.name,
				category: e.category,
				digest: e.digest,
				tags: e.tags.slice(0, 6),
				seealso: e.seealso.slice(0, 5),
			}));
			return hits.length ? json(hits) : fail(`No objects matched "${query}". Try other words or search_guide.`);
		},
	);

	server.registerTool(
		"get_object_docs",
		{
			title: "Object reference",
			description:
				"Reference for an object: digest, inlets, outlets, arguments, messages and attributes (one-line digests). Pass `item` (a message, attribute or argument name, e.g. 'mode') for its full description.",
			inputSchema: z.object({
				name: z.string().describe("Object name, e.g. 'cycle~', 'route', 'filtergraph~'"),
				item: z.string().optional().describe("Message/attribute/argument to expand"),
			}),
			annotations: READ,
		},
		async ({ name, item }) => {
			const xml = findRefpage(name);
			if (!xml) return fail(`No reference page for "${name}". Check the name with search_objects.`);
			if (item) {
				const text = refpageItem(xml, item);
				return text ? json({ name, item, text }) : fail(`"${name}" has no message/attribute/argument "${item}"`);
			}
			return json(summarizeRefpage(xml));
		},
	);

	server.registerTool(
		"get_object_help",
		{
			title: "Object help patch",
			description: "The object's help patch (.maxhelp) as objects + connections — a working usage example.",
			inputSchema: z.object({ name: z.string().describe("Object name, e.g. 'line~'") }),
			annotations: READ,
		},
		async ({ name }) => {
			const path = findHelpPatch(name);
			if (!path) return fail(`No help patch found for "${name}"`);
			try {
				const raw = JSON.parse(readFileSync(path, "utf-8")) as RawMaxpat;
				return json({ path, ...present(convertMaxpat(raw), { rect: false }) });
			} catch (e) {
				return fail(`Failed to read ${path}: ${e instanceof Error ? e.message : e}`);
			}
		},
	);

	server.registerTool(
		"search_guide",
		{
			title: "Search User Guide",
			description:
				"Full-text search of the Max User Guide shipped with Max (messages, MSP, polyphony, MC, gen, javascript, pattr, presets…). Returns page paths + snippets; then read_guide.",
			inputSchema: z.object({
				query: z.string().describe("English keywords, e.g. 'line~ envelope'"),
				limit: z.number().int().min(1).max(20).optional(),
			}),
			annotations: READ,
		},
		async ({ query, limit }) => {
			const hits = searchGuide(USERGUIDE_DB, query, limit ?? 8);
			if (hits === null) return fail(`User Guide database not found at ${USERGUIDE_DB}`);
			return hits.length ? json(hits) : fail(`Nothing in the User Guide matched "${query}"`);
		},
	);

	server.registerTool(
		"read_guide",
		{
			title: "Read User Guide page",
			description: "Read a User Guide page (path from search_guide). Long pages are cut to ~8000 chars around `focus`.",
			inputSchema: z.object({
				path: z.string().describe("e.g. '/messages'"),
				focus: z.string().optional().describe("Word/phrase to centre on"),
			}),
			annotations: READ,
		},
		async ({ path, focus }) => {
			const page = readGuide(USERGUIDE_DB, path, focus);
			return page ? json(page) : fail(`No User Guide page "${path}"`);
		},
	);

	// --- editing ---

	server.registerTool(
		"create_patch_fragment",
		{
			title: "Build patch fragment",
			description:
				"Create several boxes and patchcords in ONE call. Each box has a local `name` (becomes its id, usable in `connections`); connections may also use existing ids. Omit x/y for auto-layout by signal flow below existing objects.",
			inputSchema: z.object({
				objects: z
					.array(
						z.object({
							name: z.string().describe("Local name, e.g. 'osc'"),
							text: z.string().describe("Object text 'cycle~ 440', or message/comment content"),
							box: BOX,
							x: z.number().optional(),
							y: z.number().optional(),
						}),
					)
					.min(1),
				connections: z
					.array(z.object({ from: z.string(), outlet: PORT, to: z.string(), inlet: PORT }))
					.default([]),
			}),
			annotations: WRITE,
		},
		async ({ objects, connections }) => {
			const { ctx } = await liveContext();
			const origin = originBelow(ctx ?? { boxes: [], lines: [] });
			const placed = layout(objects, connections, origin).map((o) => ({
				name: o.name,
				x: o.x,
				y: o.y,
				...toBoxSpec(o.text, o.box),
			}));
			return mutate("create_fragment", { objects: placed, connections });
		},
	);

	server.registerTool(
		"create_object",
		{
			title: "Create box",
			description: "Create one box at x/y. For several boxes use create_patch_fragment.",
			inputSchema: z.object({
				text: z.string().describe("Object text 'cycle~ 440', or message/comment content"),
				box: BOX,
				x: z.number(),
				y: z.number(),
				varname: z.string().optional().describe("Unique name → the object's id"),
			}),
			annotations: WRITE,
		},
		async ({ text, box, x, y, varname }) => {
			const spec = toBoxSpec(text, box);
			if (spec.box === "object" && !spec.classname) return fail("empty text");
			return mutate("create_object", { ...spec, x, y, varname });
		},
	);

	server.registerTool(
		"connect_objects",
		{
			title: "Connect",
			description: "Add a patchcord srcId:srcOutlet → dstId:dstInlet.",
			inputSchema: z.object({ srcId: z.string(), srcOutlet: PORT, dstId: z.string(), dstInlet: PORT }),
			annotations: WRITE,
		},
		async (p) => mutate("connect_objects", p),
	);

	server.registerTool(
		"disconnect_objects",
		{
			title: "Disconnect",
			description: "Remove the patchcord srcId:srcOutlet → dstId:dstInlet (objects stay).",
			inputSchema: z.object({ srcId: z.string(), srcOutlet: PORT, dstId: z.string(), dstInlet: PORT }),
			annotations: DESTROY,
		},
		async (p) => mutate("disconnect_objects", p),
	);

	server.registerTool(
		"delete_object",
		{
			title: "Delete box",
			description: "Delete a box and its patchcords.",
			inputSchema: z.object({ id: z.string() }),
			annotations: DESTROY,
		},
		async (p) => mutate("delete_object", p),
	);

	// --- resources ---

	server.registerResource(
		"current-patch",
		"max://patch/current",
		{
			title: "Current Max patch",
			description: "Live snapshot of the patch the assistant edits",
			mimeType: "application/json",
		},
		async (uri) => {
			const { ctx, error } = await liveContext();
			return {
				contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(ctx ? present(ctx) : { error }) }],
			};
		},
	);

	server.registerResource(
		"object-reference",
		new ResourceTemplate("max://object/{name}", {
			list: undefined,
			complete: {
				name: (value) =>
					getIndex()
						.map((e) => e.name)
						.filter((n) => n.startsWith(value))
						.slice(0, 50),
			},
		}),
		{ title: "Max object reference", description: "Compact reference page of a Max object", mimeType: "application/json" },
		async (uri, { name }) => {
			const xml = findRefpage(String(name));
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(xml ? summarizeRefpage(xml) : { error: `no reference page for ${name}` }),
					},
				],
			};
		},
	);

	// --- prompts ---

	const userPrompt = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

	server.registerPrompt(
		"build_patch",
		{
			title: "Build a patch",
			description: "Build something in the current Max patch",
			argsSchema: z.object({ description: z.string().describe("What to build, e.g. 'a 3-band EQ on adc~'") }),
		},
		({ description }) =>
			userPrompt(
				`In my current Max patch, build: ${description}\n\nRead the patch first, look up every object you're unsure about (search_objects / get_object_docs / search_guide), build it with create_patch_fragment, fix all warnings, then tell me how to test it.`,
			),
	);

	server.registerPrompt(
		"explain_patch",
		{ title: "Explain this patch", description: "Explain what the current Max patch does" },
		() =>
			userPrompt(
				"Explain what my current Max patch does: signal/message flow from inputs to outputs, the role of each part, and anything that looks unfinished. Use get_patch_context and get_object_docs where needed.",
			),
	);

	server.registerPrompt(
		"debug_patch",
		{ title: "Find problems", description: "Find and fix problems in the current Max patch" },
		() =>
			userPrompt(
				"Find problems in my current Max patch: warnings, invalid objects, unconnected inlets that need input, wrong inlet usage, gain staging (e.g. a *~ multiplied by 0), missing ezdac~/dac~. List them, then fix the clear ones and ask before anything ambiguous.",
			),
	);

	return server;
}

serveStdio(createServer);
