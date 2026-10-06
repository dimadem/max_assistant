/**
 * Searchable index over Max reference pages (*.maxref.xml).
 *
 * Built once per MCP-server process (lazily, on first search) so the agent
 * can ask "which object does X?" instead of having to know the name upfront.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ObjectEntry {
	name: string;
	module: string;
	category: string;
	digest: string;
	description: string;
	tags: string[];
	seealso: string[];
}

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function cleanText(s: string): string {
	return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/TEXT_HERE/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

function firstTag(xml: string, tag: string): string {
	const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
	return m?.[1] ? cleanText(m[1]) : "";
}

function attr(tagText: string, name: string): string {
	const m = tagText.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
	return m?.[1] ? decodeEntities(m[1]) : "";
}

export function parseRefpage(xml: string): ObjectEntry | null {
	const root = xml.match(/<c74object\b[^>]*>/);
	if (!root) return null;
	const name = attr(root[0], "name");
	if (!name) return null;

	// Only the object-level <description>, not the per-inlet/method ones.
	const head = xml.split(/<(?:inletlist|outletlist|objarglist|methodlist|attributelist)\b/)[0] ?? xml;

	const seealso = [...xml.matchAll(/<seealso\b[^>]*\bname\s*=\s*"([^"]+)"/g)]
		.map((m) => decodeEntities(m[1] ?? ""))
		.filter(Boolean);

	const tags = [...xml.matchAll(/<metadata\s+name="tag"\s*>([\s\S]*?)<\/metadata>/g)]
		.map((m) => cleanText(m[1] ?? ""))
		// the module name ("MSP", "Max") is on every page — useless as a tag
		.filter((t) => t && t.toLowerCase() !== attr(root[0], "module").toLowerCase());

	return {
		name,
		module: attr(root[0], "module"),
		category: attr(root[0], "category"),
		digest: firstTag(head, "digest"),
		description: firstTag(head, "description").slice(0, 400),
		tags: [...new Set(tags)],
		seealso,
	};
}

export function buildIndex(refpagesRoot: string): ObjectEntry[] {
	const out: ObjectEntry[] = [];
	if (!existsSync(refpagesRoot)) return out;
	for (const dir of readdirSync(refpagesRoot, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const dirPath = join(refpagesRoot, dir.name);
		for (const file of readdirSync(dirPath)) {
			if (!file.endsWith(".maxref.xml")) continue;
			try {
				const entry = parseRefpage(readFileSync(join(dirPath, file), "utf-8"));
				if (entry) out.push(entry);
			} catch {
				/* unreadable page — skip */
			}
		}
	}
	return out;
}

function tokenize(s: string): string[] {
	return s.toLowerCase().split(/[^a-z0-9~.]+/).filter((t) => t.length > 1);
}

export function searchIndex(
	index: ObjectEntry[],
	query: string,
	limit = 15,
): ObjectEntry[] {
	const terms = tokenize(query);
	if (terms.length === 0) return [];
	const scored: { e: ObjectEntry; score: number }[] = [];
	const wantsJitter = terms.some((t) => /^(jit|jitter|video|matrix|gl|texture)/.test(t));
	for (const e of index) {
		const name = e.name.toLowerCase();
		const digest = e.digest.toLowerCase();
		const category = e.category.toLowerCase();
		const desc = e.description.toLowerCase();
		const tags = e.tags.join(" ").toLowerCase();
		let score = 0;
		let matched = 0;
		for (const t of terms) {
			let s = 0;
			if (name === t) s += 20;
			else if (name.includes(t)) s += 8;
			if (digest.includes(t)) s += 5;
			if (category.includes(t)) s += 3;
			if (tags.includes(t)) s += 4;
			if (desc.includes(t)) s += 1;
			if (s > 0) matched++;
			score += s;
		}
		if (score === 0) continue;
		// Prefer entries that match more of the query terms.
		score *= matched / terms.length;
		// Jitter (video/matrix) objects only when the query is about video.
		if (e.module === "jit" && !wantsJitter) score *= 0.5;
		scored.push({ e, score });
	}
	scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
	return scored.slice(0, limit).map((s) => s.e);
}

