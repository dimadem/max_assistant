// src/assistant.ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
var PROJECT_ROOT = join(scriptDir, "..");
var contextFile = join(PROJECT_ROOT, "max-patch-context.json");
var MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
var pendingPrompts = [];
var currentSessionId = null;
var SYSTEM_PROMPT = [
	"You are an expert Max/MSP assistant embedded inside a live Max patch.",
	"Use the provided MCP tools to inspect the current patch before answering:",
	"  • get_patch_context  — full list of objects and connections",
	"  • get_connections    — inputs/outputs for a specific object by id",
	"  • get_object_docs    — Max reference docs (inlets, outlets, messages, attributes) for any object type",
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
	const args = [
		"--print",
		prompt,
		"--permission-mode",
		"bypassPermissions",
		"--mcp-config",
		MCP_CONFIG,
		"--output-format",
		"json",
		"--append-system-prompt",
		SYSTEM_PROMPT,
	];
	if (currentSessionId) {
		args.push("--resume", currentSessionId);
		Max.post(`Running claude (resume ${currentSessionId.slice(0, 8)}…)`);
	} else {
		currentSessionId = randomUUID();
		args.push("--session-id", currentSessionId);
		Max.post(`Running claude (new session ${currentSessionId.slice(0, 8)}…)`);
	}
	const child = spawn("claude", args, {
		cwd: PROJECT_ROOT,
		env: { ...process.env, PATH: ENRICHED_PATH },
	});
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
		const raw = Buffer.concat(stdoutChunks).toString().trim();
		if (code !== 0) {
			Max.post(`Claude exited with code ${code}`);
			return;
		}
		if (!raw) return;
		try {
			const parsed = JSON.parse(raw);
			if (parsed.is_error) {
				Max.post(`Claude error: ${parsed.result ?? "(no message)"}`);
				return;
			}
			if (parsed.session_id) currentSessionId = parsed.session_id;
			const text = parsed.result?.trim() ?? "";
			if (text) Max.outlet("reply", text);
		} catch (e) {
			Max.post(`Failed to parse claude JSON: ${e}`);
		}
	});
	child.on("error", (err) => {
		Max.post(`Failed to start claude: ${err.message}`);
	});
}
Max.addHandlers({
	prompt: (text) => {
		pendingPrompts.push(text);
		Max.outlet("bridge", "getcontext");
		Max.post("Getting patch context...");
	},
	clear: () => {
		currentSessionId = null;
		Max.post("Session cleared");
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
	"Max Assistant ready. Type a prompt and press Enter to ask about the patch.",
);
