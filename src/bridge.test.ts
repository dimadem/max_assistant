import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callBridge } from "./bridge-client.ts";
import { createBridgeServer } from "./bridge-server.ts";

// Fake Max: echoes the command back as a bridgeResult on the next tick.
const bridge = createBridgeServer((json) => {
	const cmd = JSON.parse(json);
	if (cmd.type === "silent") return; // never answers → timeout
	setTimeout(() => bridge.handleResult(JSON.stringify({ requestId: cmd.requestId, ok: true, echo: cmd.type })), 1);
}, 200);
const info = await bridge.listen(17474);
const dir = mkdtempSync(join(tmpdir(), "bridge-"));
const infoPath = join(dir, ".bridge.json");
writeFileSync(infoPath, JSON.stringify(info));
afterAll(() => bridge.close());

test("round-trips a command through HTTP and the fake Max", async () => {
	expect(await callBridge(infoPath, "get_context")).toEqual({ ok: true, echo: "get_context" } as never);
});

test("times out when Max never answers", async () => {
	const r = await callBridge(infoPath, "silent" as "get_context");
	expect(r.ok).toBe(false);
	expect(r.error).toContain("did not answer");
});

test("rejects a wrong token", async () => {
	const bad = join(dir, "bad.json");
	writeFileSync(bad, JSON.stringify({ ...info, token: "nope" }));
	expect((await callBridge(bad, "get_context")).error).toBe("bad token");
});

test("reports Max not running when the info file is missing", async () => {
	expect((await callBridge(join(dir, "missing.json"), "get_context")).error).toContain("not running");
});

test("falls back to the next port when busy", async () => {
	const other = createBridgeServer(() => {});
	const second = await other.listen(info.port);
	expect(second.port).toBe(info.port + 1);
	other.close();
});
