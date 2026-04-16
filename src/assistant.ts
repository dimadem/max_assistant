import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";
import { convertMaxpat, type RawMaxpat } from "./types/max.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// In dev: scriptDir = .../src — go up. After build: scriptDir = .../code — go up.
const PROJECT_ROOT = join(scriptDir, "..");
const contextFile = join(PROJECT_ROOT, "max-patch-context.json");
const MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");

// Queue instead of a single global — fixes race condition when user sends
// multiple messages before the first context response arrives.
const pendingPrompts: string[] = [];

// Continues the same Claude session across prompts so the agent remembers
// prior messages. Reset by the "clear" handler.
let currentSessionId: string | null = null;

const SYSTEM_PROMPT = [
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

// Build PATH that includes common Mac install locations for claude and bun.
// node.script inherits a stripped env from Max, so we add the usual locations.
const extraPaths = [
	`${process.env.HOME}/.local/bin`,
	`${process.env.HOME}/.bun/bin`,
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
];
const ENRICHED_PATH = [...extraPaths, process.env.PATH ?? ""].join(":");

interface ClaudeJsonResult {
	type: "result";
	subtype: string;
	is_error: boolean;
	result?: string;
	session_id: string;
}

function spawnClaude(prompt: string): void {
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

	child.stdin.end(); // prevent "No stdin data received" warning

	const stdoutChunks: Buffer[] = [];

	child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

	child.stderr.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) Max.post(`[claude] ${line}`);
	});

	const timeout = setTimeout(() => {
		child.kill("SIGTERM");
		Max.post("Claude timeout (120s)");
	}, 120_000);

	child.on("close", (code: number | null) => {
		clearTimeout(timeout);
		const raw = Buffer.concat(stdoutChunks).toString().trim();
		if (code !== 0) {
			Max.post(`Claude exited with code ${code}`);
			return;
		}
		if (!raw) return;

		try {
			const parsed = JSON.parse(raw) as ClaudeJsonResult;
			if (parsed.is_error) {
				Max.post(`Claude error: ${parsed.result ?? "(no message)"}`);
				return;
			}
			// Keep session_id from Claude in case it differs (forked session, etc).
			if (parsed.session_id) currentSessionId = parsed.session_id;
			const text = parsed.result?.trim() ?? "";
			if (text) Max.outlet("reply", text);
		} catch (e) {
			Max.post(`Failed to parse claude JSON: ${e}`);
		}
	});

	child.on("error", (err: Error) => {
		Max.post(`Failed to start claude: ${err.message}`);
	});
}

Max.addHandlers({
	prompt: (text: string) => {
		pendingPrompts.push(text);
		Max.outlet("bridge", "getcontext");
		Max.post("Getting patch context...");
	},
	clear: () => {
		currentSessionId = null;
		Max.post("Session cleared");
	},
	bridgeResponse: (type: string, ...data: unknown[]) => {
		if (type === "context" && data[0]) {
			const prompt = pendingPrompts.shift();
			if (!prompt) return;
			try {
				// Max returns HFS path "Macintosh HD:/Users/..." — strip volume prefix
				const patchPath = (data[0] as string).replace(/^[^/]*:/, "");
				const raw = JSON.parse(readFileSync(patchPath, "utf-8")) as RawMaxpat;
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
