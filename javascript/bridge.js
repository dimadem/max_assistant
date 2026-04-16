/**
 * bridge.js — sends the patcher filepath to node.script.
 * assistant.ts reads the .maxpat JSON directly (boxes + lines without patchline API).
 * Runs in [v8] (ES6+).
 */

autowatch = 1;
inlets = 1;
outlets = 1;

post("bridge.js v3 loaded\n");

// Walk up the patcher hierarchy to the top-level. Docs say `parentpatcher`
// is undefined for top-level patchers, but in practice v8 also returns null
// — truthy check handles both.
function topLevel(p) {
	while (p.parentpatcher) {
		p = p.parentpatcher;
	}
	return p;
}

function getcontext() {
	// When the assistant patcher is used as an abstraction/bpatcher inside another
	// patcher, this.patcher points to the abstraction itself. We want to
	// analyse the host patcher, so walk up to its top-level.
	var target = topLevel(this.patcher);
	target.message("write"); // auto-save before reading from disk
	outlet(0, "bridgeResponse", "context", target.filepath);
}

// Register both ways so v8 dispatch finds the function regardless of whether
// top-level `function` declarations leak to global scope in this runtime.
globalThis.getcontext = getcontext;
