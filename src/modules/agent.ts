import { Chat, Prompt } from "@effect/ai";
import { Effect, Ref } from "effect";
import Max from "max-api";
import { SYSTEM_PROMPT } from "./chat/systemPrompt";
import { ToolHandlersLayer, toolkit } from "./tools";

// Re-export bridge handler for assistant.ts
export { handleBridgeResponse } from "./bridge";

// =============================================================================
// CHAT HISTORY MANAGEMENT
// =============================================================================

const chatRef = Effect.runSync(
	Effect.map(Ref.make<Chat.Service | null>(null), (ref) => ref),
);

const getOrCreateChat = Effect.gen(function* () {
	const existing = yield* Ref.get(chatRef);
	if (existing) return existing;

	const chat = yield* Chat.empty;

	// Add system message to history
	yield* Ref.update(chat.history, (h) =>
		Prompt.concat(
			h,
			Prompt.make([
				{
					_tag: "system",
					content: SYSTEM_PROMPT,
				},
			]),
		),
	);

	yield* Ref.set(chatRef, chat);
	return chat;
});

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Generate response for user prompt using AI with tools
 */
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
				prompt: "Describe the result based on the user's language.",
			});
		}

		return response.text;
	}).pipe(Effect.provide(ToolHandlersLayer));

/**
 * Clear chat history
 */
export const clearHistory = Effect.gen(function* () {
	const chat = yield* Ref.get(chatRef);
	if (chat) {
		yield* Ref.set(chat.history, Prompt.empty);
	}
});

/**
 * Export chat history as JSON
 */
export const exportHistory = Effect.gen(function* () {
	const chat = yield* Ref.get(chatRef);
	if (!chat) return null;
	return yield* chat.exportJson;
});
