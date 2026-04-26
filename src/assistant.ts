import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";
import { syncContext } from "./patch-sync.ts";
import { encodeText, UI_IN, type UIInSelector } from "./types/protocol.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// In dev: scriptDir = .../src — go up. After build: scriptDir = .../code — go up.
const PROJECT_ROOT = join(scriptDir, "..");
const contextFile = join(PROJECT_ROOT, "patch-context.json");
const COMMANDS_FILE = join(PROJECT_ROOT, "commands.ndjson");
const RESULTS_FILE = join(PROJECT_ROOT, "command-results.ndjson");
const MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
const UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;

// Queue instead of a single global — fixes race condition when user sends
// multiple messages before the first context response arrives.
const pendingPrompts: string[] = [];

// Continues the same Claude session across prompts so the agent remembers
// prior messages. Reset by the "clear" handler.
let currentSessionId: string | null = null;

const SYSTEM_PROMPT = [
	"You are an expert Max/MSP assistant embedded inside a live Max patch.",
	"Use the provided MCP tools to inspect and modify the current patch:",
	"  • get_patch_context  — full list of objects and connections",
	"  • get_connections    — inputs/outputs for a specific object by id",
	"  • get_object_docs    — Max reference docs (inlets, outlets, messages, attributes) for any object type",
	"  • create_object      — create a new Max object at (x,y) with full Box.text",
	"  • connect_objects    — connect srcId.outlet → dstId.inlet (ids from get_patch_context)",
	"  • delete_object      — delete an existing object by id (also removes its patchcords)",
	"Max/MSP conventions to keep in mind:",
	"  • Signal objects end with ~ (cycle~, dac~, selector~, etc.)",
	"  • Data flows left-to-right through inlets/outlets",
	"  • 'maxclass' is the object type; 'text' is the full typed argument string",
	"  • Connections are indexed: outlet 0 is leftmost, inlet 0 is leftmost",
	"After any mutation tool, the patch-context is refreshed automatically; call get_patch_context again only if you need updated ids.",
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

type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string };

type StreamEvent =
	| { type: "system"; subtype: string }
	| { type: "assistant"; message: { content: ContentBlock[] } }
	| { type: "user"; message: { content: ContentBlock[] } }
	| {
			type: "result";
			subtype: string;
			is_error: boolean;
			result?: string;
			session_id: string;
	  };

// MCP tools arrive as "mcp__max-msp__create_object" — keep the trailing name.
function shortToolName(name: string): string {
	const parts = name.split("__");
	return parts[parts.length - 1] ?? name;
}

// Text payloads go through encodeText so multi-word strings survive Max's
// atom boundary (the jweb side reassembles via decodeText).
function sendText(selector: UIInSelector, text: string): void {
	Max.outlet(selector, encodeText(text));
}

function setBusy(on: boolean): void {
	Max.outlet(UI_IN.busy, on ? 1 : 0);
}

function setStatus(text: string): void {
	sendText(UI_IN.status, text);
}

// HFS path "Macintosh HD:/Users/..." → POSIX path. No-op for already-POSIX paths.
function hfsToPosix(path: string): string {
	return path.replace(/^[^/]*:/, "");
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
		"stream-json",
		"--verbose",
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

	let stdoutBuffer = "";

	const handleEvent = (ev: StreamEvent): void => {
		switch (ev.type) {
			case "assistant": {
				const toolUse = ev.message.content.find((c) => c.type === "tool_use");
				if (toolUse) {
					setStatus(`claude · ${shortToolName(toolUse.name)}`);
					return;
				}
				if (ev.message.content.some((c) => c.type === "text")) {
					setStatus("claude · writing…");
				}
				return;
			}
			case "result": {
				if (ev.is_error) {
					const msg = `Claude error: ${ev.result ?? "(no message)"}`;
					Max.post(msg);
					sendText(UI_IN.appendError, msg);
					setStatus("ready");
					return;
				}
				// Keep session_id from Claude in case it differs (forked session, etc).
				currentSessionId = ev.session_id;
				const text = ev.result?.trim() ?? "";
				if (text) sendText(UI_IN.appendAssistant, text);
				setStatus("ready");
				return;
			}
			// "system" / "user" events are not used here.
		}
	};

	child.stdout.on("data", (chunk: Buffer) => {
		stdoutBuffer += chunk.toString();
		const lines = stdoutBuffer.split("\n");
		stdoutBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				handleEvent(JSON.parse(trimmed) as StreamEvent);
			} catch (e) {
				Max.post(`stream parse error: ${e}; line=${trimmed.slice(0, 200)}`);
			}
		}
	});

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
		setBusy(false);
		if (code !== 0) {
			const msg = `Claude exited with code ${code}`;
			Max.post(msg);
			sendText(UI_IN.appendError, msg);
			setStatus("ready");
		}
		// Success path: the "result" event already updated UI + status.
	});

	child.on("error", (err: Error) => {
		setBusy(false);
		const msg = `Failed to start claude: ${err.message}`;
		Max.post(msg);
		sendText(UI_IN.appendError, msg);
		setStatus("ready");
	});
}