// ---------- compact reference page (for get_object_docs) --------------------

export interface RefSummary {
	name: string;
	category: string;
	digest: string;
	description: string;
	inlets: { id: number; type: string; digest: string }[];
	outlets: { id: number; type: string; digest: string }[];
	arguments: { name: string; type: string; optional: boolean; digest: string }[];
	messages: { name: string; digest: string }[];
	attributes: { name: string; type: string; digest: string }[];
	seealso: string[];
}

function section(xml: string, list: string): string {
	return xml.match(new RegExp(`<${list}\\b[^>]*>([\\s\\S]*?)</${list}>`))?.[1] ?? "";
}

// <tag …>…</tag> or <tag …/> elements of a list body.
function items(body: string, tag: string): { open: string; inner: string }[] {
	const re = new RegExp(`(<${tag}\\b[^>]*?/>)|(<${tag}\\b[^>]*>)([\\s\\S]*?)</${tag}>`, "g");
	return [...body.matchAll(re)].map((m) => ({ open: m[1] ?? m[2] ?? "", inner: m[3] ?? "" }));
}

export function summarizeRefpage(xml: string): RefSummary | null {
	const entry = parseRefpage(xml);
	if (!entry) return null;
	// Attributes carry their own nested <attributelist> of self-closing meta
	// attributes (label, category…) — drop those so lists don't nest.
	xml = xml.replace(/<attributelist>\s*(?:<attribute\b[^>]*\/>\s*)*<\/attributelist>/g, "");
	const dg = (inner: string) => firstTag(inner, "digest");
	return {
		name: entry.name,
		category: entry.category,
		digest: entry.digest,
		description: entry.description,
		inlets: items(section(xml, "inletlist"), "inlet").map(({ open, inner }) => ({
			id: Number(attr(open, "id")),
			type: attr(open, "type"),
			digest: dg(inner),
		})),
		outlets: items(section(xml, "outletlist"), "outlet").map(({ open, inner }) => ({
			id: Number(attr(open, "id")),
			type: attr(open, "type"),
			digest: dg(inner),
		})),
		arguments: items(section(xml, "objarglist"), "objarg").map(({ open, inner }) => ({
			name: attr(open, "name"),
			type: attr(open, "type"),
			optional: attr(open, "optional") === "1",
			digest: dg(inner),
		})),
		messages: items(section(xml, "methodlist"), "method")
			.map(({ open, inner }) => ({ name: attr(open, "name"), digest: dg(inner) }))
			.filter((m) => !m.name.startsWith("(")),
		attributes: items(section(xml, "attributelist"), "attribute").map(({ open, inner }) => ({
			name: attr(open, "name"),
			type: attr(open, "type"),
			digest: dg(inner),
		})),
		seealso: entry.seealso,
	};
}

/** Full cleaned text of one message / attribute / argument / inlet by name. */
export function refpageItem(xml: string, item: string): string | null {
	xml = xml.replace(/<attributelist>\s*(?:<attribute\b[^>]*\/>\s*)*<\/attributelist>/g, "");
	for (const tag of ["method", "attribute", "objarg"]) {
		for (const { open, inner } of items(xml, tag)) {
			if (attr(open, "name") === item) {
				const args = [...inner.matchAll(/<arg\b[^>]*>/g)]
					.map((m) => `${attr(m[0], "name")}:${attr(m[0], "type")}${attr(m[0], "optional") === "1" ? "?" : ""}`)
					.join(" ");
				return `${tag} ${item}${args ? ` (${args})` : ""}${attr(open, "type") ? ` type=${attr(open, "type")}` : ""}\n${cleanText(inner)}`;
			}
		}
	}
	return null;
}
