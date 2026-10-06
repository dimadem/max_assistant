import { expect, test } from "bun:test";
import { hfsToPosix } from "./hfs-path.ts";

const only = (...paths: string[]) => (p: string) => paths.includes(p);

test("boot volume → strip volume name", () => {
	expect(hfsToPosix("Macintosh HD:/Users/a/p.maxpat", only("/Users/a/p.maxpat"))).toBe("/Users/a/p.maxpat");
});

test("external volume → /Volumes/<name>", () => {
	expect(hfsToPosix("localhost:/max/p.maxpat", only("/Volumes/localhost/max/p.maxpat"))).toBe(
		"/Volumes/localhost/max/p.maxpat",
	);
});

test("POSIX path unchanged", () => {
	expect(hfsToPosix("/Users/a/p.maxpat", only())).toBe("/Users/a/p.maxpat");
});
