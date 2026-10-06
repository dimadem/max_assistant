/**
 * Static checks on a live patch snapshot, so the agent learns about problems
 * Max only reports in its console (which the agent can't read).
 */

import type { PatchContext } from "./types/max.ts";

type Box = PatchContext["boxes"][number];

export function className(b: Box): string {
	if (b.maxclass === "newobj" || b.maxclass === "jbogus") {
		return b.text.trim().split(/\s+/)[0] ?? b.maxclass;
	}
	return b.maxclass;
}

const isSignal = (b: Box) => className(b).endsWith("~");
// Feedback through a delay line is legitimate (tapin~ → tapout~ → … → tapin~).
const BREAKS_LOOP = new Set(["tapin~", "tapout~", "delwrite~", "delread~"]);

function signalCycles(ctx: PatchContext): number[][] {
	const adj = new Map<number, number[]>();
	for (const l of ctx.lines) {
		const a = ctx.boxes[l.src[0]];
		const b = ctx.boxes[l.dst[0]];
		if (!a || !b || !isSignal(a) || !isSignal(b)) continue;
		if (BREAKS_LOOP.has(className(a)) || BREAKS_LOOP.has(className(b))) continue;
		adj.set(l.src[0], [...(adj.get(l.src[0]) ?? []), l.dst[0]]);
	}
	const cycles: number[][] = [];
	const state = new Map<number, 1 | 2>(); // 1 = on stack, 2 = done
	const stack: number[] = [];
	const visit = (n: number) => {
		state.set(n, 1);
		stack.push(n);
		for (const m of adj.get(n) ?? []) {
			if (state.get(m) === 1) cycles.push(stack.slice(stack.indexOf(m)));
			else if (!state.has(m)) visit(m);
		}
		stack.pop();
		state.set(n, 2);
	};
	for (const n of adj.keys()) if (!state.has(n)) visit(n);
	return cycles;
}

export function checkPatch(ctx: PatchContext): string[] {
	const warnings: string[] = [];
	const label = (i: number) => {
		const b = ctx.boxes[i];
		return b ? `${b.id} [${b.text || b.maxclass}]` : `#${i}`;
	};
	for (const cycle of signalCycles(ctx)) {
		warnings.push(
			`Signal feedback loop without a delay: ${[...cycle, cycle[0] ?? 0].map(label).join(" → ")}. Max will refuse to run it ("infinite recursion"). Remove a patchcord or put tapin~/tapout~ in the loop.`,
		);
	}
	ctx.boxes.forEach((b, i) => {
		if (b.maxclass === "jbogus") {
			warnings.push(`${label(i)} is not a valid Max object (shown with a dashed border). Find the right name with search_objects.`);
		}
	});
	return warnings;
}
