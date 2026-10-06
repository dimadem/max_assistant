/**
 * Validate the live-patch snapshot sent by [v8 bridge.js] and persist it to
 * `patch-context.json` for the MCP server (a separate process) to read.
 */

import { writeFileSync } from "node:fs";
import type { PatchContext } from "./types/max.ts";

export function parseContext(json: string): PatchContext {
	const ctx = JSON.parse(json) as Partial<PatchContext>;
	if (!Array.isArray(ctx.boxes) || !Array.isArray(ctx.lines)) {
		throw new Error("bridge sent malformed context (missing boxes/lines)");
	}
	return { patch: ctx.patch, boxes: ctx.boxes, lines: ctx.lines };
}

export function writeContext(json: string, contextPath: string): PatchContext {
	const ctx = parseContext(json);
	writeFileSync(contextPath, JSON.stringify(ctx, null, 2));
	return ctx;
}
