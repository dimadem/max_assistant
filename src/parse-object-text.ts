/**
 * Parse a Max Box.text string into (classname, args) for `Patcher.newdefault`.
 * Splits on whitespace; numeric tokens are coerced via `+t`.
 */

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
