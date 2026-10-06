import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, parseRefpage, searchIndex } from "./object-index.ts";

const page = (name: string, category: string, digest: string, desc = "") => `<?xml version="1.0" encoding="utf-8"?>
<c74object name="${name}" module="msp" category="${category}">
	<digest>${digest}</digest>
	<description>${desc}</description>
	<inletlist><inlet id="0"><digest>Inlet digest should not leak</digest><description>nope</description></inlet></inletlist>
	<seealsolist><seealso name="tapout~"/><seealso name="delay~"/></seealsolist>
</c74object>`;

describe("parseRefpage", () => {
	test("extracts object-level fields, not inlet ones", () => {
		const e = parseRefpage(page("tapin~", "MSP Delays", "Input to a delay line", "Use with <o>tapout~</o> &amp; more"));
		expect(e).toEqual({
			name: "tapin~",
			module: "msp",
			category: "MSP Delays",
			digest: "Input to a delay line",
			description: "Use with tapout~ & more",
			seealso: ["tapout~", "delay~"],
		});
	});

	test("returns null for non-refpage xml", () => {
		expect(parseRefpage("<foo/>")).toBeNull();
	});
});

describe("searchIndex", () => {
	const index = [
		parseRefpage(page("tapin~", "MSP Delays", "Input to a delay line"))!,
		parseRefpage(page("cycle~", "MSP Synthesis", "Sinusoidal oscillator"))!,
		parseRefpage(page("delay~", "MSP Delays", "Delay a signal"))!,
	];

	test("finds by meaning, best match first", () => {
		const names = searchIndex(index, "delay line").map((e) => e.name);
		expect(names[0]).toBe("tapin~");
		expect(names).toContain("delay~");
		expect(names).not.toContain("cycle~");
	});

	test("exact name wins", () => {
		expect(searchIndex(index, "cycle~")[0]?.name).toBe("cycle~");
	});

	test("empty query → nothing", () => {
		expect(searchIndex(index, "  ")).toEqual([]);
	});
});

describe("buildIndex", () => {
	test("walks *-ref subfolders", () => {
		const root = mkdtempSync(join(tmpdir(), "refs-"));
		mkdirSync(join(root, "msp-ref"));
		writeFileSync(join(root, "msp-ref", "cycle~.maxref.xml"), page("cycle~", "MSP Synthesis", "Osc"));
		writeFileSync(join(root, "msp-ref", "notes.txt"), "ignore");
		expect(buildIndex(root).map((e) => e.name)).toEqual(["cycle~"]);
		expect(buildIndex(join(root, "missing"))).toEqual([]);
	});
});
