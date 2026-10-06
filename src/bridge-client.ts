/**
 * MCP-server side of the bridge: find the running Max assistant via
 * `<root>/.bridge.json` and POST a command to it.
 */

import { readFileSync } from "node:fs";
import type { BridgeCommand, BridgeCommands, BridgeInfo, BridgeReply } from "./types/bridge.ts";

const NOT_RUNNING =
	"Max assistant is not running. Open max_assistant.maxproj in Max (the [node.script] starts the bridge).";

export async function callBridge<K extends BridgeCommand>(
	infoPath: string,
	type: K,
	...[params]: BridgeCommands[K]["params"] extends Record<string, never> ? [] : [BridgeCommands[K]["params"]]
): Promise<BridgeReply<K>> {
	try {
		const info: BridgeInfo = JSON.parse(readFileSync(infoPath, "utf-8"));
		const res = await fetch(`http://127.0.0.1:${info.port}/command`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-bridge-token": info.token },
			body: JSON.stringify({ type, ...params }),
		});
		return (await res.json()) as BridgeReply<K>;
	} catch {
		return { ok: false, error: NOT_RUNNING } as BridgeReply<K>;
	}
}
