import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";
import { createBridgeServer } from "./bridge-server.ts";
import { encodeText, UI_IN, type UIInSelector } from "./types/protocol.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// In dev: scriptDir = .../src — go up. After build: scriptDir = .../code — go up.
const PROJECT_ROOT = join(scriptDir, "..");
const BRIDGE_INFO = join(PROJECT_ROOT, ".bridge.json");
const MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
const UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;

// One claude run at a time; it resumes the same session.
let running = false;

// Continues the same Claude session across prompts so the agent remembers
// prior messages. Reset by the "clear" handler.
let currentSessionId: string | null = null;

// Tool usage rules live in the MCP server's `instructions` so every client
// (this chat, Claude Desktop, Claude Code) gets them. Only chat-specific
// context here.
const SYSTEM_PROMPT = [
	"You are a Max/MSP assistant embedded in a chat panel inside Max.",
	"The user is looking at their patch; build and edit it with the max-msp MCP tools.",
	"Answer in the user's language. Be concise.",
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


function spawnClaude(prompt: string): void {
	const args = [
		"--print",
		prompt,
		"--permission-mode",
		"bypassPermissions",
		"--mcp-config",
		MCP_CONFIG,
		"--strict-mcp-config", // ignore the user's global MCP servers
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
		running = false;
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
		running = false;
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

const bridge = createBridgeServer((json) => Max.outlet("bridge", "command", json));

Max.addHandlers({
	prompt: (...args: unknown[]) => {
		const text = joinArgs(args).trim();
		if (!text) return;
		if (running) {
			setStatus("busy — wait for the current answer");
			return;
		}
		running = true;
		setBusy(true);
		setStatus("running claude…");
		spawnClaude(text);
	},
	clear: () => {
		currentSessionId = null;
		Max.outlet("bridge", "reset"); // next command re-picks the target patch
		Max.outlet(UI_IN.clearChat);
		setStatus("ready");
		Max.post("Session cleared");
	},
	bridgeResult: (...args: unknown[]) => bridge.handleResult(joinArgs(args)),
});

try {
	const info = await bridge.listen();
	writeFileSync(BRIDGE_INFO, JSON.stringify(info));
	Max.post(`Bridge listening on 127.0.0.1:${info.port}`);
} catch (e) {
	Max.post(`Bridge failed to start: ${e}`);
}
process.on("exit", () => {
	try {
		unlinkSync(BRIDGE_INFO);
	} catch {}
});

// Tell [jweb] which page to load. Doing it from here (instead of hardcoding
// @url in the .maxpat) keeps the project portable — the path is computed
// from PROJECT_ROOT. Message goes jweb ← [route bridge] (right outlet) ← us.
Max.outlet("url", UI_URL);

setStatus("ready");
Max.post(`Assistant ready. UI: ${UI_URL}`);
