/**
 * Read a `.maxpat` from disk and write a normalised `patch-context.json`.
 * Shared by `bridgeResponse` (initial context fetch) and `commandSynced`
 * (after a successful MCP-driven mutation).
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
	convertMaxpat,
	type PatchContext,
	type RawMaxpat,
} from "./types/max.ts";

export function syncContext(
	maxpatPath: string,
	contextPath: string,
): PatchContext {
	const raw = JSON.parse(readFileSync(maxpatPath, "utf-8")) as RawMaxpat;
	const ctx = convertMaxpat(raw);
	writeFileSync(contextPath, JSON.stringify(ctx, null, 2));
	return ctx;
}
