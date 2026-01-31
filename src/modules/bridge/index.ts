import { Deferred, Effect } from "effect";
import Max from "max-api";

// =============================================================================
// TYPES
// =============================================================================

export type BridgeResponseType = "context" | "object" | "list" | "subpatcher";

export interface BoxInfo {
	id: string;
	maxclass: string;
	text: string;
	rect: [number, number, number, number];
	numinlets: number;
	numoutlets: number;
}

export interface LineInfo {
	src: [number, number]; // [objectIndex, outletNumber]
	dst: [number, number]; // [objectIndex, inletNumber]
}

export interface PatchContext {
	boxes: BoxInfo[];
	lines: LineInfo[];
}

// =============================================================================
// DEFERRED REQUEST MANAGEMENT
// =============================================================================

const pendingRequests = new Map<
	BridgeResponseType,
	Deferred.Deferred<unknown>
>();

/**
 * Handle response from Max bridge
 * Called from assistant.ts when bridge sends response
 */
export const handleBridgeResponse = (type: string, data: unknown) => {
	Max.post(
		`handleBridgeResponse: type=${type}, pending=${pendingRequests.size}`,
	);
	const deferred = pendingRequests.get(type as BridgeResponseType);
	if (deferred) {
		Max.post(`handleBridgeResponse: resolving deferred for ${type}`);
		Effect.runSync(Deferred.succeed(deferred, data));
		pendingRequests.delete(type as BridgeResponseType);
	} else {
		Max.post(`handleBridgeResponse: no pending request for ${type}`);
	}
};

/**
 * Send command to bridge and wait for response
 */
export const sendToBridgeAndWait = <T>(
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
