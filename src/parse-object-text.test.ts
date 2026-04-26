import { describe, expect, test } from "bun:test";
import { parseObjectText } from "./parse-object-text.ts";

describe("parseObjectText", () => {
	test("classname with single numeric arg", () => {
		expect(parseObjectText("cycle~ 440")).toEqual({
			classname: "cycle~",
			args: [440],
		});
	});

	test("classname only", () => {
		expect(parseObjectText("button")).toEqual({
			classname: "button",
			args: [],
		});
	});

	test("string args", () => {
		expect(parseObjectText("message foo bar")).toEqual({
			classname: "message",
			args: ["foo", "bar"],
		});
	});

	test("mixed numeric and string args", () => {
		expect(parseObjectText("prepend 1.5 abc")).toEqual({
			classname: "prepend",
			args: [1.5, "abc"],
		});
	});

	test("empty string", () => {
		expect(parseObjectText("")).toEqual({ classname: "", args: [] });
	});

	test("only whitespace", () => {
		expect(parseObjectText("   ")).toEqual({ classname: "", args: [] });
	});

	test("leading whitespace", () => {
		expect(parseObjectText("   button")).toEqual({
			classname: "button",
			args: [],
		});
	});

	test("multiple spaces between tokens collapse", () => {
		expect(parseObjectText("cycle~    440")).toEqual({
			classname: "cycle~",
			args: [440],
		});
	});

	test("integer args are numbers", () => {
		expect(parseObjectText("delay 250")).toEqual({
			classname: "delay",
			args: [250],
		});
	});

	test("non-numeric tokens stay as strings", () => {
		expect(parseObjectText("route foo bar baz")).toEqual({
			classname: "route",
			args: ["foo", "bar", "baz"],
		});
	});
});
