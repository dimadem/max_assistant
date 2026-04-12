import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PatchContext } from "./types/max.ts";

const CONTEXT_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"max-patch-context.json",
);

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
	"list_objects",
	"List all objects in the Max patch, optionally filtered by type (maxclass).",
	{
		filter: z
			.string()
			.optional()
			.describe("Optional filter by maxclass, e.g. 'cycle~', 'dac~', 'slider'"),
	},
	async ({ filter }) => {
		const ctx = loadContext();
		let boxes = ctx.boxes;
		if (filter) {
			const f = filter.toLowerCase();
			boxes = boxes.filter((b) => b.maxclass.toLowerCase().includes(f));
		}
		const list = boxes.map((b) => ({
			id: b.id,
			type: b.maxclass,
			text: b.text,
		}));
		return {
			content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
		};
	},
);

server.tool(
	"find_object",
	"Search for objects by name, type, or text content.",
	{
		query: z
			.string()
			.describe("Search term to match against object id, maxclass, or text"),
	},
	async ({ query }) => {
		const ctx = loadContext();
		const q = query.toLowerCase();
		const found = ctx.boxes.filter(
			(b) =>
				b.id.toLowerCase().includes(q) ||
				b.maxclass.toLowerCase().includes(q) ||
				b.text.toLowerCase().includes(q),
		);
		if (found.length === 0) {
			return {
				content: [{ type: "text", text: `No objects matching "${query}"` }],
			};
		}
		return {
			content: [{ type: "text", text: JSON.stringify(found, null, 2) }],
		};
	},
);

server.tool(
	"get_connections",
	"Get all inputs and outputs for a specific object by its id.",
	{
		id: z
			.string()
			.describe("Object varname/id from list_objects or find_object"),
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

const transport = new StdioServerTransport();
await server.connect(transport);
