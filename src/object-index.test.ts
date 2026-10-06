import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, parseRefpage, refpageItem, searchIndex, summarizeRefpage } from "./object-index.ts";

const page = (name: string, category: string, digest: string, desc = "") => `<?xml version="1.0" encoding="utf-8"?>
<c74object name="${name}" module="msp" category="${category}">
	<digest>${digest}</digest>
	<description>${desc}</description>
	<metadatalist><metadata name="tag">MSP</metadata><metadata name="tag">
			oscillator
		</metadata></metadatalist>
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
			tags: ["oscillator"],
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

test("tags make objects findable by role", () => {
	const idx = [parseRefpage(page("rect~", "MSP Synthesis", "Antialiased rectangular wave"))!];
	expect(searchIndex(idx, "oscillator")[0]?.name).toBe("rect~");
});

test("summarizeRefpage on a real-shaped page", () => {
	const xml = `<c74object name="cycle~" module="msp" category="MSP Synthesis">
	<digest>Sinusoidal oscillator</digest><description>Use cycle~.</description>
	<inletlist><inlet id="0" type="signal/float"><digest>Frequency</digest></inlet><inlet id="1" type="signal/float"><digest>Phase (0-1)</digest></inlet></inletlist>
	<outletlist><outlet id="0" type="signal"><digest>Output</digest></outlet></outletlist>
	<objarglist><objarg name="frequency" optional="1" type="number"><digest>Oscillator frequency</digest></objarg></objarglist>
	<methodlist><method name="float"><digest>Set frequency</digest></method><method name="(mouse)"><digest>x</digest></method></methodlist>
	<attributelist><attribute name="buffer" type="symbol"><digest>Buffer name</digest>
		<attributelist><attribute name="label" type="symbol" value="External buffer~" /></attributelist>
	</attribute><attribute name="phase" type="float"><digest>Phase</digest></attribute></attributelist>
	<seealsolist><seealso name="wave~"/></seealsolist></c74object>`;
	const s = summarizeRefpage(xml)!;
	expect(s.inlets).toEqual([
		{ id: 0, type: "signal/float", digest: "Frequency" },
		{ id: 1, type: "signal/float", digest: "Phase (0-1)" },
	]);
	expect(s.outlets).toEqual([{ id: 0, type: "signal", digest: "Output" }]);
	expect(s.arguments).toEqual([{ name: "frequency", type: "number", optional: true, digest: "Oscillator frequency" }]);
	expect(s.messages).toEqual([{ name: "float", digest: "Set frequency" }]);
	expect(s.attributes.map((a) => a.name)).toEqual(["buffer", "phase"]);
	expect(s.seealso).toEqual(["wave~"]);
});

test("refpageItem returns full text of one message", () => {
	const xml = `<c74object name="x"><methodlist><method name="mode"><arglist><arg name="type" type="int" /></arglist>
	<digest>Set filter type</digest><description>0 = display, 1 = lowpass, 6 = lowshelf</description></method></methodlist></c74object>`;
	const t = refpageItem(xml, "mode")!;
	expect(t).toContain("method mode (type:int)");
	expect(t).toContain("6 = lowshelf");
	expect(refpageItem(xml, "nope")).toBeNull();
});
