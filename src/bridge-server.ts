/**
 * Local HTTP endpoint inside [node.script]. MCP servers (any client: the
 * in-Max chat, Claude Desktop, Claude Code…) POST commands here; we forward
 * them to [v8 bridge.js] as a Max message and resolve when `bridgeResult`
 * comes back. Replaces the old commands.ndjson polling.
 *
 * Discovery: `<root>/.bridge.json` = { port, token }. Requests must carry
 * `x-bridge-token` so random web pages can't drive the patch via localhost.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface BridgeInfo {
	port: number;
	token: string;
}

type Result = Record<string, unknown> & { ok: boolean };

export function createBridgeServer(
	sendToMax: (json: string) => void,
	timeoutMs = 10_000,
) {
	const token = randomUUID();
	const pending = new Map<string, (r: Result) => void>();

	function handleResult(json: string): void {
		let r: Result & { requestId?: string };
		try {
			r = JSON.parse(json);
		} catch {
			return;
		}
		if (!r.requestId) return;
		const done = pending.get(r.requestId);
		if (!done) return;
		pending.delete(r.requestId);
		const { requestId: _id, ...rest } = r;
		done(rest as Result);
	}

	function dispatch(cmd: Record<string, unknown>): Promise<Result> {
		const requestId = randomUUID();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve({
					ok: false,
					error: `Max did not answer "${cmd.type}" within ${timeoutMs} ms (is [v8 bridge.js] loaded?)`,
				});
			}, timeoutMs);
			pending.set(requestId, (r) => {
				clearTimeout(timer);
				resolve(r);
			});
			sendToMax(JSON.stringify({ ...cmd, requestId }));
		});
	}

	const server: Server = createServer((req, res) => {
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method !== "POST" || req.url !== "/command") return send(404, { ok: false, error: "not found" });
		if (req.headers["x-bridge-token"] !== token) return send(403, { ok: false, error: "bad token" });
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", async () => {
			let cmd: Record<string, unknown>;
			try {
				cmd = JSON.parse(body);
			} catch {
				return send(400, { ok: false, error: "invalid JSON" });
			}
			if (typeof cmd.type !== "string") return send(400, { ok: false, error: "missing type" });
			send(200, await dispatch(cmd));
		});
	});

	function listen(firstPort = 7474, attempts = 20): Promise<BridgeInfo> {
		return new Promise((resolve, reject) => {
			let port = firstPort;
			const tryNext = () => {
				server.once("error", (e: NodeJS.ErrnoException) => {
					if (e.code === "EADDRINUSE" && port < firstPort + attempts - 1) {
						port++;
						tryNext();
					} else reject(e);
				});
				server.listen(port, "127.0.0.1", () => resolve({ port, token }));
			};
			tryNext();
		});
	}

	return { handleResult, dispatch, listen, close: () => server.close() };
}
