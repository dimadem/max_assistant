import { describe, expect, test } from "bun:test";
import { layout, originBelow } from "./layout.ts";
import { checkPatch } from "./patch-checks.ts";
import type { PatchContext } from "./types/max.ts";

const box = (id: string, text: string, maxclass = "newobj") => ({
	id, maxclass, text, rect: [0, 0, 60, 22] as [number, number, number, number], numinlets: 2, numoutlets: 1,
});

describe("layout", () => {
	test("rows follow signal flow, columns within a row", () => {
		const out = layout(
			[{ name: "osc" }, { name: "lfo" }, { name: "mul" }, { name: "dac" }],
			[
				{ from: "osc", to: "mul" },
				{ from: "lfo", to: "mul" },
				{ from: "mul", to: "dac" },
			],
			{ x: 40, y: 100 },
		);
		const at = Object.fromEntries(out.map((o) => [o.name, [o.x, o.y]]));
		expect(at).toEqual({ osc: [40, 100], lfo: [190, 100], mul: [40, 150], dac: [40, 200] });
	});

	test("keeps explicit coordinates and survives cycles", () => {
		const out = layout([{ name: "a", x: 5, y: 6 }, { name: "b" }], [
			{ from: "a", to: "b" },
			{ from: "b", to: "a" },
		], { x: 0, y: 0 });
		expect(out[0]).toMatchObject({ x: 5, y: 6 });
		expect(out[1]?.y).toBeGreaterThanOrEqual(0);
	});

	test("origin goes below existing objects", () => {
		const ctx: PatchContext = { boxes: [{ ...box("a", "x"), rect: [100, 50, 60, 22] }], connections: [] };
		expect(originBelow(ctx)).toEqual({ x: 100, y: 112 });
		expect(originBelow({ boxes: [], connections: [] })).toEqual({ x: 40, y: 40 });
	});
});

describe("checkPatch", () => {
	test("flags a direct signal feedback loop", () => {
		const ctx: PatchContext = {
			boxes: [box("osc", "cycle~ 440"), box("gain", "*~ 0.2")],
			connections: [{ from: "osc", outlet: 0, to: "gain", inlet: 0 }, { from: "gain", outlet: 0, to: "osc", inlet: 0 }],
		};
		const w = checkPatch(ctx);
		expect(w).toHaveLength(1);
		expect(w[0]).toContain("feedback loop");
		expect(w[0]).toContain("osc [cycle~ 440]");
	});

	test("allows feedback through tapin~/tapout~", () => {
		const ctx: PatchContext = {
			boxes: [box("in", "tapin~ 1000"), box("out", "tapout~ 250"), box("fb", "*~ 0.5")],
			connections: [{ from: "in", outlet: 0, to: "out", inlet: 0 }, { from: "out", outlet: 0, to: "fb", inlet: 0 }, { from: "fb", outlet: 0, to: "in", inlet: 0 }],
		};
		expect(checkPatch(ctx)).toEqual([]);
	});

	test("ignores control-rate loops and flags bogus objects", () => {
		const ctx: PatchContext = {
			boxes: [box("a", "t b"), box("b", "+ 1"), box("x", "sine~ 440", "jbogus")],
			connections: [{ from: "a", outlet: 0, to: "b", inlet: 0 }, { from: "b", outlet: 0, to: "a", inlet: 0 }],
		};
		const w = checkPatch(ctx);
		expect(w).toHaveLength(1);
		expect(w[0]).toContain("not a valid Max object");
	});
});
