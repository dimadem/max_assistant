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
	return decodeEntities(s.replace(/<[^>]+>/g, " "))
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

	return {
		name,
		module: attr(root[0], "module"),
		category: attr(root[0], "category"),
		digest: firstTag(head, "digest"),
		description: firstTag(head, "description").slice(0, 400),
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
	for (const e of index) {
		const name = e.name.toLowerCase();
		const digest = e.digest.toLowerCase();
		const category = e.category.toLowerCase();
		const desc = e.description.toLowerCase();
		let score = 0;
		let matched = 0;
		for (const t of terms) {
			let s = 0;
			if (name === t) s += 20;
			else if (name.includes(t)) s += 8;
			if (digest.includes(t)) s += 5;
			if (category.includes(t)) s += 3;
			if (desc.includes(t)) s += 1;
			if (s > 0) matched++;
			score += s;
		}
		if (score === 0) continue;
		// Prefer entries that match more of the query terms.
		score *= matched / terms.length;
		scored.push({ e, score });
	}
	scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
	return scored.slice(0, limit).map((s) => s.e);
}
