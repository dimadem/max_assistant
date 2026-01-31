import { Tool } from "@effect/ai";
import { Schema } from "effect";

/**
 * Get high-level patch overview
 */
export const GetPatchSummaryTool = Tool.make("getPatchSummary", {
	description:
		"Get high-level patch overview: object counts by type, total connections, has audio I/O. Use FIRST to understand patch structure before detailed queries.",
	success: Schema.String,
});

/**
 * List all objects with optional filter
 */
export const ListObjectsTool = Tool.make("listObjects", {
	description:
		"List all objects in patch. Optionally filter by type. Use to discover what objects exist.",
	parameters: {
		filter: Schema.optional(Schema.String).annotations({
			description:
				"Optional maxclass filter (e.g., 'cycle~', 'slider', 'number')",
		}),
	},
	success: Schema.String,
});

/**
 * Search for object by name or text
 */
export const FindObjectTool = Tool.make("findObject", {
	description:
		"Search for objects by name or text content. Use when user mentions a specific object.",
	parameters: {
		query: Schema.String.annotations({
			description: "Search term (object name, type, or text content)",
		}),
	},
	success: Schema.String,
});

/**
 * Get detailed info about specific object
 */
export const GetObjectDetailsTool = Tool.make("getObjectDetails", {
	description:
		"Get detailed information about specific object by ID: attributes, position, size. Use after finding object with findObject or listObjects.",
	parameters: {
		id: Schema.String.annotations({
			description: "Object varname/ID from previous queries",
		}),
	},
	success: Schema.String,
});

/**
 * Get connections for specific object
 */
export const GetConnectionsTool = Tool.make("getConnections", {
	description:
		"Get all connections (inputs and outputs) for specific object. Use to understand signal flow.",
	parameters: {
		id: Schema.String.annotations({
			description: "Object varname/ID",
		}),
	},
	success: Schema.String,
});

/**
 * Get contents of subpatcher
 */
export const GetSubpatcherTool = Tool.make("getSubpatcher", {
	description:
		"Get contents of subpatcher (p, bpatcher, poly~). Use when user asks about what's inside a subpatcher.",
	parameters: {
		id: Schema.String.annotations({
			description: "Subpatcher object varname/ID",
		}),
	},
	success: Schema.String,
});
