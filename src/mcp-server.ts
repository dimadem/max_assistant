import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sendCommand } from "./command-channel.ts";
import { parseObjectText } from "./parse-object-text.ts";
import type { PatchContext } from "./types/max.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT_FILE = join(PROJECT_ROOT, "patch-context.json");
const COMMANDS_FILE = join(PROJECT_ROOT, "commands.ndjson");
const RESULTS_FILE = join(PROJECT_ROOT, "command-results.ndjson");

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

server.tool(
	"create_object",
	"Create a new Max object in the patch. `text` is the full Box.text (e.g. 'cycle~ 440', 'button', 'message foo bar'). `x`/`y` are absolute pixels. Optionally pass `varname` to give the new object a specific name; otherwise an auto-generated `mcp_<n>` name is assigned. After this call, the next get_patch_context reflects the new object.",
	{
		text: z.string().describe("Full text as in Box.text, e.g. 'cycle~ 440'"),
		x: z.number().describe("X coordinate in pixels (top-left corner)"),
		y: z.number().describe("Y coordinate in pixels (top-left corner)"),
		varname: z
			.string()
			.optional()
			.describe(
				"Optional varname for the new object. Must be unique in the patch.",
			),
	},
	async ({ text, x, y, varname }) => {
		const { classname, args } = parseObjectText(text);
		if (!classname) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: false, error: "empty text" }),
					},
				],
			};
		}
		const result = await sendCommand(
			COMMANDS_FILE,
			RESULTS_FILE,
			"create_object",
			{ classname, args, x, y, varname, text },
		);
		const { requestId: _id, ...payload } = result;
		return {
			content: [{ type: "text", text: JSON.stringify(payload) }],
		};
	},
);

server.tool(
	"connect_objects",
	"Connect two existing Max objects with a patchcord. Both ids come from get_patch_context. Outlets/inlets are 0-indexed (0 = leftmost). After this call, the next get_patch_context reflects the new connection.",
	{
		srcId: z.string().describe("Source object id from get_patch_context"),
		srcOutlet: z
			.number()
			.int()
			.nonnegative()
			.describe("Source outlet, 0-indexed (0 = leftmost)"),
		dstId: z.string().describe("Destination object id from get_patch_context"),
		dstInlet: z
			.number()
			.int()
			.nonnegative()
			.describe("Destination inlet, 0-indexed (0 = leftmost)"),
	},
	async ({ srcId, srcOutlet, dstId, dstInlet }) => {
		const result = await sendCommand(
			COMMANDS_FILE,
			RESULTS_FILE,
			"connect_objects",
			{ srcId, srcOutlet, dstId, dstInlet },
		);
		const { requestId: _id, ...payload } = result;
		return {
			content: [{ type: "text", text: JSON.stringify(payload) }],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
