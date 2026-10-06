/**
 * Auto-layout for create_patch_fragment: objects without x/y are placed
 * top-to-bottom by signal flow (depth = longest path from a source) and
 * left-to-right within a row, below whatever is already in the patch.
 */

import type { PatchContext } from "./types/max.ts";

interface Placeable {
	name: string;
	x?: number;
	y?: number;
}
interface Edge {
	from: string;
	to: string;
}

const COL = 150;
const ROW = 50;
const MARGIN = 40;

export function originBelow(ctx: PatchContext): { x: number; y: number } {
	if (ctx.boxes.length === 0) return { x: MARGIN, y: MARGIN };
	const x = Math.min(...ctx.boxes.map((b) => b.rect[0]));
	const bottom = Math.max(...ctx.boxes.map((b) => b.rect[1] + b.rect[3]));
	return { x: Math.max(x, MARGIN), y: bottom + MARGIN };
}

export function layout<T extends Placeable>(
	objects: T[],
	edges: Edge[],
	origin: { x: number; y: number },
): (T & { x: number; y: number })[] {
	const names = new Set(objects.map((o) => o.name));
	const local = edges.filter((e) => names.has(e.from) && names.has(e.to) && e.from !== e.to);

	// longest-path depth, bounded to tolerate cycles
	const depth = new Map(objects.map((o) => [o.name, 0]));
	for (let pass = 0; pass < objects.length; pass++) {
		let changed = false;
		for (const e of local) {
			const d = (depth.get(e.from) ?? 0) + 1;
			if (d > (depth.get(e.to) ?? 0) && d < objects.length) {
				depth.set(e.to, d);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const colInRow = new Map<number, number>();
	return objects.map((o) => {
		const d = depth.get(o.name) ?? 0;
		const col = colInRow.get(d) ?? 0;
		colInRow.set(d, col + 1);
		return {
			...o,
			x: o.x ?? origin.x + col * COL,
			y: o.y ?? origin.y + d * ROW,
		};
	});
}
