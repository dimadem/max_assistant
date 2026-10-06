import { describe, expect, test } from "bun:test";
import { toAtoms, toBoxSpec } from "./box-spec.ts";

describe("toAtoms", () => {
	test("numbers become numbers, words stay symbols", () => {
		expect(toAtoms("prepend 1.5 abc -2 .5 1e3")).toEqual(["prepend", 1.5, "abc", -2, 0.5, 1000]);
	});
	test("number-like symbols stay symbols", () => {
		expect(toAtoms("foo 0x10 inf 1.2.3")).toEqual(["foo", "0x10", "inf", "1.2.3"]);
	});
	test("whitespace collapses; empty → []", () => {
		expect(toAtoms("   cycle~    440 ")).toEqual(["cycle~", 440]);
		expect(toAtoms("   ")).toEqual([]);
	});
	test("commas and semicolons are separate atoms only on request", () => {
		expect(toAtoms("1 10, 0 500;", true)).toEqual([1, 10, ",", 0, 500, ";"]);
		expect(toAtoms("1 10, 0", false)).toEqual([1, "10,", 0]);
	});
});

describe("toBoxSpec", () => {
	test("plain object text", () => {
		expect(toBoxSpec("cycle~ 440")).toEqual({ box: "object", atoms: ["cycle~", 440], text: "cycle~ 440" });
	});
	test("explicit message box splits commas into atoms", () => {
		expect(toBoxSpec("1 10, 0 500", "message")).toEqual({
			box: "message",
			atoms: [1, 10, ",", 0, 500],
			text: "1 10, 0 500",
		});
	});
	test("'message …' prefix implies a message box", () => {
		expect(toBoxSpec("message 1 10, 0 500")).toMatchObject({ box: "message", text: "1 10, 0 500" });
	});
	test("comment box", () => {
		expect(toBoxSpec("comment volume")).toMatchObject({ box: "comment", text: "volume" });
		expect(toBoxSpec("press to play", "comment")).toMatchObject({ box: "comment", text: "press to play" });
	});
	test("explicit box + redundant prefix", () => {
		expect(toBoxSpec("message bang", "message")).toMatchObject({ box: "message", atoms: ["bang"] });
	});
	test("explicit comment keeps a leading 'message' word", () => {
		expect(toBoxSpec("message rate", "comment")).toMatchObject({ box: "comment", text: "message rate" });
	});
});
