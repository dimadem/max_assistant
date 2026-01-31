import { Effect } from "effect";
import Max from "max-api";
import { type PatchContext, sendToBridgeAndWait } from "../bridge";

// =============================================================================
// HANDLER IMPLEMENTATIONS
// =============================================================================

/**
 * Get high-level patch summary
 */
export const getPatchSummaryHandler = () =>
	Effect.gen(function* () {
		Max.post("Tool getPatchSummary: requesting...");
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		// Compute summary from full context
		const typeCounts = new Map<string, number>();
		for (const box of context.boxes) {
			const count = typeCounts.get(box.maxclass) || 0;
			typeCounts.set(box.maxclass, count + 1);
		}

		const summary = {
			totalObjects: context.boxes.length,
			totalConnections: context.lines.length,
			objectsByType: Object.fromEntries(typeCounts),
			hasAudioInput: context.boxes.some((b) => b.maxclass === "adc~"),
			hasAudioOutput: context.boxes.some((b) => b.maxclass === "dac~"),
			subpatchers: context.boxes
				.filter((b) => ["patcher", "bpatcher", "poly~"].includes(b.maxclass))
				.map((b) => b.id),
		};

		Max.post(`Tool getPatchSummary: ${summary.totalObjects} objects`);
		return JSON.stringify(summary, null, 2);
	});

/**
 * List objects with optional filter
 */
export const listObjectsHandler = (params: { filter?: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool listObjects: filter=${params.filter || "none"}`);
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		let boxes = context.boxes;

		if (params.filter) {
			const filter = params.filter.toLowerCase();
			boxes = boxes.filter((b) => b.maxclass.toLowerCase().includes(filter));
		}

		const list = boxes.map((b) => ({
			id: b.id,
			type: b.maxclass,
			text: b.text,
		}));

		Max.post(`Tool listObjects: found ${list.length} objects`);
		return JSON.stringify(list, null, 2);
	});

/**
 * Find object by query
 */
export const findObjectHandler = (params: { query: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool findObject: searching for "${params.query}"...`);
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		const query = params.query.toLowerCase();

		const found = context.boxes.filter((box) => {
			const maxclass = box.maxclass.toLowerCase();
			const text = box.text.toLowerCase();
			const id = box.id.toLowerCase();
			return (
				maxclass.includes(query) || text.includes(query) || id.includes(query)
			);
		});

		if (found.length === 0) {
			return `Objects matching "${params.query}" not found`;
		}

		Max.post(`Tool findObject: found ${found.length} matches`);
		return JSON.stringify(found, null, 2);
	});

/**
 * Get detailed info about specific object
 */
export const getObjectDetailsHandler = (params: { id: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool getObjectDetails: id="${params.id}"`);
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		const obj = context.boxes.find((b) => b.id === params.id);

		if (!obj) {
			return JSON.stringify({ error: `Object "${params.id}" not found` });
		}

		const details = {
			id: obj.id,
			type: obj.maxclass,
			text: obj.text,
			position: [obj.rect[0], obj.rect[1]],
			size: [obj.rect[2] - obj.rect[0], obj.rect[3] - obj.rect[1]],
			inlets: obj.numinlets,
			outlets: obj.numoutlets,
		};

		return JSON.stringify(details, null, 2);
	});

/**
 * Get connections for specific object
 */
export const getConnectionsHandler = (params: { id: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool getConnections: id="${params.id}"`);
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		const objIndex = context.boxes.findIndex((b) => b.id === params.id);

		if (objIndex === -1) {
			return JSON.stringify({ error: `Object "${params.id}" not found` });
		}

		const obj = context.boxes[objIndex];

		// Find incoming connections (where this object is destination)
		const inputs = context.lines
			.filter((l) => l.dst[0] === objIndex)
			.map((l) => ({
				fromObject: context.boxes[l.src[0]]?.id,
				fromOutlet: l.src[1],
				toInlet: l.dst[1],
			}));

		// Find outgoing connections (where this object is source)
		const outputs = context.lines
			.filter((l) => l.src[0] === objIndex)
			.map((l) => ({
				toObject: context.boxes[l.dst[0]]?.id,
				fromOutlet: l.src[1],
				toInlet: l.dst[1],
			}));

		return JSON.stringify(
			{
				object: { id: obj.id, type: obj.maxclass, text: obj.text },
				inputs,
				outputs,
			},
			null,
			2,
		);
	});

/**
 * Get subpatcher contents
 */
export const getSubpatcherHandler = (params: { id: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool getSubpatcher: id="${params.id}"`);

		const subContext = yield* sendToBridgeAndWait<
			PatchContext | { error: string }
		>("getsubpatcher", "subpatcher", params.id);

		if ("error" in subContext) {
			return JSON.stringify(subContext);
		}

		return JSON.stringify(subContext, null, 2);
	});
