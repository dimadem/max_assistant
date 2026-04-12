import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";
import { convertMaxpat, type RawMaxpat } from "./types/max.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// In dev: scriptDir = .../src — go up. After build: scriptDir = project root — stay.
const PROJECT_ROOT = scriptDir.endsWith("/src")
	? join(scriptDir, "..")
	: scriptDir;
const contextFile = join(PROJECT_ROOT, "max-patch-context.json");
const MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");

// Queue instead of a single global — fixes race condition when user sends
// multiple messages before the first context response arrives.
const pendingPrompts: string[] = [];

const SYSTEM_PROMPT = [
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

function spawnClaude(prompt: string): void {
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
			// no shell:true — args passed directly, no quoting issues
		},
	);

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
		const response = Buffer.concat(stdoutChunks).toString().trim();
		if (code !== 0) {
			Max.post(`Claude exited with code ${code}`);
			return;
		}
		if (response) {
			Max.post("--- Claude ---");
			for (const line of response.split("\n")) {
				if (line.trim()) Max.post(line);
			}
			Max.post("--- end ---");
		}
	});

	child.on("error", (err: Error) => {
		Max.post(`Failed to start claude: ${err.message}`);
	});
}

Max.addHandlers({
	string: (prompt: string) => {
		pendingPrompts.push(prompt);
		Max.outlet("bridge", "getcontext");
		Max.post("Getting patch context...");
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
	"Max → Claude Code bridge ready. Send a message to ask about the patch.",
);
