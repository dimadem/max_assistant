/**
 * bridge.js — sends the patcher filepath to node.script.
 * assistant.ts reads the .maxpat JSON directly (boxes + lines without patchline API).
 * Runs in [v8] (ES6+).
 */

autowatch = 1;
inlets = 1;
outlets = 1;

// Explicitly register on globalThis so v8 message dispatch can always find it,
// even if the script is loaded as a module where top-level `function` bindings
// don't leak to global scope.
globalThis.getcontext = function () {
	this.patcher.message("write"); // auto-save before reading from disk
	outlet(0, "bridgeResponse", "context", this.patcher.filepath);
};
