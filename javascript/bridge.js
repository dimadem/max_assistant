/**
 * bridge.js — runs in [v8].
 *
 * Two responsibilities:
 *   1. `getcontext` — save the live patcher and return its filepath so
 *      assistant.ts can read the .maxpat from disk.
 *   2. Command channel — poll `<root>/commands.ndjson` (~150 ms),
 *      execute each new line via the Patcher API, write a result back
 *      via outlet `commandSynced`. assistant.ts then re-syncs
 *      patch-context.json and appends to command-results.ndjson.
 */

autowatch = 1;
inlets = 1;
outlets = 1;

post("bridge.js v5 loaded\n");

// ---------- shared helpers ----------------------------------------------

function topLevel(p) {
	let cur = p;
	while (cur.parentpatcher) cur = cur.parentpatcher;
	return cur;
}

// ---------- getcontext (existing handler) -------------------------------

function getcontext() {
	const target = topLevel(this.patcher);
	target.message("write"); // auto-save before reading from disk
	outlet(0, "bridgeResponse", "context", target.filepath);
}

// ---------- command channel ---------------------------------------------

let COMMANDS_PATH = null;
let CONTEXT_PATH = null;
let commandsOffset = 0;
const seenIds = {};
let poller = null;

// id → Maxobj for objects this session created. Survives recompile via the
// `mcp_<n>` varname assigned at creation; resolveById uses getnamed when the
// Map is empty after [v8] reload.
const mcpObjects = {};
let mcpCounter = 1;

function config(root) {
	if (!root) {
		post("bridge: config called with empty root\n");
		return;
	}
	COMMANDS_PATH = `${root}/commands.ndjson`;
	CONTEXT_PATH = `${root}/patch-context.json`;
	commandsOffset = 0;
	if (!poller) {
		poller = new Task(pollCommands, this);
		poller.interval = 150;
		poller.repeat();
		post(`bridge: command poller started, root=${root}\n`);
	}
}

function pollCommands() {
	if (!COMMANDS_PATH) return;
	const f = new File(COMMANDS_PATH, "read");
	if (!f.isopen) return;
	// File was truncated since last poll (e.g. fresh node.script start).
	if (f.eof < commandsOffset) commandsOffset = 0;
	if (f.eof <= commandsOffset) {
		f.close();
		return;
	}
	f.position = commandsOffset;
	while (f.position < f.eof) {
		const line = f.readline(8192);
		if (!line) break;
		const trimmed = line.replace(/[\r\n]+$/, "");
		if (!trimmed) continue;
		let cmd = null;
		try {
			cmd = JSON.parse(trimmed);
		} catch (e) {
			post(`bridge: bad command JSON: ${e} line=${trimmed}\n`);
			continue;
		}
		if (cmd?.requestId && !seenIds[cmd.requestId]) {
			seenIds[cmd.requestId] = true;
			executeCommand(cmd);
		}
	}
	commandsOffset = f.position;
	f.close();
}

function sendResult(requestId, target, result) {
	const payload = {
		requestId: requestId,
		path: target ? target.filepath : "",
		result: result,
	};
	outlet(0, "commandSynced", JSON.stringify(payload));
}

function executeCommand(cmd) {
	const target = topLevel(this.patcher);
	if (cmd.type === "create_object") {
		handleCreateObject(target, cmd);
	} else if (cmd.type === "connect_objects") {
		handleConnectObjects(target, cmd);
	} else {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `unknown command type: ${cmd.type}`,
		});
	}
}

// ---------- object resolver ---------------------------------------------

function readContextSnapshot() {
	if (!CONTEXT_PATH) return null;
	const f = new File(CONTEXT_PATH, "read");
	if (!f.isopen) return null;
	let buf = "";
	while (f.position < f.eof) {
		const line = f.readline(8192);
		if (!line) break;
		buf += line;
	}
	f.close();
	if (!buf) return null;
	try {
		return JSON.parse(buf);
	} catch (e) {
		post(`bridge: failed to parse context snapshot: ${e}\n`);
		return null;
	}
}

