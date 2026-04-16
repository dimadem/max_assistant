/**
 * Shared protocol between the Max-side assistant (Node-for-Max) and the
 * jweb-side UI. Imported by both `src/assistant.ts` and `src/ui/app.ts` so
 * the selectors stay in one place.
 */

/** Selectors jweb sends INTO the patcher (`window.max.outlet`). */
export const UI_OUT = {
	prompt: "prompt",
	clear: "clear",
} as const;
export type UIOutSelector = (typeof UI_OUT)[keyof typeof UI_OUT];

/** Selectors the patcher sends TO the jweb page (`window.max.bindInlet`). */
export const UI_IN = {
	appendUser: "appendUser",
	appendAssistant: "appendAssistant",
	appendSystem: "appendSystem",
	appendError: "appendError",
	status: "status",
	busy: "busy",
	clearChat: "clearChat",
} as const;
export type UIInSelector = (typeof UI_IN)[keyof typeof UI_IN];

/**
 * Text payloads are JSON-wrapped because Max may split long strings into
 * multiple atoms. Internal to this module.
 */
interface TextPayload {
	text: string;
}

/** Encode a plain string as the on-the-wire JSON payload. */
export const encodeText = (text: string): string =>
	JSON.stringify({ text } satisfies TextPayload);

/**
 * Reassemble atoms back into a string. Max may deliver the JSON payload as
 * a single symbol OR as multiple atoms (space-split). Join, parse if we
 * can, fall back to the joined raw text.
 */
export function decodeText(args: readonly unknown[]): string {
	const joined = args.map(String).join(" ");
	try {
		const parsed = JSON.parse(joined) as Partial<TextPayload>;
		if (typeof parsed?.text === "string") return parsed.text;
	} catch {
		/* not JSON — use raw */
	}
	return joined;
}
