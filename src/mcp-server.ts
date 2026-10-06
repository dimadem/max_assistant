import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callBridge } from "./bridge-client.ts";
import { layout, originBelow } from "./layout.ts";
import { buildIndex, type ObjectEntry, searchIndex } from "./object-index.ts";
import { parseObjectText } from "./parse-object-text.ts";
import { checkPatch } from "./patch-checks.ts";
import {
	convertMaxpat,
	type PatchContext,
	type RawMaxpat,
} from "./types/max.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE_INFO = join(PROJECT_ROOT, ".bridge.json");

const MAX_REFPAGES =
	"/Applications/Max.app/Contents/Resources/C74/docs/refpages";

const MAX_APP_HELP = "/Applications/Max.app/Contents/Resources/C74/help";
const MAX_USER_ROOTS = [
	join(homedir(), "Documents/Max 9/Library"),
	join(homedir(), "Documents/Max 9/Packages"),
	"/Users/Shared/Max 9/Packages",
];

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

const INSTRUCTIONS = [
	"Tools for building and inspecting Max/MSP patches in a running Max instance.",
	"Workflow: get_patch_context first (it tells you which patch window you are editing, field `patch`).",
	"If you don't know an object's name, use search_objects; then confirm inlets/outlets, modes, attributes and arguments with get_object_docs (and get_object_help for a working example). Never guess numeric modes or attribute names.",
	"Prefer create_patch_fragment to build several objects and their patchcords in one call; omit x/y to get an automatic top-to-bottom layout below existing objects.",
	"Object ids: use the ids returned by tools (varnames or stable obj-<n> ids). Inlets/outlets are 0-indexed from the left.",
	"Read the `warnings` in every result (signal feedback loops, invalid objects) and fix them before reporting success. You cannot hear the patch: tell the user how to test it (e.g. turn on ezdac~).",
	"Max conventions: signal objects end with ~; *~ / +~ need a signal in the left inlet; ezdac~/dac~ inlets are left/right channels.",
].join("\n");

const server = new McpServer(
	{ name: "max-msp", version: "2.0.0" },
	{ instructions: INSTRUCTIONS },
);

type Ctx = PatchContext;

function text(value: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
			},
		],
	};
}

async function liveContext(): Promise<{ ctx?: Ctx; error?: string; note?: string }> {
	const r = await callBridge(BRIDGE_INFO, "get_context");
	if (!r.ok) return { error: r.error };
	return { ctx: r.context as Ctx, note: r.note as string | undefined };
}

// Run a mutating bridge command and return its result + patch warnings,
// without dumping the whole context back to the model.
async function mutate(type: string, params: Record<string, unknown>) {
	const { context, ...result } = await callBridge(BRIDGE_INFO, type, params);
	const warnings = context ? checkPatch(context as Ctx) : [];
	return text(warnings.length ? { ...result, warnings } : result);
}

server.tool(
	"get_patch_context",
	"Get the live Max patch being edited: `patch` (window title), all objects (boxes: id, maxclass, text, rect, numinlets, numoutlets) and connections (lines: [boxIndex, port] pairs). Includes `warnings` about broken objects or signal loops. Call this first.",
	{},
	async () => {
		const { ctx, error, note } = await liveContext();
		if (!ctx) return text({ ok: false, error });
		const warnings = checkPatch(ctx);
		return text({ ...ctx, ...(note ? { note } : {}), ...(warnings.length ? { warnings } : {}) });
	},
);
server.tool(
	"get_object_connections",
	"Get all inputs and outputs for a single object, identified by its id from get_patch_context.",
	{
		id: z.string().describe("Object id from get_patch_context"),
	},
	async ({ id }) => {
		const { ctx, error } = await liveContext();
		if (!ctx) return text({ ok: false, error });
		const idx = ctx.boxes.findIndex((b) => b.id === id);
		const obj = ctx.boxes[idx];
		if (!obj) return text(`Object "${id}" not found`);
		const inputs = ctx.lines
			.filter((l) => l.dst[0] === idx)
			.map((l) => ({ fromObject: ctx.boxes[l.src[0]]?.id, fromOutlet: l.src[1], toInlet: l.dst[1] }));
		const outputs = ctx.lines
			.filter((l) => l.src[0] === idx)
			.map((l) => ({ toObject: ctx.boxes[l.dst[0]]?.id, fromOutlet: l.src[1], toInlet: l.dst[1] }));
		return text({ object: { id: obj.id, type: obj.maxclass, text: obj.text }, inputs, outputs });
	},
);

let objectIndex: ObjectEntry[] | null = null;

