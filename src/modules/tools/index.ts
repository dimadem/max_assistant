import { Toolkit } from "@effect/ai";
import {
	FindObjectTool,
	GetConnectionsTool,
	GetObjectDetailsTool,
	GetPatchSummaryTool,
	GetSubpatcherTool,
	ListObjectsTool,
} from "./definitions";
import {
	findObjectHandler,
	getConnectionsHandler,
	getObjectDetailsHandler,
	getPatchSummaryHandler,
	getSubpatcherHandler,
	listObjectsHandler,
} from "./handlers";

/**
 * Toolkit with all read-only tools for Max MSP patch analysis
 */
export const toolkit = Toolkit.make(
	GetPatchSummaryTool,
	ListObjectsTool,
	FindObjectTool,
	GetObjectDetailsTool,
	GetConnectionsTool,
	GetSubpatcherTool,
);

/**
 * Layer providing tool handler implementations
 */
export const ToolHandlersLayer = toolkit.toLayer({
	getPatchSummary: getPatchSummaryHandler,
	listObjects: listObjectsHandler,
	findObject: findObjectHandler,
	getObjectDetails: getObjectDetailsHandler,
	getConnections: getConnectionsHandler,
	getSubpatcher: getSubpatcherHandler,
});
