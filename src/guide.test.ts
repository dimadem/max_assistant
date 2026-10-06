import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGuide, searchGuide } from "./guide.ts";

// Same schema as Max's userguide_search.sqlite.
const dbPath = join(mkdtempSync(join(tmpdir(), "guide-")), "ug.sqlite");
const db = new Database(dbPath);
db.run(`CREATE TABLE pages (id INTEGER PRIMARY KEY AUTOINCREMENT, path VARCHAR(255) NOT NULL,
	title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '')`);
db.run(`CREATE VIRTUAL TABLE pages_fts USING fts4(content='pages', title, description, body, tokenize=porter)`);
const add = (path: string, title: string, body: string) => {
	const { lastInsertRowid } = db.run("INSERT INTO pages (path, title, description, body) VALUES (?, ?, '', ?)", [path, title, body]);
	db.run("INSERT INTO pages_fts (docid, title, description, body) VALUES (?, ?, '', ?)", [lastInsertRowid, title, body]);
};
add("/messages", "Messages", "A list message like 1 10, 0 500 gives line~ an envelope to follow.");
add("/polyphony", "Polyphony", "Use poly~ to manage voices. Each voice has its own envelope.");
add("/long", "Long page", `${"filler ".repeat(3000)}the needle is here ${"filler ".repeat(3000)}`);
db.close();

test("finds pages by meaning, with snippets", () => {
	const hits = searchGuide(dbPath, "line~ envelope") ?? [];
	expect(hits[0]?.path).toBe("/messages");
	expect(hits[0]?.snippet).toContain("«envelope»");
});

test("falls back to OR when AND is too narrow", () => {
	const paths = (searchGuide(dbPath, "voices envelope") ?? []).map((h) => h.path);
	expect(paths).toContain("/polyphony");
	expect(paths).toContain("/messages");
});

test("reads a page, centred on focus when truncated", () => {
	expect(readGuide(dbPath, "/messages")?.text).toContain("line~");
	const long = readGuide(dbPath, "/long", "needle", 1000);
	expect(long?.truncated).toBe(true);
	expect(long?.text).toContain("needle");
	expect(readGuide(dbPath, "/nope")).toBeNull();
});

test("missing database → null", () => {
	expect(searchGuide("/nope.sqlite", "x")).toBeNull();
});
