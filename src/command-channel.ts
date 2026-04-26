/**
 * File-based command channel between MCP tools and the Max [v8] bridge.
 *
 * MCP appends one JSON line per request to `commands.ndjson` and polls
 * `command-results.ndjson` (written by `[node.script]`) until a result with
 * the matching `requestId` appears, or the timeout fires.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 2000;

interface CommandResult {
	requestId: string;
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendCommand(
	commandsPath: string,
	resultsPath: string,
	type: string,
	params: Record<string, unknown>,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
	const requestId = randomUUID();
	const cmd = { requestId, type, ...params };
	appendFileSync(commandsPath, `${JSON.stringify(cmd)}\n`);

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(resultsPath)) {
			const content = readFileSync(resultsPath, "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				if (!line) continue;
				try {
					const r = JSON.parse(line) as CommandResult;
					if (r.requestId === requestId) return r;
				} catch {
					/* malformed line — ignore */
				}
			}
		}
		await sleep(POLL_INTERVAL_MS);
	}
	return {
		requestId,
		ok: false,
		error: `Command "${type}" timed out after ${timeoutMs}ms`,
	};
}