// Reassemble a user prompt that Max may have split into multiple atoms.
function joinArgs(args: unknown[]): string {
	return args.map(String).join(" ");
}

interface CommandSyncedPayload {
	requestId: string;
	path: string;
	result: Record<string, unknown>;
}

Max.addHandlers({
	prompt: (...args: unknown[]) => {
		const text = joinArgs(args).trim();
		if (!text) return;
		pendingPrompts.push(text);
		setBusy(true);
		setStatus("getting patch context…");
		Max.outlet("bridge", "getcontext");
	},
	clear: () => {
		currentSessionId = null;
		pendingPrompts.length = 0;
		Max.outlet(UI_IN.clearChat);
		setStatus("ready");
		setBusy(false);
		Max.post("Session cleared");
	},
	bridgeResponse: (type: string, ...data: unknown[]) => {
		if (type === "context" && data[0]) {
			const prompt = pendingPrompts.shift();
			if (!prompt) return;
			try {
				const patchPath = hfsToPosix(data[0] as string);
				const ctx = syncContext(patchPath, contextFile);
				setStatus(
					`running claude · ${ctx.boxes.length} obj · ${ctx.lines.length} conn`,
				);
				spawnClaude(prompt);
			} catch (e) {
				const msg = `Error: ${e}`;
				Max.post(msg);
				sendText(UI_IN.appendError, msg);
				setBusy(false);
				setStatus("ready");
			}
		}
	},
	commandSynced: (...args: unknown[]) => {
		const json = joinArgs(args);
		let payload: CommandSyncedPayload;
		try {
			payload = JSON.parse(json) as CommandSyncedPayload;
		} catch (e) {
			Max.post(`commandSynced parse error: ${e}; raw=${json}`);
			return;
		}
		const { requestId, path, result } = payload;
		try {
			syncContext(hfsToPosix(path), contextFile);
		} catch (e) {
			Max.post(`syncContext failed after command ${requestId}: ${e}`);
		}
		try {
			appendFileSync(
				RESULTS_FILE,
				`${JSON.stringify({ requestId, ...result })}\n`,
			);
		} catch (e) {
			Max.post(`failed to append command-results.ndjson: ${e}`);
		}
	},
});

// Truncate channel files at startup so stale entries from previous sessions
// don't pollute polling. Both files are append-only during a session.
try {
	writeFileSync(COMMANDS_FILE, "");
	writeFileSync(RESULTS_FILE, "");
} catch (e) {
	Max.post(`could not init command channel files: ${e}`);
}

// Tell [v8] where the project root is so it can locate commands.ndjson and
// start its command poller. Sent before the first prompt.
Max.outlet("bridge", "config", PROJECT_ROOT);

// Tell [jweb] which page to load. Doing it from here (instead of hardcoding
// @url in the .maxpat) keeps the project portable — the path is computed
// from PROJECT_ROOT. Message goes jweb ← [route bridge] (right outlet) ← us.
Max.outlet("url", UI_URL);

setStatus("ready");
Max.post(`Assistant ready. UI: ${UI_URL}`);
