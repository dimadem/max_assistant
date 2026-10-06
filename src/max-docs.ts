/**
 * Where Max keeps its documentation, and lookups into it: reference pages
 * (*.maxref.xml), help patches (*.maxhelp), the User Guide database.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildIndex, type ObjectEntry } from "./object-index.ts";

const C74 = "/Applications/Max.app/Contents/Resources/C74";
export const MAX_REFPAGES = `${C74}/docs/refpages`;
export const USERGUIDE_DB = `${C74}/docs/userguide/userguide_search.sqlite`;
const MAX_APP_HELP = `${C74}/help`;
const MAX_USER_ROOTS = [
	join(homedir(), "Documents/Max 9/Library"),
	join(homedir(), "Documents/Max 9/Packages"),
	"/Users/Shared/Max 9/Packages",
];
const REF_DIRS = ["max-ref", "msp-ref", "jit-ref", "m4l-ref"];

export function findHelpPatch(maxclass: string): string | null {
	const filename = `${maxclass}.maxhelp`;

	if (existsSync(MAX_APP_HELP)) {
		try {
			const flat = join(MAX_APP_HELP, filename);
			if (existsSync(flat)) return flat;
			for (const entry of readdirSync(MAX_APP_HELP, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const p = join(MAX_APP_HELP, entry.name, filename);
				if (existsSync(p)) return p;
			}
		} catch {}
	}

	for (const root of MAX_USER_ROOTS) {
		if (!existsSync(root)) continue;
		try {
			for (const entry of readdirSync(root, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const p = join(root, entry.name, "help", filename);
				if (existsSync(p)) return p;
			}
		} catch {}
	}

	return null;
}

export function findRefpage(name: string): string | null {
	for (const dir of REF_DIRS) {
		const p = join(MAX_REFPAGES, dir, `${name}.maxref.xml`);
		if (existsSync(p)) return readFileSync(p, "utf-8");
	}
	return null;
}

let objectIndex: ObjectEntry[] | null = null;
export const getIndex = () => (objectIndex ??= buildIndex(MAX_REFPAGES));
