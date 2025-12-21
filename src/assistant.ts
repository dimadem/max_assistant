import "./utils/envSetup.js";
import { Effect } from "effect";
import Max from "max-api";
import {
	clearHistory,
	generateResponse,
	handleBridgeResponse,
} from "./modules/agent.js";
import { model, OpenAiWithHttp } from "./utils/config.js";

// Send command to bridge.js
const toBridge = (...args: (string | number | boolean)[]) => {
	Max.outlet("bridge", ...args);
};

Max.addHandlers({
	string: (prompt: string) => {
		generateResponse(prompt)
			.pipe(
				Effect.provide(model),
				Effect.provide(OpenAiWithHttp),
				Effect.runPromise,
			)
			.then((text) => {
				Max.post(`Assistant: ${text}`);
			})
			.catch((error) => {
				Max.post(`Error: ${error.message}`);
			});
	},
	// Responses from bridge.js (context, object, list)
	bridgeResponse: (type: string, ...data: unknown[]) => {
		Max.post(`Bridge response: ${type}`);
		if (data[0]) {
			try {
				const parsed = JSON.parse(data[0] as string);
				handleBridgeResponse(type, parsed);
			} catch (e) {
				Max.post(`Failed to parse bridge response: ${e}`);
			}
		}
	},
	clear: () => {
		clearHistory
			.pipe(Effect.runPromise)
			.then(() => Max.post("History cleared"))
			.catch((error) => Max.post(error.message));
	},
});

// Export for use in tools
export { toBridge };
