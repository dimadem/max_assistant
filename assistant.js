// src/assistant.ts
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";

// src/types/max.ts
function convertMaxpat(raw) {
	const idToIndex = new Map();
	const boxes = raw.patcher.boxes.map((entry, i) => {
		const b = entry.box;
		idToIndex.set(b.id, i);
		return {
			id: b.varname ?? b.id,
			maxclass: b.maxclass,
			text: b.text ?? "",
			rect: b.patching_rect,
			numinlets: b.numinlets,
			numoutlets: b.numoutlets,
		};
	});
	const lines = [];
	for (const entry of raw.patcher.lines) {
		const pl = entry.patchline;
		const srcIdx = idToIndex.get(pl.source[0]);
		const dstIdx = idToIndex.get(pl.destination[0]);
		if (srcIdx !== undefined && dstIdx !== undefined) {
			lines.push({
				src: [srcIdx, pl.source[1]],
				dst: [dstIdx, pl.destination[1]],
			});
		}
	}
	return { boxes, lines };
}

// src/assistant.ts
var scriptDir = dirname(fileURLToPath(import.meta.url));
var PROJECT_ROOT = scriptDir.endsWith("/src")
	? join(scriptDir, "..")
	: scriptDir;
var contextFile = join(PROJECT_ROOT, "max-patch-context.json");
var MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
var pendingPrompts = [];
var SYSTEM_PROMPT = [
	"You are an expert Max/MSP assistant embedded inside a live Max patch.",
	"Use the provided MCP tools to inspect the current patch before answering:",
	"  • get_patch_context  — full list of objects and connections",
	"  • list_objects       — filter objects by type (maxclass)",
	"  • find_object        — search by id, type, or text",
	"  • get_connections    — inputs/outputs for a specific object",
	"Max/MSP conventions to keep in mind:",
	"  • Signal objects end with ~ (cycle~, dac~, selector~, etc.)",
	"  • Data flows left-to-right through inlets/outlets",
	"  • 'maxclass' is the object type; 'text' is the full typed argument string",
	"  • Connections are indexed: outlet 0 is leftmost, inlet 0 is leftmost",
	"Be concise. When referencing objects use their text or id.",
].join(" ");
var extraPaths = [
	`${process.env.HOME}/.local/bin`,
	`${process.env.HOME}/.bun/bin`,
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
];
var ENRICHED_PATH = [...extraPaths, process.env.PATH ?? ""].join(":");
function spawnClaude(prompt) {
	Max.post("Running claude...");
	const child = spawn(
		"claude",
		[
			"--print",
			prompt,
			"--mcp-config",
			MCP_CONFIG,
			"--output-format",
			"text",
			"--append-system-prompt",
			SYSTEM_PROMPT,
		],
		{
			cwd: PROJECT_ROOT,
			env: { ...process.env, PATH: ENRICHED_PATH },
		},
	);
	child.stdin.end();
	const stdoutChunks = [];
	child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
	child.stderr.on("data", (chunk) => {
		const line = chunk.toString().trim();
		if (line) Max.post(`[claude] ${line}`);
	});
	const timeout = setTimeout(() => {
		child.kill("SIGTERM");
		Max.post("Claude timeout (120s)");
	}, 120000);
	child.on("close", (code) => {
		clearTimeout(timeout);
		const response = Buffer.concat(stdoutChunks).toString().trim();
		if (code !== 0) {
			Max.post(`Claude exited with code ${code}`);
			return;
		}
		if (response) {
			Max.post("--- Claude ---");
			for (const line of response.split(`
`)) {
				if (line.trim()) Max.post(line);
			}
			Max.post("--- end ---");
		}
	});
	child.on("error", (err) => {
		Max.post(`Failed to start claude: ${err.message}`);
	});
}
Max.addHandlers({
	string: (prompt) => {
		pendingPrompts.push(prompt);
		Max.outlet("bridge", "getcontext");
		Max.post("Getting patch context...");
	},
	bridgeResponse: (type, ...data) => {
		if (type === "context" && data[0]) {
			const prompt = pendingPrompts.shift();
			if (!prompt) return;
			try {
				const patchPath = data[0].replace(/^[^/]*:/, "");
				const raw = JSON.parse(readFileSync(patchPath, "utf-8"));
				const ctx = convertMaxpat(raw);
				writeFileSync(contextFile, JSON.stringify(ctx, null, 2));
				Max.post(
					`Patch: ${ctx.boxes.length} objects, ${ctx.lines.length} connections`,
				);
				spawnClaude(prompt);
			} catch (e) {
				Max.post(`Error: ${e}`);
			}
		}
	},
});
Max.post(
	"Max → Claude Code bridge ready. Send a message to ask about the patch.",
);
