import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";
import { createBridgeServer } from "./bridge-server.ts";
import { lineParser, type StreamEvent, statusFor } from "./claude-stream.ts";
import { encodeText, UI_IN, type UIInSelector } from "./types/protocol.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// In dev: scriptDir = .../src — go up. After build: scriptDir = .../code — go up.
const PROJECT_ROOT = join(scriptDir, "..");
const BRIDGE_INFO = join(PROJECT_ROOT, ".bridge.json");
const MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
const UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;

// One claude run at a time; it resumes the same session.
let running = false;
const TIMEOUT_MS = 120_000;

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

// Every run ends here exactly once: report an error (if any) and unlock the chat.
function finish(error?: string): void {
	running = false;
	setBusy(false);
	if (error) {
		Max.post(error);
		sendText(UI_IN.appendError, error);
	}
	setStatus("ready");
}

function claudeArgs(prompt: string): string[] {
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
		Max.post(`Running claude (resume ${currentSessionId.slice(0, 8)}…)`);
		return [...args, "--resume", currentSessionId];
	}
	currentSessionId = randomUUID();
	Max.post(`Running claude (new session ${currentSessionId.slice(0, 8)}…)`);
	return [...args, "--session-id", currentSessionId];
}

// Error reported by the "result" event of the current run (shown on close).
let resultError: string | undefined;

function handleEvent(ev: StreamEvent): void {
	const status = statusFor(ev);
	if (status) setStatus(status);
	if (ev.type !== "result") return;
	if (ev.is_error) {
		resultError = `Claude error: ${ev.result ?? "(no message)"}`;
		return;
	}
	// Keep session_id from Claude in case it differs (forked session, etc).
	currentSessionId = ev.session_id;
	const text = ev.result?.trim() ?? "";
	if (text) sendText(UI_IN.appendAssistant, text);
}

function spawnClaude(prompt: string): void {
	resultError = undefined;
	let timedOut = false;
	const child = spawn("claude", claudeArgs(prompt), {
		cwd: PROJECT_ROOT,
		env: { ...process.env, PATH: ENRICHED_PATH },
	});
	child.stdin.end(); // prevent "No stdin data received" warning

	const feed = lineParser(handleEvent, (line, e) => Max.post(`stream parse error: ${e}; line=${line.slice(0, 200)}`));
	child.stdout.on("data", (chunk: Buffer) => feed(chunk.toString()));
	child.stderr.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) Max.post(`[claude] ${line}`);
	});

	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, TIMEOUT_MS);

	child.on("close", (code: number | null) => {
		clearTimeout(timer);
		if (timedOut) finish(`Claude timed out after ${TIMEOUT_MS / 1000}s`);
		else if (resultError) finish(resultError);
		else if (code !== 0) finish(`Claude exited with code ${code}`);
		else finish();
	});
	// Spawn failure: "close" never follows.
	child.on("error", (err: Error) => {
		clearTimeout(timer);
		finish(`Failed to start claude: ${err.message}`);
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
		// Chat commands handled locally (the 📌 button sends these too).
		if (text === "/pin" || text === "/unpin") {
			Max.outlet("bridge", text.slice(1));
			return;
		}
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
	// [v8] reports which patch the agent will edit; forward to the chat header.
	target: (...args: unknown[]) => sendText(UI_IN.target, joinArgs(args)),
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
Max.outlet("bridge", "report"); // [v8] reports before we're up; ask again
Max.post(`Assistant ready. UI: ${UI_URL}`);
