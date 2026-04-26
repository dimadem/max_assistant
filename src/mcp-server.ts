import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sendCommand } from "./command-channel.ts";
import { parseObjectText } from "./parse-object-text.ts";
import {
	convertMaxpat,
	type PatchContext,
	type RawMaxpat,
} from "./types/max.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT_FILE = join(PROJECT_ROOT, "patch-context.json");
const COMMANDS_FILE = join(PROJECT_ROOT, "commands.ndjson");
const RESULTS_FILE = join(PROJECT_ROOT, "command-results.ndjson");

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

server.tool(
	"delete_object",
	"Delete an existing Max object from the patch by id (from get_patch_context). Removes the object and any patchcords attached to it. After this call, the next get_patch_context reflects the deletion.",
	{
		id: z.string().describe("Object id/varname from get_patch_context"),
	},
	async ({ id }) => {
		const result = await sendCommand(
			COMMANDS_FILE,
			RESULTS_FILE,
			"delete_object",
			{ id },
		);
		const { requestId: _id, ...payload } = result;
		return {
			content: [{ type: "text", text: JSON.stringify(payload) }],
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
