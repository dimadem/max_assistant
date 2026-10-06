/**
 * Contract between the MCP server and [v8 bridge.js] (via the HTTP bridge in
 * [node.script]). bridge.js is plain JS, so this file is the source of truth:
 * keep its `handlers` in sync with `BridgeCommands`.
 */

import type { Connection, PatchContext } from "./max.ts";

export interface BridgeInfo {
	port: number;
	token: string;
}

export type Atom = string | number;
export type BoxKind = "object" | "message" | "comment";

/** A box ready for v8: tokenised atoms + the original text (shown for message boxes). */
export interface BoxSpec {
	box: BoxKind;
	atoms: Atom[];
	text: string;
}

interface Cord {
	srcId: string;
	srcOutlet: number;
	dstId: string;
	dstInlet: number;
}

type Empty = Record<string, never>;

export interface BridgeCommands {
	get_context: { params: Empty; result: { context: PatchContext; note?: string } };
	create_object: { params: BoxSpec & { x: number; y: number; varname?: string }; result: { id: string; maxclass: string } };
	connect_objects: { params: Cord; result: Empty };
	disconnect_objects: { params: Cord; result: Empty };
	delete_object: { params: { id: string }; result: Empty };
	create_fragment: {
		params: { objects: (BoxSpec & { name: string; x: number; y: number })[]; connections: Connection[] };
		result: { objects: { name: string; id: string }[]; connected: number; errors: string[] };
	};
}
export type BridgeCommand = keyof BridgeCommands;

/** Mutations also carry a fresh `context`. On failure the result fields may be partial. */
export type BridgeReply<K extends BridgeCommand> = { ok: boolean; error?: string; context?: PatchContext } & Partial<
	BridgeCommands[K]["result"]
>;
