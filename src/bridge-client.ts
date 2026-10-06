/**
 * MCP-server side of the bridge: find the running Max assistant via
 * `<root>/.bridge.json` and POST a command to it.
 */

import { readFileSync } from "node:fs";
import type { BridgeInfo } from "./bridge-server.ts";

export type BridgeResult = Record<string, unknown> & { ok: boolean; error?: string };

const NOT_RUNNING =
	"Max assistant is not running. Open max_assistant.maxproj in Max (the [node.script] starts the bridge).";

export async function callBridge(
	infoPath: string,
	type: string,
	params: Record<string, unknown> = {},
): Promise<BridgeResult> {
	let info: BridgeInfo;
	try {
		info = JSON.parse(readFileSync(infoPath, "utf-8"));
	} catch {
		return { ok: false, error: NOT_RUNNING };
	}
	try {
		const res = await fetch(`http://127.0.0.1:${info.port}/command`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-bridge-token": info.token },
			body: JSON.stringify({ type, ...params }),
		});
		return (await res.json()) as BridgeResult;
	} catch {
		return { ok: false, error: NOT_RUNNING };
	}
}
