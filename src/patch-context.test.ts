import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseContext, writeContext } from "./patch-context.ts";

const ctx = {
	patch: "Untitled1",
	boxes: [
		{ id: "obj-1", maxclass: "newobj", text: "cycle~ 440", rect: [0, 0, 60, 22], numinlets: 2, numoutlets: 1 },
		{ id: "out", maxclass: "ezdac~", text: "", rect: [0, 60, 45, 45], numinlets: 2, numoutlets: 0 },
	],
	lines: [{ src: [0, 0], dst: [1, 0] }],
};

test("writes valid context to disk", () => {
	const path = join(mkdtempSync(join(tmpdir(), "ctx-")), "patch-context.json");
	expect(writeContext(JSON.stringify(ctx), path)).toEqual(ctx as never);
	expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(ctx);
});

test("rejects malformed payloads", () => {
	expect(() => parseContext('{"boxes":[]}')).toThrow();
	expect(() => parseContext("not json")).toThrow();
});
