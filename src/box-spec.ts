/**
 * Turn what the agent wrote into a box spec for [v8 bridge.js]. All
 * tokenising happens here (testable), so v8 only applies atoms:
 *   object          → newdefault(x, y, ...atoms)          atoms[0] = classname
 *   message/comment → newdefault(x, y, box) + set ...atoms ("," ";" are atoms)
 * `box` may be given explicitly; otherwise text starting with "message " /
 * "msg " / "comment " is that box type (a redundant prefix is dropped too).
 */

import type { Atom, BoxKind, BoxSpec } from "./types/bridge.ts";

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const PREFIX = /^(message|msg|comment)\b\s*/;

export function toAtoms(text: string, splitPunctuation = false): Atom[] {
	const spaced = splitPunctuation ? text.replace(/([,;])/g, " $1 ") : text;
	return spaced
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => (NUMBER.test(t) ? Number(t) : t));
}

function kindOf(prefix: string): BoxKind {
	return prefix === "comment" ? "comment" : "message";
}

export function toBoxSpec(text: string, box?: BoxKind): BoxSpec {
	let content = text.trim();
	const m = PREFIX.exec(content);
	const kind = box ?? (m?.[1] ? kindOf(m[1]) : "object");
	if (kind === "object") return { box: kind, atoms: toAtoms(content), text: content };
	if (m?.[1] && kindOf(m[1]) === kind) content = content.slice(m[0].length);
	return { box: kind, atoms: toAtoms(content, true), text: content };
}
