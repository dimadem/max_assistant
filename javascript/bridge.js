/**
 * bridge.js — runs in [v8].
 *
 * Two responsibilities:
 *   1. `getcontext` — walk the LIVE patcher (no save to disk) and return a
 *      PatchContext JSON { boxes, lines } to assistant.ts.
 *   2. Command channel — poll `<root>/commands.ndjson` (~150 ms),
 *      execute each new line via the Patcher API, write a result back
 *      via outlet `commandSynced`. assistant.ts then re-syncs
 *      patch-context.json and appends to command-results.ndjson.
 */

autowatch = 1;
const jsthis = this;
inlets = 1;
outlets = 1;

post("bridge.js v9 loaded\n");

// ---------- shared helpers ----------------------------------------------

function topLevel(p) {
	let cur = p;
	while (cur.parentpatcher) cur = cur.parentpatcher;
	return cur;
}

// ---------- target patcher -----------------------------------------------
//
// Embedded mode: the assistant lives inside the user's patch (bpatcher /
//   abstraction) → work in that top-level patch, but hide the box that
//   hosts the assistant.
// Standalone mode: the assistant is its own window (assistant.maxpat) →
//   work in the most recently focused OTHER patcher window; if there is none,
//   open a new one. The choice is made on each prompt (getcontext) and kept
//   for all commands of that prompt.

let currentTarget = null;
let createdTarget = null; // window we opened ourselves; reused until `reset`

function ownTop(self) {
	return topLevel(self.patcher);
}

// The box in the top-level patcher that contains the assistant (embedded
// mode), or null when the assistant is the top-level patcher itself.
function hostBox(self) {
	let p = self.patcher;
	let box = null;
	while (p.parentpatcher) {
		box = p.box;
		p = p.parentpatcher;
	}
	return box;
}

function samePatcher(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	try {
		return a.wind.title === b.wind.title && a.filepath === b.filepath;
	} catch (_) {
		return false;
	}
}

function isAlive(p) {
	try {
		return !!p && p.wind.visible !== undefined;
	} catch (_) {
		return false;
	}
}

function isStandalone(self) {
	const own = ownTop(self);
	return !hostBox(self) && /^assistant(\.maxpat)?$/.test(own.name || "");
}

function pickTarget(self) {
	const own = ownTop(self);
	if (!isStandalone(self)) return own;

	let w = max.frontpatcher ? max.frontpatcher.wind : null;
	let guard = 0;
	while (w && guard++ < 200) {
		const p = w.assoc;
		if (p && !samePatcher(p, own) && w.visible) return p;
		w = w.next;
	}
	if (isAlive(createdTarget)) return createdTarget;
	createdTarget = new Patcher(80, 80, 780, 620);
	createdTarget.wind.visible = 1;
	createdTarget.wind.title = "assistant work";
	post("bridge: opened new patcher for the assistant\n");
	return createdTarget;
}

function targetFor(self) {
	if (isAlive(currentTarget)) return currentTarget;
	currentTarget = pickTarget(self);
	return currentTarget;
}

function reset() {
	currentTarget = null;
	createdTarget = null;
	registry = [];
	registryOwner = null;
	nextObjId = 1;
}

// ---------- live patch snapshot ------------------------------------------

// Stable ids for objects without a varname. An object keeps its `obj-<n>`
// for as long as it lives; numbers are never reused, so deleting obj-1 can't
// make "obj-2" suddenly point at a different object.
let registry = []; // [{ obj, id }]
let registryOwner = null; // patcher the registry belongs to
let nextObjId = 1;

function idFor(obj) {
	if (obj.varname) return obj.varname;
	for (const r of registry) if (sameObj(r.obj, obj)) {
		r.obj = obj; // refresh wrapper (and rect, if it moved)
		return r.id;
	}
	const id = `obj-${nextObjId++}`;
	registry.push({ obj, id });
	return id;
}

function lookupId(id) {
	for (const r of registry) if (r.id === id) return r.obj;
	return null;
}

function sameObj(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	if (a.varname && a.varname === b.varname) return true;
	return a.maxclass === b.maxclass && rectEquals(a.rect, b.rect);
}

function boxText(obj) {
	try {
		return obj.boxtext || "";
	} catch (_) {
		return "";
	}
}

