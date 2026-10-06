/**
 * `claude --output-format stream-json` parsing: newline-delimited JSON
 * events, possibly split across stdout chunks.
 */

type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string };

export type StreamEvent =
	| { type: "system"; subtype: string }
	| { type: "assistant"; message: { content: ContentBlock[] } }
	| { type: "user"; message: { content: ContentBlock[] } }
	| { type: "result"; subtype: string; is_error: boolean; result?: string; session_id: string };

/** Feed stdout chunks; calls `onEvent` per complete line, `onBadLine` for unparsable ones. */
export function lineParser(onEvent: (ev: StreamEvent) => void, onBadLine: (line: string, err: unknown) => void) {
	let buffer = "";
	return (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
			try {
				onEvent(JSON.parse(line) as StreamEvent);
			} catch (e) {
				onBadLine(line, e);
			}
		}
	};
}

/** MCP tools arrive as "mcp__max-msp__create_object" — keep the trailing name. */
export function shortToolName(name: string): string {
	return name.split("__").pop() || name;
}

/** Status line for an assistant event, or null when it has nothing to show. */
export function statusFor(ev: StreamEvent): string | null {
	if (ev.type !== "assistant") return null;
	const tool = ev.message.content.find((c) => c.type === "tool_use");
	if (tool) return `claude · ${shortToolName(tool.name)}`;
	return ev.message.content.some((c) => c.type === "text") ? "claude · writing…" : null;
}
