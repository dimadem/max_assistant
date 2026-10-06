/**
 * Static checks on a live patch snapshot, so the agent learns about problems
 * Max only reports in its console (which the agent can't read).
 */

import type { Box, PatchContext } from "./types/max.ts";

export function className(b: Box): string {
	if (b.maxclass === "newobj" || b.maxclass === "jbogus") {
		return b.text.trim().split(/\s+/)[0] || b.maxclass;
	}
	return b.maxclass;
}

const isSignal = (b: Box) => className(b).endsWith("~");
// Feedback through a delay line is legitimate (tapin~ → tapout~ → … → tapin~).
const BREAKS_LOOP = new Set(["tapin~", "tapout~", "delwrite~", "delread~"]);
const loopCarrier = (b: Box | undefined): b is Box => !!b && isSignal(b) && !BREAKS_LOOP.has(className(b));

function signalCycles(ctx: PatchContext): string[][] {
	const byId = new Map(ctx.boxes.map((b) => [b.id, b]));
	const adj = new Map<string, string[]>();
	for (const c of ctx.connections) {
		if (!loopCarrier(byId.get(c.from)) || !loopCarrier(byId.get(c.to))) continue;
		adj.set(c.from, [...(adj.get(c.from) ?? []), c.to]);
	}
	const cycles: string[][] = [];
	const state = new Map<string, "open" | "done">();
	const stack: string[] = [];
	const visit = (n: string) => {
		state.set(n, "open");
		stack.push(n);
		for (const m of adj.get(n) ?? []) {
			if (state.get(m) === "open") cycles.push(stack.slice(stack.indexOf(m)));
			else if (!state.has(m)) visit(m);
		}
		stack.pop();
		state.set(n, "done");
	};
	for (const n of adj.keys()) if (!state.has(n)) visit(n);
	return cycles;
}

export function checkPatch(ctx: PatchContext): string[] {
	const byId = new Map(ctx.boxes.map((b) => [b.id, b]));
	const label = (id: string) => {
		const b = byId.get(id);
		return b ? `${b.id} [${b.text || b.maxclass}]` : id;
	};
	const loops = signalCycles(ctx).map(
		(cycle) =>
			`Signal feedback loop without a delay: ${[...cycle, cycle[0] ?? ""].map(label).join(" → ")}. Max will refuse to run it ("infinite recursion"). Remove a patchcord or put tapin~/tapout~ in the loop.`,
	);
	const bogus = ctx.boxes
		.filter((b) => b.maxclass === "jbogus")
		.map((b) => `${label(b.id)} is not a valid Max object (shown with a dashed border). Find the right name with search_objects.`);
	return [...loops, ...bogus];
}
