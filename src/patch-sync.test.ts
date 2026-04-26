import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncContext } from "./patch-sync.ts";
import type { PatchContext } from "./types/max.ts";

const FIXTURE = {
	patcher: {
		boxes: [
			{
				box: {
					id: "obj-1",
					maxclass: "newobj",
					text: "cycle~ 440",
					patching_rect: [10, 20, 60, 22],
					numinlets: 2,
					numoutlets: 1,
				},
			},
			{
				box: {
					id: "obj-2",
					varname: "out",
					maxclass: "newobj",
					text: "dac~",
					patching_rect: [10, 60, 40, 22],
					numinlets: 2,
					numoutlets: 0,
				},
			},
		],
		lines: [
			{
				patchline: {
					source: ["obj-1", 0],
					destination: ["obj-2", 0],
				},
			},
		],
	},
};

describe("syncContext", () => {
	test("converts a .maxpat fixture into PatchContext on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "patch-sync-"));
		const maxpat = join(dir, "test.maxpat");
		const ctx = join(dir, "patch-context.json");
		writeFileSync(maxpat, JSON.stringify(FIXTURE));

		const returned = syncContext(maxpat, ctx);
		const onDisk = JSON.parse(readFileSync(ctx, "utf-8")) as PatchContext;

		expect(onDisk).toEqual(returned);
		expect(onDisk.boxes).toHaveLength(2);
		expect(onDisk.boxes[0]).toEqual({
			id: "obj-1",
			maxclass: "newobj",
			text: "cycle~ 440",
			rect: [10, 20, 60, 22],
			numinlets: 2,
			numoutlets: 1,
		});
		expect(onDisk.boxes[1]).toEqual({
			id: "out", // varname overrides raw id
			maxclass: "newobj",
			text: "dac~",
			rect: [10, 60, 40, 22],
			numinlets: 2,
			numoutlets: 0,
		});
		expect(onDisk.lines).toEqual([
			{ src: [0, 0], dst: [1, 0] }, // raw obj-1/obj-2 → indices
		]);
	});
});
