/**
 * Turn what the agent wrote into a box spec for [v8 bridge.js]:
 *   object  → { box: "object", classname, args }  (Patcher.newdefault)
 *   message → { box: "message", content }          (message box, may contain , ;)
 *   comment → { box: "comment", content }
 * `box` may be given explicitly; otherwise text starting with "message " /
 * "comment " is treated as that box type.
 */

type BoxKind = "object" | "message" | "comment";

type BoxSpec =
	| { box: "object"; classname: string; args: (string | number)[] }
	| { box: "message" | "comment"; content: string };

interface ParsedObjectText {
	classname: string;
	args: (string | number)[];
}

export function parseObjectText(text: string): ParsedObjectText {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { classname: "", args: [] };
	const [classname, ...rest] = tokens;
	const args = rest.map((t) => {
		const n = +t;
		return Number.isFinite(n) ? n : t;
	});
	return { classname: classname ?? "", args };
}

export function toBoxSpec(text: string, box?: BoxKind): BoxSpec {
	const trimmed = text.trim();
	const m = /^(message|msg|comment)\b\s*/.exec(trimmed);
	const kind: BoxKind = box ?? (m ? (m[1] === "comment" ? "comment" : "message") : "object");
	if (kind === "object") return { box: "object", ...parseObjectText(trimmed) };
	const content = !box || m ? trimmed.slice(m?.[0].length ?? 0) : trimmed;
	return { box: kind, content };
}
