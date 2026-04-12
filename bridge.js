/**
 * bridge.js — sends the patcher filepath to node.script.
 * assistant.ts reads the .maxpat JSON directly (boxes + lines without patchline API).
 * Runs in [v8] (ES6+).
 */

autowatch = 1;
inlets = 1;
outlets = 1;

// biome-ignore lint/correctness/noUnusedVariables: called by Max automatically
function getcontext() {
	this.patcher.message("write"); // auto-save before reading from disk
	outlet(0, "bridgeResponse", "context", this.patcher.filepath);
}
