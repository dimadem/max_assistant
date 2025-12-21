import { Chat, Prompt, Tool, Toolkit } from "@effect/ai";
import { Deferred, Effect, Ref, Schema } from "effect";
import Max from "max-api";

// =============================================================================
// DATA TYPES
// =============================================================================

interface PatchContext {
	boxes: Array<{
		id: string;
		maxclass: string;
		text: string;
		rect: number[];
		numinlets: number;
		numoutlets: number;
	}>;
	lines: Array<{
		src: [number, number];
		dst: [number, number];
	}>;
}


interface ListItem {
	id: string;
	maxclass: string;
	text: string;
}

// =============================================================================
// BRIDGE RESPONSE WAITING MECHANISM
// =============================================================================

type BridgeResponseType = "context" | "object" | "list";

const pendingRequests = new Map<
	BridgeResponseType,
	Deferred.Deferred<unknown>
>();

// Called from assistant.ts when bridge sends response
export const handleBridgeResponse = (type: string, data: unknown) => {
	Max.post(`handleBridgeResponse: type=${type}, pending=${pendingRequests.size}`);
	const deferred = pendingRequests.get(type as BridgeResponseType);
	if (deferred) {
		Max.post(`handleBridgeResponse: resolving deferred for ${type}`);
		Effect.runSync(Deferred.succeed(deferred, data));
		pendingRequests.delete(type as BridgeResponseType);
	} else {
		Max.post(`handleBridgeResponse: no pending request for ${type}`);
	}
};

// Send command to bridge and wait for response
const sendToBridgeAndWait = <T>(
	command: string,
	responseType: BridgeResponseType,
	...args: (string | number)[]
) =>
	Effect.gen(function* () {
		const deferred = yield* Deferred.make<T>();
		pendingRequests.set(responseType, deferred as Deferred.Deferred<unknown>);

		Max.outlet("bridge", command, ...args);

		return yield* Deferred.await(deferred);
	});


// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const GetPatchContextTool = Tool.make("getPatchContext", {
	description:
		"Get ALL patch objects and connections. Use only when you need a complete overview of the entire patch.",
	success: Schema.String,
});

const ListObjectsTool = Tool.make("listObjects", {
	description:
		"Get a brief list of all objects. Use when you need to know what objects are in the patch.",
	success: Schema.String,
});

const FindObjectTool = Tool.make("findObject", {
	description:
		"SEARCH for a specific object by name or type. Use when user asks about a specific object: 'find cycle~', 'tell me about slider', 'what does route do'.",
	parameters: {
		query: Schema.String.annotations({
			description: "Name or type of object to search for (e.g.: cycle~, slider, route)",
		}),
	},
	success: Schema.String,
});

// Create toolkit with all tools
const toolkit = Toolkit.make(
	GetPatchContextTool,
	ListObjectsTool,
	FindObjectTool,
);

// Create chat once at startup
const chatRef = Effect.runSync(
	Effect.map(Ref.make<Chat.Service | null>(null), (ref) => ref),
);

const getOrCreateChat = Effect.gen(function* () {
	const existing = yield* Ref.get(chatRef);
	if (existing) return existing;

	const chat = yield* Chat.empty;
	yield* Ref.set(chatRef, chat);
	return chat;
});

// =============================================================================
// TOOLS
// =============================================================================

// Tool for getting patch context (all objects and connections)
const getPatchContextHandler = () =>
	Effect.gen(function* () {
		Max.post("Tool getPatchContext: requesting...");
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);
		Max.post(`Tool getPatchContext: received ${context.boxes?.length} boxes`);
		return JSON.stringify(context, null, 2);
	});

// Tool for getting list of objects with varname
const getListHandler = () =>
	Effect.gen(function* () {
		Max.post("Tool listObjects: requesting...");
		const list = yield* sendToBridgeAndWait<ListItem[]>("list", "list");
		return JSON.stringify(list, null, 2);
	});

// Tool for finding object by type/text
const findObjectHandler = (params: { query: string }) =>
	Effect.gen(function* () {
		Max.post(`Tool findObject: searching for "${params.query}"...`);

		// Get patch context
		const context = yield* sendToBridgeAndWait<PatchContext>(
			"getcontext",
			"context",
		);

		const query = params.query.toLowerCase();

		// Search by maxclass or text
		const found = context.boxes.filter((box) => {
			const maxclass = box.maxclass.toLowerCase();
			const text = box.text.toLowerCase();
			return maxclass.includes(query) || text.includes(query);
		});

		if (found.length === 0) {
			return `Objects matching "${params.query}" not found`;
		}

		return JSON.stringify(found, null, 2);
	});

// Layer with handlers
const ToolHandlersLayer = toolkit.toLayer({
	getPatchContext: getPatchContextHandler,
	listObjects: getListHandler,
	findObject: findObjectHandler,
});

export const generateResponse = (prompt: string) =>
	Effect.gen(function* () {
		const chat = yield* getOrCreateChat;

		// First call with tools
		let response = yield* chat.generateText({
			prompt,
			toolkit,
		});

		// If model called a tool, make another request to get text response
		const hasToolCall = response.content.some(
			(part) => part.type === "tool-result",
		);

		if (hasToolCall && !response.text) {
			Max.post("Tool was called, generating final response...");
			response = yield* chat.generateText({
				prompt: "Describe the result in Russian.",
			});
		}

		return response.text;
	}).pipe(Effect.provide(ToolHandlersLayer));

export const clearHistory = Effect.gen(function* () {
	const chat = yield* Ref.get(chatRef);
	if (chat) {
		yield* Ref.set(chat.history, Prompt.empty);
	}
});
