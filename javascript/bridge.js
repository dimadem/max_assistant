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

post("bridge.js v4 loaded\n");

// ---------- shared helpers ----------------------------------------------

function topLevel(p) {
	while (p.parentpatcher) {
		p = p.parentpatcher;
	}
	return p;
}

function targetPatcher() {
	return topLevel(this.patcher);
}

// ---------- getcontext (existing handler) -------------------------------

function getcontext() {
	var target = topLevel(this.patcher);
	target.message("write"); // auto-save before reading from disk
	outlet(0, "bridgeResponse", "context", target.filepath);
}

// ---------- command channel ---------------------------------------------

var COMMANDS_PATH = null;
var CONTEXT_PATH = null;
var commandsOffset = 0;
var seenIds = {};
var poller = null;

// id → Maxobj for objects this session created. Survives recompile via the
// `mcp_<n>` varname assigned at creation; resolveById uses getnamed when the
// Map is empty after [v8] reload.
var mcpObjects = {};
var mcpCounter = 1;

function config(root) {
	if (!root) {
		post("bridge: config called with empty root\n");
		return;
	}
	COMMANDS_PATH = root + "/commands.ndjson";
	CONTEXT_PATH = root + "/patch-context.json";
	commandsOffset = 0;
	if (!poller) {
		poller = new Task(pollCommands, this);
		poller.interval = 150;
		poller.repeat();
		post("bridge: command poller started, root=" + root + "\n");
	}
}

function pollCommands() {
	if (!COMMANDS_PATH) return;
	var f = new File(COMMANDS_PATH, "read");
	if (!f.isopen) return;
	// File was truncated since last poll (e.g. fresh node.script start).
	if (f.eof < commandsOffset) commandsOffset = 0;
	if (f.eof <= commandsOffset) {
		f.close();
		return;
	}
	f.position = commandsOffset;
	while (f.position < f.eof) {
		var line = f.readline(8192);
		if (!line) break;
		var trimmed = line.replace(/[\r\n]+$/, "");
		if (!trimmed) continue;
		var cmd = null;
		try {
			cmd = JSON.parse(trimmed);
		} catch (e) {
			post("bridge: bad command JSON: " + e + " line=" + trimmed + "\n");
			continue;
		}
		if (cmd && cmd.requestId && !seenIds[cmd.requestId]) {
			seenIds[cmd.requestId] = true;
			executeCommand(cmd);
		}
	}
	commandsOffset = f.position;
	f.close();
}

function sendResult(requestId, target, result) {
	var payload = {
		requestId: requestId,
		path: target ? target.filepath : "",
		result: result,
	};
	outlet(0, "commandSynced", JSON.stringify(payload));
}

function executeCommand(cmd) {
	var target = topLevel(this.patcher);
	if (cmd.type === "create_object") {
		handleCreateObject(target, cmd);
	} else if (cmd.type === "connect_objects") {
		handleConnectObjects(target, cmd);
	} else {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: "unknown command type: " + cmd.type,
		});
	}
}

// ---------- object resolver ---------------------------------------------

function readContextSnapshot() {
	if (!CONTEXT_PATH) return null;
	var f = new File(CONTEXT_PATH, "read");
	if (!f.isopen) return null;
	var buf = "";
	while (f.position < f.eof) {
		var line = f.readline(8192);
		if (!line) break;
		buf += line;
	}
	f.close();
	if (!buf) return null;
	try {
		return JSON.parse(buf);
	} catch (e) {
		post("bridge: failed to parse context snapshot: " + e + "\n");
		return null;
	}
}

function rectEquals(a, b) {
	return (
		a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
	);
}

function findByRect(target, rect) {
	var found = null;
	target.applyif(
		function (obj) {
			if (!found) found = obj;
		},
		function (obj) {
			return !found && rectEquals(obj.rect, rect);
		},
	);
	return found;
}

function resolveById(target, id) {
	if (!id) return null;
	var own = mcpObjects[id];
	if (own && own.maxclass) return own;
	var byName = target.getnamed(id);
	if (byName && byName.maxclass) return byName;
	if (/^obj-\d+$/.test(id)) {
		var ctx = readContextSnapshot();
		if (ctx && ctx.boxes) {
			for (var i = 0; i < ctx.boxes.length; i++) {
				if (ctx.boxes[i].id === id) {
					return findByRect(target, ctx.boxes[i].rect);
				}
			}
		}
	}
	return null;
}

function nameInUse(target, name) {
	var existing = target.getnamed(name);
	// In v8, getnamed returns a Maxobj-like even for missing names; check maxclass.
	return !!(existing && existing.maxclass);
}

function nextMcpName(target) {
	for (var i = 0; i < 10000; i++) {
		var name = "mcp_" + mcpCounter;
		mcpCounter++;
		if (!nameInUse(target, name)) return name;
	}
	return "mcp_" + Date.now(); // pathological fallback
}

function handleCreateObject(target, cmd) {
	var classname = cmd.classname;
	var args = cmd.args || [];
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
			error: "varname collision: " + cmd.varname,
		});
		return;
	}
	var obj;
	try {
		var fnArgs = [cmd.x, cmd.y, classname].concat(args);
		obj = target.newdefault.apply(target, fnArgs);
	} catch (e) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: "newdefault failed: " + e,
		});
		return;
	}
	if (!obj || !obj.maxclass) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: "unknown maxclass: " + classname,
		});
		return;
	}
	var name = cmd.varname || nextMcpName(target);
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
			error: "failed to set varname '" + name + "': " + e,
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
	var src = resolveById(target, cmd.srcId);
	if (!src) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error:
				"source object not found: " +
				cmd.srcId +
				" — try get_patch_context",
		});
		return;
	}
	var dst = resolveById(target, cmd.dstId);
	if (!dst) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error:
				"destination object not found: " +
				cmd.dstId +
				" — try get_patch_context",
		});
		return;
	}
	var srcOutlet = cmd.srcOutlet;
	var dstInlet = cmd.dstInlet;
	if (
		typeof srcOutlet !== "number" ||
		srcOutlet < 0 ||
		srcOutlet >= src.numoutlets
	) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error:
				"srcOutlet " +
				srcOutlet +
				" out of range (numoutlets=" +
				src.numoutlets +
				")",
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
			error:
				"dstInlet " +
				dstInlet +
				" out of range (numinlets=" +
				dst.numinlets +
				")",
		});
		return;
	}
	try {
		target.connect(src, srcOutlet, dst, dstInlet);
	} catch (e) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: "connect failed: " + e,
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