function snapshot(target, skip) {
	const objs = [];
	target.apply((obj) => {
		if (!sameObj(obj, skip)) objs.push(obj);
		return true;
	});
	if (!samePatcher(registryOwner, target)) {
		registry = [];
		nextObjId = 1;
		registryOwner = target;
	}
	// forget objects that no longer exist
	registry = registry.filter((r) => objs.some((o) => sameObj(o, r.obj)));

	const indexOf = (o) => {
		for (let i = 0; i < objs.length; i++) if (sameObj(objs[i], o)) return i;
		return -1;
	};

	const boxes = objs.map((obj, i) => ({
		id: idFor(obj),
		maxclass: obj.maxclass,
		text: boxText(obj),
		rect: obj.rect,
		numinlets: obj.numinlets,
		numoutlets: obj.numoutlets,
	}));

	const lines = [];
	objs.forEach((obj, i) => {
		const outs = obj.patchcords?.outputs || [];
		for (const c of outs) {
			const j = indexOf(c.dstobject);
			if (j >= 0) lines.push({ src: [i, c.srcoutlet], dst: [j, c.dstinlet] });
		}
	});
	let name = "";
	try {
		name = target.wind.title || target.name || "";
	} catch (_) {
		name = target.name || "";
	}
	return { patch: name, boxes, lines };
}

function getcontext() {
	try {
		currentTarget = pickTarget(this); // re-pick on every prompt
		const ctx = snapshot(currentTarget, hostBox(this));
		outlet(0, "bridgeResponse", "context", JSON.stringify(ctx));
	} catch (e) {
		post(`bridge: getcontext failed: ${e}\n${e?.stack || ""}\n`);
		outlet(0, "bridgeResponse", "context", JSON.stringify({ boxes: [], lines: [] }));
	}
}

// ---------- command channel ---------------------------------------------

let COMMANDS_PATH = null;
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
	commandsOffset = 0;
	if (!poller) {
		poller = new Task(pollCommands, this);
		poller.interval = 150;
		poller.repeat();
		post(`bridge: command poller started, root=${root}\n`);
	}
}

function pollCommands() {
	const self = this?.patcher ? this : jsthis;
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
			try {
				executeCommand.call(self, cmd);
			} catch (e) {
				post(`bridge: ${cmd.type} failed: ${e}\n${e?.stack || ""}\n`);
				outlet(
					0,
					"commandSynced",
					JSON.stringify({
						requestId: cmd.requestId,
						context: null,
						result: { ok: false, error: `bridge exception: ${e}` },
					}),
				);
			}
		}
	}
	commandsOffset = f.position;
	f.close();
}

function sendResult(requestId, target, result) {
	const payload = {
		requestId: requestId,
		context: target ? snapshot(target, hostBoxCache) : null,
		result: result,
	};
	outlet(0, "commandSynced", JSON.stringify(payload));
}

let hostBoxCache = null;

function executeCommand(cmd) {
	const target = targetFor(this);
	hostBoxCache = hostBox(this);
	if (cmd.type === "create_object") {
		handleCreateObject(target, cmd);
	} else if (cmd.type === "connect_objects") {
		handleConnectObjects(target, cmd);
	} else if (cmd.type === "delete_object") {
		handleDeleteObject(target, cmd);
	} else {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `unknown command type: ${cmd.type}`,
		});
	}
}

// ---------- object resolver ---------------------------------------------

function rectEquals(a, b) {
	return (
		a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
	);
}

function resolveById(target, id) {
	const obj = resolveRaw(target, id);
	return obj && sameObj(obj, hostBoxCache) ? null : obj; // never touch the assistant
}

function resolveRaw(target, id) {
	if (!id) return null;
	const own = mcpObjects[id];
	if (own?.maxclass) return own;
	const byName = target.getnamed(id);
	if (byName?.maxclass) return byName;
	const obj = lookupId(id);
	return obj?.maxclass ? obj : null;
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
	sendResult(cmd.requestId, target, { ok: true });
}

function handleDeleteObject(target, cmd) {
	const obj = resolveById(target, cmd.id);
	if (!obj) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `object not found: ${cmd.id} — try get_patch_context`,
		});
		return;
	}
	try {
		target.remove(obj);
	} catch (e) {
		sendResult(cmd.requestId, target, {
			ok: false,
			error: `remove failed: ${e}`,
		});
		return;
	}
	// Drop our own bookkeeping entry if present (so a future create_object
	// can reuse the freed mcp_<n> name without colliding via getnamed).
	if (mcpObjects[cmd.id]) delete mcpObjects[cmd.id];
	sendResult(cmd.requestId, target, { ok: true });
}

// Register handlers — top-level `function` declarations don't always reach
// the Max dispatch table in v8, so attach explicitly too.
globalThis.getcontext = getcontext;
globalThis.config = config;
globalThis.reset = reset;
