import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PatchContext } from "./types/max.ts";

const CONTEXT_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"patch-context.json",
);

const MAX_REFPAGES =
	"/Applications/Max.app/Contents/Resources/C74/docs/refpages";

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
	"get_connections",
	"Get all inputs and outputs for a specific object by its id (from get_patch_context).",
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

const transport = new StdioServerTransport();
await server.connect(transport);