function rectEquals(a, b) {
	return (
		a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
	);
}

function findByRect(target, rect) {
	let found = null;
	target.applyif(
		(obj) => {
			if (!found) found = obj;
		},
		(obj) => !found && rectEquals(obj.rect, rect),
	);
	return found;
}

function resolveById(target, id) {
	if (!id) return null;
	const own = mcpObjects[id];
	if (own?.maxclass) return own;
	const byName = target.getnamed(id);
	if (byName?.maxclass) return byName;
	if (/^obj-\d+$/.test(id)) {
		const ctx = readContextSnapshot();
		if (ctx?.boxes) {
			for (const box of ctx.boxes) {
				if (box.id === id) return findByRect(target, box.rect);
			}
		}
	}
	return null;
}

function nameInUse(target, name) {
	const existing = target.getnamed(name);
	// In v8, getnamed returns a Maxobj-like even for missing names; check maxclass.
	return !!existing?.maxclass;
}

function nextMcpName(target) {
	for (let i = 0; i < 10000; i++) {
		const name = `mcp_${mcpCounter}`;
		mcpCounter++;
		if (!nameInUse(target, name)) return name;
	}
	return `mcp_${Date.now()}`; // pathological fallback
}

function handleCreateObject(target, cmd) {
	const classname = cmd.classname;
	const args = cmd.args || [];
	if (!classname) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: "empty text",
		});
		return;
	}
	if (cmd.varname && nameInUse(target, cmd.varname)) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `varname collision: ${cmd.varname}`,
		});
		return;
	}
	let obj;
	try {
		const fnArgs = [cmd.x, cmd.y, classname].concat(args);
		obj = target.newdefault.apply(target, fnArgs);
	} catch (e) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `newdefault failed: ${e}`,
		});
		return;
	}
	if (!obj?.maxclass) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `unknown maxclass: ${classname}`,
		});
		return;
	}
	const name = cmd.varname || nextMcpName(target);
	try {
		obj.varname = name;
	} catch (e) {
		// If varname assignment fails for some reason, roll back.
		try {
			target.remove(obj);
		} catch (_) {
			/* ignore */
		}
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `failed to set varname '${name}': ${e}`,
		});
		return;
	}
	mcpObjects[name] = obj;
	target.message("write"); // persist .maxpat so assistant.ts reads fresh state

	sendResult(cmd.requestId, target, {
		ok: true,
		id: name,
		text: cmd.text,
		maxclass: obj.maxclass,
		rect: obj.rect,
		numinlets: obj.numinlets,
		numoutlets: obj.numoutlets,
	});
}

function handleConnectObjects(target, cmd) {
	const src = resolveById(target, cmd.srcId);
	if (!src) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `source object not found: ${cmd.srcId} — try get_patch_context`,
		});
		return;
	}
	const dst = resolveById(target, cmd.dstId);
	if (!dst) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `destination object not found: ${cmd.dstId} — try get_patch_context`,
		});
		return;
	}
	const srcOutlet = cmd.srcOutlet;
	const dstInlet = cmd.dstInlet;
	if (
		typeof srcOutlet !== "number" ||
		srcOutlet < 0 ||
		srcOutlet >= src.numoutlets
	) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `srcOutlet ${srcOutlet} out of range (numoutlets=${src.numoutlets})`,
		});
		return;
	}
	if (
		typeof dstInlet !== "number" ||
		dstInlet < 0 ||
		dstInlet >= dst.numinlets
	) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `dstInlet ${dstInlet} out of range (numinlets=${dst.numinlets})`,
		});
		return;
	}
	try {
		target.connect(src, srcOutlet, dst, dstInlet);
	} catch (e) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `connect failed: ${e}`,
		});
		return;
	}
	target.message("write");
	sendResult(cmd.requestId, target, { ok: true });
}

// Register handlers — top-level `function` declarations don't always reach
// the Max dispatch table in v8, so attach explicitly too.
globalThis.getcontext = getcontext;
globalThis.config = config;
