import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { convertMaxpat, type PatchContext, type RawMaxpat } from "./types/max.ts";

const CONTEXT_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"patch-context.json",
);

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

function loadContext(): PatchContext {
	try {
		const raw = readFileSync(CONTEXT_FILE, "utf-8");
		return JSON.parse(raw);
	} catch {
		return { boxes: [], lines: [] };
	}
}

const server = new McpServer({
	name: "max-msp",
	version: "1.0.0",
});

server.tool(
	"get_patch_context",
	"Get the full Max MSP patch context: all objects (boxes) and connections (lines). Use first to understand the overall structure.",
	{},
	async () => {
		const ctx = loadContext();
		return {
			content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
		};
	},
);

server.tool(
	"get_object_connections",
	"Get all inputs and outputs for a single object, identified by its id from get_patch_context.",
	{
		id: z.string().describe("Object varname/id from get_patch_context"),
	},
	async ({ id }) => {
		const ctx = loadContext();
		const objIndex = ctx.boxes.findIndex((b) => b.id === id);
		if (objIndex === -1) {
			return {
				content: [{ type: "text", text: `Object "${id}" not found` }],
			};
		}
		const obj = ctx.boxes[objIndex];
		if (!obj) {
			return { content: [{ type: "text", text: `Object "${id}" not found` }] };
		}
		const inputs = ctx.lines
			.filter((l) => l.dst[0] === objIndex)
			.map((l) => ({
				fromObject: ctx.boxes[l.src[0]]?.id,
				fromOutlet: l.src[1],
				toInlet: l.dst[1],
			}));
		const outputs = ctx.lines
			.filter((l) => l.src[0] === objIndex)
			.map((l) => ({
				toObject: ctx.boxes[l.dst[0]]?.id,
				fromOutlet: l.src[1],
				toInlet: l.dst[1],
			}));
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							object: { id: obj.id, type: obj.maxclass, text: obj.text },
							inputs,
							outputs,
						},
						null,
						2,
					),
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
				content: [
					{ type: "text", text: `Failed to parse ${path}: ${msg}` },
				],
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
