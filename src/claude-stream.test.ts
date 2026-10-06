import { expect, test } from "bun:test";
import { lineParser, shortToolName, type StreamEvent, statusFor } from "./claude-stream.ts";

test("reassembles events split across chunks and skips blank lines", () => {
	const events: StreamEvent[] = [];
	const bad: string[] = [];
	const feed = lineParser((e) => events.push(e), (l) => bad.push(l));
	feed('{"type":"system","sub');
	feed('type":"init"}\n\n{"type":"res');
	expect(events).toEqual([{ type: "system", subtype: "init" }]);
	feed('ult","subtype":"success","is_error":false,"session_id":"s"}\nnot json\n');
	expect(events.map((e) => e.type)).toEqual(["system", "result"]);
	expect(bad).toEqual(["not json"]);
});

test("tool names and status lines", () => {
	expect(shortToolName("mcp__max-msp__create_object")).toBe("create_object");
	expect(shortToolName("Read")).toBe("Read");
	const msg = (content: unknown[]) => ({ type: "assistant", message: { content } }) as StreamEvent;
	expect(statusFor(msg([{ type: "text", text: "hi" }, { type: "tool_use", id: "1", name: "mcp__x__connect", input: {} }]))).toBe(
		"claude · connect",
	);
	expect(statusFor(msg([{ type: "text", text: "hi" }]))).toBe("claude · writing…");
	expect(statusFor({ type: "system", subtype: "init" })).toBeNull();
});