server.tool(
	"search_objects",
	"Search ALL Max/MSP/Jitter objects by what they do. Use this when you don't know the exact object name (e.g. 'delay line', 'random number', 'midi note in', 'lowpass filter'). Returns name, category, short description and related objects. Then use get_object_docs / get_object_help on the best candidates.",
	{
		query: z.string().describe("English keywords describing the needed functionality"),
		limit: z.number().optional().describe("Max results, default 15"),
	},
	async ({ query, limit }) => {
		objectIndex ??= buildIndex(MAX_REFPAGES);
		if (objectIndex.length === 0) {
			return {
				content: [{ type: "text", text: `Reference pages not found at ${MAX_REFPAGES}` }],
			};
		}
		const hits = searchIndex(objectIndex, query, limit ?? 15).map((e) => ({
			name: e.name,
			category: e.category,
			digest: e.digest,
			seealso: e.seealso.slice(0, 5),
		}));
		return {
			content: [
				{
					type: "text",
					text: hits.length ? JSON.stringify(hits, null, 2) : `No objects matched "${query}"`,
				},
			],
		};
	},
);

server.tool(
	"get_object_docs",
	"Get Max MSP reference documentation for an object type: description, inlets, outlets, messages, attributes. Use to understand what an object does and what data it accepts.",
	{
		maxclass: z
			.string()
			.describe("Object type, e.g. 'cycle~', 'button', 'route', 'prepend'"),
	},
	async ({ maxclass }) => {
		const dirs = ["max-ref", "msp-ref", "jit-ref", "m4l-ref"];
		let xml: string | null = null;
		for (const dir of dirs) {
			const p = join(MAX_REFPAGES, dir, `${maxclass}.maxref.xml`);
			if (existsSync(p)) {
				xml = readFileSync(p, "utf-8");
				break;
			}
		}
		if (!xml) {
			return {
				content: [
					{ type: "text", text: `No reference found for "${maxclass}"` },
				],
			};
		}
		return {
			content: [{ type: "text", text: xml }],
		};
	},
);

server.tool(
	"create_object",
	"Create one Max object. `text` is the full box text (e.g. 'cycle~ 440', 'button', 'message foo bar'). Returns its id. For several objects use create_patch_fragment.",
	{
		text: z.string().describe("Full box text, e.g. 'cycle~ 440'"),
		x: z.number().describe("X in pixels (top-left)"),
		y: z.number().describe("Y in pixels (top-left)"),
		varname: z.string().optional().describe("Optional unique name, becomes the object's id"),
	},
	async ({ text: boxText, x, y, varname }) => {
		const { classname, args } = parseObjectText(boxText);
		if (!classname) return text({ ok: false, error: "empty text" });
		return mutate("create_object", { classname, args, x, y, varname });
	},
);

server.tool(
	"create_patch_fragment",
	"Create several objects and patchcords in ONE call. Give each object a short local `name` (used in `connections` and as its id). Connections may also reference existing object ids. Omit x/y for automatic layout (top-to-bottom by signal flow, below existing objects). Returns created ids, errors and patch warnings.",
	{
		objects: z
			.array(
				z.object({
					name: z.string().describe("Local name, e.g. 'osc' — becomes the object's id"),
					text: z.string().describe("Full box text, e.g. 'cycle~ 440'"),
					x: z.number().optional(),
					y: z.number().optional(),
				}),
			)
			.min(1),
		connections: z
			.array(
				z.object({
					from: z.string().describe("Local name or existing id"),
					outlet: z.number().int().nonnegative(),
					to: z.string().describe("Local name or existing id"),
					inlet: z.number().int().nonnegative(),
				}),
			)
			.default([]),
	},
	async ({ objects, connections }) => {
		const { ctx } = await liveContext();
		const origin = originBelow(ctx ?? { boxes: [], lines: [] });
		const placed = layout(objects, connections, origin).map((o) => ({
			name: o.name,
			x: o.x,
			y: o.y,
			...parseObjectText(o.text),
		}));
		return mutate("create_fragment", { objects: placed, connections });
	},
);

server.tool(
	"connect_objects",
	"Connect two existing objects with a patchcord. Ids from get_patch_context; outlets/inlets 0-indexed from the left.",
	{
		srcId: z.string(),
		srcOutlet: z.number().int().nonnegative(),
		dstId: z.string(),
		dstInlet: z.number().int().nonnegative(),
	},
	async (params) => mutate("connect_objects", params),
);

server.tool(
	"delete_object",
	"Delete an object (and its patchcords) by id from get_patch_context.",
	{ id: z.string() },
	async (params) => mutate("delete_object", params),
);

server.tool(
	"get_object_help",
	"Get the help patch (.maxhelp) for a Max MSP object: a working example patch showing how the object is used. Returns normalized { boxes, lines } in the same shape as get_patch_context, plus the source path. Use after get_object_docs when you want a concrete usage example.",
	{
		maxclass: z
			.string()
			.describe("Object type, e.g. 'cycle~', 'button', 'route'"),
	},
	async ({ maxclass }) => {
		const path = findHelpPatch(maxclass);
		if (!path) {
			return {
				content: [
					{ type: "text", text: `No help patch found for "${maxclass}"` },
				],
			};
		}
		let raw: RawMaxpat;
		try {
			raw = JSON.parse(readFileSync(path, "utf-8"));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Failed to parse ${path}: ${msg}` }],
			};
		}
		const ctx = convertMaxpat(raw);
		return {
			content: [
				{ type: "text", text: JSON.stringify({ path, ...ctx }, null, 2) },
			],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
