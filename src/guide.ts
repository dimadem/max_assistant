/**
 * Search and read the Max User Guide that ships with Max 9
 * (C74/docs/userguide/userguide_search.sqlite, an FTS4 index of ~150 pages:
 * messages, MSP basics, polyphony, MC, gen, javascript, pattr, …).
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export interface GuideHit {
	path: string;
	title: string;
	description: string;
	snippet: string;
}

let cached: { path: string; db: Database } | null = null;

function open(dbPath: string): Database | null {
	if (cached?.path === dbPath) return cached.db;
	if (!existsSync(dbPath)) return null;
	const db = new Database(dbPath, { readonly: true });
	cached = { path: dbPath, db };
	return db;
}

// FTS query from free text: words only (FTS syntax chars stripped).
function ftsTerms(query: string): string[] {
	return query
		.toLowerCase()
		.replace(/[^a-z0-9~\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1)
		.map((t) => t.replace(/~/g, ""))
		.filter(Boolean);
}

export function searchGuide(dbPath: string, query: string, limit = 8): GuideHit[] | null {
	const db = open(dbPath);
	if (!db) return null;
	const terms = ftsTerms(query);
	if (terms.length === 0) return [];
	const sql = `SELECT p.path, p.title, p.description,
		snippet(pages_fts, '«', '»', '…', 2, 20) AS snippet,
		length(offsets(pages_fts)) AS weight
		FROM pages_fts JOIN pages p ON p.id = pages_fts.docid
		WHERE pages_fts MATCH ? ORDER BY weight DESC LIMIT ?`;
	// All terms first; if that's too narrow, any term.
	let rows = db.query(sql).all(terms.join(" "), limit) as (GuideHit & { weight: number })[];
	if (rows.length < 3 && terms.length > 1) {
		const seen = new Set(rows.map((r) => r.path));
		const more = db.query(sql).all(terms.join(" OR "), limit) as (GuideHit & { weight: number })[];
		rows = rows.concat(more.filter((r) => !seen.has(r.path))).slice(0, limit);
	}
	return rows.map(({ weight: _w, ...hit }) => hit);
}

/**
 * Page body as plain text. Long pages are cut to `maxChars`; with `focus`
 * the window is centred on the first occurrence of that phrase/word.
 */
export function readGuide(
	dbPath: string,
	path: string,
	focus?: string,
	maxChars = 8000,
): { title: string; path: string; text: string; truncated: boolean } | null {
	const db = open(dbPath);
	if (!db) return null;
	const row = db.query("SELECT title, path, body FROM pages WHERE path = ?").get(path) as
		| { title: string; path: string; body: string }
		| null;
	if (!row) return null;
	const body = row.body ?? "";
	if (body.length <= maxChars) return { title: row.title, path: row.path, text: body, truncated: false };
	let start = 0;
	if (focus) {
		const lower = body.toLowerCase();
		let at = lower.indexOf(focus.toLowerCase());
		if (at < 0) for (const t of ftsTerms(focus)) if ((at = lower.indexOf(t)) >= 0) break;
		if (at > 0) start = Math.max(0, Math.min(at - maxChars / 4, body.length - maxChars));
	}
	return { title: row.title, path: row.path, text: body.slice(start, start + maxChars), truncated: true };
}
