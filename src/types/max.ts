/**
 * Max MSP patch types.
 * Covers the .maxpat JSON format and the context passed to MCP tools.
 */

/** [x, y, width, height] in pixels */
export type Rect = [number, number, number, number];

/** [objectIndex, portNumber] */
export type Port = [number, number];

/** A single object (box) in the patch */
export interface Box {
	/** varname if set, otherwise the internal id (e.g. "obj-2") */
	id: string;
	/** Object type, e.g. "newobj", "message", "button", "cycle~" */
	maxclass: string;
	/** Full text as typed in the box, e.g. "prepend string" */
	text: string;
	rect: Rect;
	numinlets: number;
	numoutlets: number;
}

/** A patchcord between two boxes */
export interface Connection {
	src: Port;
	dst: Port;
}

/** Patch context written to disk and read by MCP tools */
export interface PatchContext {
	boxes: Box[];
	lines: Connection[];
}

// ---------------------------------------------------------------------------
// .maxpat JSON shape (raw file format, before conversion)
// ---------------------------------------------------------------------------

interface RawBox {
	id: string;
	varname?: string;
	maxclass: string;
	text?: string;
	patching_rect: Rect;
	numinlets: number;
	numoutlets: number;
}

interface RawPatchline {
	source: [string, number];
	destination: [string, number];
}

interface RawPatcher {
	boxes: { box: RawBox }[];
	lines: { patchline: RawPatchline }[];
}

export interface RawMaxpat {
	patcher: RawPatcher;
}

/** Convert a parsed .maxpat JSON into PatchContext */
export function convertMaxpat(raw: RawMaxpat): PatchContext {
	const idToIndex = new Map<string, number>();

	const boxes: Box[] = raw.patcher.boxes.map((entry, i) => {
		const b = entry.box;
		idToIndex.set(b.id, i);
		return {
			id: b.varname ?? b.id,
			maxclass: b.maxclass,
			text: b.text ?? "",
			rect: b.patching_rect,
			numinlets: b.numinlets,
			numoutlets: b.numoutlets,
		};
	});

	const lines: Connection[] = [];
	for (const entry of raw.patcher.lines) {
		const pl = entry.patchline;
		const srcIdx = idToIndex.get(pl.source[0]);
		const dstIdx = idToIndex.get(pl.destination[0]);
		if (srcIdx !== undefined && dstIdx !== undefined) {
			lines.push({
				src: [srcIdx, pl.source[1]],
				dst: [dstIdx, pl.destination[1]],
			});
		}
	}

	return { boxes, lines };
}
