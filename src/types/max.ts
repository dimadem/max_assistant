/**
 * Max MSP patch types.
 * Covers the .maxpat JSON format and the patch snapshot used by MCP tools.
 * Connections reference boxes by id — the same shape the model sees.
 */

/** [x, y, width, height] in pixels */
type Rect = [number, number, number, number];

/** A single object (box) in the patch */
export interface Box {
	/** varname if set, otherwise a stable id (e.g. "obj-2") */
	id: string;
	/** Object type, e.g. "newobj", "message", "button", "cycle~" */
	maxclass: string;
	/** Full text as typed in the box, e.g. "prepend string" */
	text: string;
	rect: Rect;
	/** Known for .maxpat files (help patches); not readable from a live [v8] patch */
	numinlets?: number;
	numoutlets?: number;
	/** Selected by the user in the patcher (live patch only) */
	selected?: boolean;
}

/** A patchcord `from:outlet → to:inlet` (box ids) */
export interface Connection {
	from: string;
	outlet: number;
	to: string;
	inlet: number;
}

export interface PatchContext {
	/** Window title of the patch the assistant is editing (live snapshots only) */
	patch?: string;
	boxes: Box[];
	connections: Connection[];
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

export interface RawMaxpat {
	patcher: {
		boxes: { box: RawBox }[];
		lines: { patchline: RawPatchline }[];
	};
}

/** Convert a parsed .maxpat JSON into PatchContext (varname wins as id). */
export function convertMaxpat(raw: RawMaxpat): PatchContext {
	const idOf = new Map(raw.patcher.boxes.map(({ box: b }) => [b.id, b.varname ?? b.id]));
	return {
		boxes: raw.patcher.boxes.map(({ box: b }) => ({
			id: idOf.get(b.id) ?? b.id,
			maxclass: b.maxclass,
			text: b.text ?? "",
			rect: b.patching_rect,
			numinlets: b.numinlets,
			numoutlets: b.numoutlets,
		})),
		connections: raw.patcher.lines.flatMap(({ patchline: { source, destination } }) => {
			const from = idOf.get(source[0]);
			const to = idOf.get(destination[0]);
			return from && to ? [{ from, outlet: source[1], to, inlet: destination[1] }] : [];
		}),
	};
}
