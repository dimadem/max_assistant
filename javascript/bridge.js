/**
 * bridge.js — runs in [v8]. Executes patch commands for the assistant.
 *
 * Transport: [node.script] sends `command <json>`; we run it against the
 * target patcher and answer with `bridgeResult <json>` on outlet 0.
 * No polling, no files, no auto-saving.
 *
 * Command JSON: { requestId, type, ...params }
 *   get_context      { create? }                → { ok, context }
 *   create_object    { box?, classname, args | content, x, y, varname? }
 *   connect_objects  { srcId, srcOutlet, dstId, dstInlet }
 *   delete_object    { id }
 *   create_fragment  { objects:[{name,classname,args,x,y}], connections:[{from,outlet,to,inlet}] }
 *   pin / unpin      lock the target patch (also `pin`/`unpin` messages)
 * Every mutation result carries a fresh `context` snapshot.
 * Outlet `target <json>` reports the current target { name, pinned } on change.
 */

autowatch = 1;
inlets = 1;
outlets = 1;
const jsthis = this; // the [v8] object; `this` is not reliable inside callbacks

const VERSION = "v16";
post(`bridge.js ${VERSION} loaded\n`);

// ---------- helpers ---------------------------------------------------------

function topLevel(p) {
	let cur = p;
	while (cur.parentpatcher) cur = cur.parentpatcher;
	return cur;
}

function rectEquals(a, b) {
	return (
		a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
	);
}

function sameObj(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	if (a.varname && a.varname === b.varname) return true;
	return a.maxclass === b.maxclass && rectEquals(a.rect, b.rect);
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

function isBogus(obj) {
	return !obj?.maxclass || obj.maxclass === "jbogus";
}

// ---------- target patcher --------------------------------------------------
//
// Embedded: the assistant sits inside the user's patch (bpatcher/abstraction)
//   → edit that top-level patch, hiding and protecting the hosting box.
// Standalone (assistant.maxpat is its own window) → edit the most recently
//   focused OTHER patcher window; open a new one only when a mutation needs it.

let createdTarget = null;
let lastFocused = null; // last patcher window the user was in (not the assistant)
let pinned = null; // patch locked by the user via 📌 — wins over focus

// max.frontpatcher is null while commands arrive (e.g. while Claude Desktop
// or the chat's jweb has focus), so remember the user's patch as they work.
// One property read every 150 ms — no file I/O.
const focusTracker = new Task(() => {
	try {
		const fp = max.frontpatcher;
		if (fp && !samePatcher(topLevel(fp), ownTop())) lastFocused = topLevel(fp);
		reportTarget();
	} catch (_) {}
});

let reported = "";
function cleanTitle(title) {
	return String(title).replace(/\s*\((unlocked|presentation|locked)\)\s*$/i, "");
}
// node.script asks for this once it's ready (earlier reports are dropped).
function report() {
	reportTarget(true);
}
function reportTarget(force) {
	const t = pickTarget(false);
	let name = "";
	try {
		name = t ? cleanTitle(t.wind.title || t.name || "") : "";
	} catch (_) {}
	const state = JSON.stringify({ name, pinned: isAlive(pinned), embedded: !isStandalone() });
	if (force || state !== reported) {
		reported = state;
		outlet(0, "target", state);
	}
}

function pin() {
	const t = pickTarget(false);
	if (t && isStandalone()) pinned = t;
	reportTarget(true);
}

function unpin() {
	pinned = null;
	reportTarget(true);
}
focusTracker.interval = 150;
focusTracker.repeat();

function ownTop() {
	return topLevel(jsthis.patcher);
}

function hostBox() {
	let p = jsthis.patcher;
	let box = null;
	while (p.parentpatcher) {
		box = p.box;
		p = p.parentpatcher;
	}
	return box;
}

function isStandalone() {
	return !hostBox() && /^assistant(\.maxpat)?$/.test(ownTop().name || "");
}

function pickTarget(allowCreate) {
	const own = ownTop();
	if (!isStandalone()) return own;
	if (isAlive(pinned)) return pinned;

	let w = max.frontpatcher ? max.frontpatcher.wind : null;
	let guard = 0;
	while (w && guard++ < 200) {
		const p = w.assoc;
		if (p && !samePatcher(p, own) && w.visible) return p;
		w = w.next;
	}
	if (isAlive(lastFocused)) return lastFocused;
	if (isAlive(createdTarget)) return createdTarget;
	if (!allowCreate) return null;
	createdTarget = new Patcher(80, 80, 780, 620);
	createdTarget.wind.visible = 1;
	createdTarget.wind.title = "assistant work";
	post("bridge: opened a new patcher for the assistant\n");
	return createdTarget;
}

// Diagnostics: what [v8] sees when it walks the window list.
function describeWindows() {
	const own = ownTop();
	const out = {
		own: own.name,
		standalone: isStandalone(),
		lastFocused: isAlive(lastFocused) ? lastFocused.name : null,
		pinned: isAlive(pinned) ? pinned.name : null,
		front: null,
		windows: [],
	};
	let w = null;
	try {
		w = max.frontpatcher ? max.frontpatcher.wind : null;
		out.front = max.frontpatcher ? max.frontpatcher.name : null;
	} catch (e) {
		out.front = `error: ${e}`;
	}
	let guard = 0;
	while (w && guard++ < 50) {
		let d = {};
		try {
			d = { title: w.title, visible: w.visible, cls: w.assocclass, hasAssoc: !!w.assoc, isOwn: samePatcher(w.assoc, own) };
		} catch (e) {
			d = { error: String(e) };
		}
		out.windows.push(d);
		w = w.next;
	}
	return out;
}

// ---------- stable ids + snapshot -------------------------------------------
//
// Objects without a varname get `obj-<n>` ids that live as long as the object
// and are never reused, so deleting one object can't re-point another id.

let registry = []; // [{ obj, id }]
let registryOwner = null;
let nextObjId = 1;

function idFor(obj) {
	if (obj.varname) return obj.varname;
	for (const r of registry) {
		if (sameObj(r.obj, obj)) {
			r.obj = obj;
			return r.id;
		}
	}
	const id = `obj-${nextObjId++}`;
	registry.push({ obj, id });
	return id;
}

function boxText(obj) {
	try {
		return obj.boxtext || "";
	} catch (_) {
		return "";
	}
}

function listObjects(target) {
	const skip = hostBox();
	const objs = [];
	target.apply((obj) => {
		if (!sameObj(obj, skip)) objs.push(obj);
		return true;
	});
	return objs;
}

function snapshot(target) {
	const objs = listObjects(target);
	if (!samePatcher(registryOwner, target)) {
		registry = [];
		nextObjId = 1;
		registryOwner = target;
	}
	registry = registry.filter((r) => objs.some((o) => sameObj(o, r.obj)));

	const indexOf = (o) => {
		for (let i = 0; i < objs.length; i++) if (sameObj(objs[i], o)) return i;
		return -1;
	};
	const boxes = objs.map((obj) => ({
		id: idFor(obj),
		maxclass: obj.maxclass,
		text: boxText(obj) || knownText[obj.varname] || "",
		rect: obj.rect,
		numinlets: obj.numinlets,
		numoutlets: obj.numoutlets,
	}));
	const lines = [];
	objs.forEach((obj, i) => {
		for (const c of obj.patchcords?.outputs || []) {
			const j = indexOf(c.dstobject);
			if (j >= 0) lines.push({ src: [i, c.srcoutlet], dst: [j, c.dstinlet] });
		}
	});
	let name = "";
	try {
		name = cleanTitle(target.wind.title || target.name || "");
	} catch (_) {
		name = target.name || "";
	}
	return { patch: name, boxes, lines };
}

function resolveById(target, id) {
	if (!id) return null;
	let obj = null;
	const byName = target.getnamed(id);
	if (byName?.maxclass) obj = byName;
	else {
		snapshot(target); // make sure registry is current
		for (const r of registry) if (r.id === id) obj = r.obj;
	}
	if (!obj?.maxclass) return null;
	return sameObj(obj, hostBox()) ? null : obj; // never touch the assistant
}

function nameInUse(target, name) {
	return !!target.getnamed(name)?.maxclass;
}

function uniqueName(target, base) {
	const clean = String(base || "mcp").replace(/[^A-Za-z0-9_]/g, "_");
	if (!nameInUse(target, clean)) return clean;
	for (let i = 2; i < 10000; i++) {
		const n = `${clean}_${i}`;
		if (!nameInUse(target, n)) return n;
	}
	return `${clean}_${Date.now()}`;
}

// ---------- operations ------------------------------------------------------

// ---------- message / comment boxes ----------------------------------------
//
// Verified in Max 9.2 (/probe): `set` with "," / ";" as separate atoms gives
// a real comma (`1 10, 0 500`). setboxattr/setattr("text") do nothing, and
// `boxtext` reads back EMPTY for message boxes — so we remember what we wrote.

const knownText = {}; // varname → content of message boxes we created

function atomsOf(content) {
	return String(content)
		.replace(/([,;])/g, " $1 ")
		.trim()
		.split(/\s+/)
		.filter((t) => t !== "")
		.map((t) => (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : t));
}

function createBox(target, spec) {
	let obj;
	try {
		obj = target.newdefault(spec.x, spec.y, spec.box);
	} catch (e) {
		return { ok: false, error: `newdefault ${spec.box} failed: ${e}` };
	}
	if (isBogus(obj)) return { ok: false, error: `could not create a ${spec.box} box` };
	const content = String(spec.content || "");
	if (content.trim()) {
		try {
			obj.message.apply(obj, ["set"].concat(atomsOf(content)));
		} catch (e) {
			return { ok: false, error: `setting ${spec.box} text failed: ${e}` };
		}
	}
	const name = spec.varname || uniqueName(target, spec.name || spec.box);
	obj.varname = name;
	knownText[name] = content;
	return { ok: true, id: name, obj, maxclass: obj.maxclass, numinlets: obj.numinlets, numoutlets: obj.numoutlets };
}

function createOne(target, spec) {
	if (spec.box === "message" || spec.box === "comment") return createBox(target, spec);
	if (!spec.classname) return { ok: false, error: "empty text" };
	if (spec.varname && nameInUse(target, spec.varname)) {
		return { ok: false, error: `varname collision: ${spec.varname}` };
	}
	let obj;
	try {
		obj = target.newdefault.apply(
			target,
			[spec.x, spec.y, spec.classname].concat(spec.args || []),
		);
	} catch (e) {
		return { ok: false, error: `newdefault failed: ${e}` };
	}
	if (isBogus(obj)) {
		try {
			if (obj) target.remove(obj);
		} catch (_) {}
		return {
			ok: false,
			error: `"${spec.classname}" is not a Max object — use search_objects to find the right name`,
		};
	}
	const name = spec.varname || uniqueName(target, spec.name || "mcp");
	obj.varname = name;
	return {
		ok: true,
		id: name,
		obj,
		maxclass: obj.maxclass,
		numinlets: obj.numinlets,
		numoutlets: obj.numoutlets,
	};
}

function connectObjs(target, src, srcOutlet, dst, dstInlet) {
	if (typeof srcOutlet !== "number" || srcOutlet < 0 || srcOutlet >= src.numoutlets) {
		return `outlet ${srcOutlet} out of range (numoutlets=${src.numoutlets})`;
	}
	if (typeof dstInlet !== "number" || dstInlet < 0 || dstInlet >= dst.numinlets) {
		return `inlet ${dstInlet} out of range (numinlets=${dst.numinlets})`;
	}
	try {
		target.connect(src, srcOutlet, dst, dstInlet);
	} catch (e) {
		return `connect failed: ${e}`;
	}
	return null;
}

const handlers = {
	get_context(cmd) {
		const target = pickTarget(!!cmd.create);
		if (!target) {
			post(`bridge: no target window. ${JSON.stringify(describeWindows())}\n`);
			return {
				ok: true,
				context: { patch: "", boxes: [], lines: [] },
				note: "No patch window found besides the assistant. A new one will be opened on the first mutation.",
				debug: describeWindows(),
			};
		}
		return { ok: true, context: snapshot(target) };
	},

	create_object(cmd, target) {
		const r = createOne(target, cmd);
		delete r.obj;
		return r;
	},

	connect_objects(cmd, target) {
		const src = resolveById(target, cmd.srcId);
		if (!src) return { ok: false, error: `source object not found: ${cmd.srcId}` };
		const dst = resolveById(target, cmd.dstId);
		if (!dst) return { ok: false, error: `destination object not found: ${cmd.dstId}` };
		const err = connectObjs(target, src, cmd.srcOutlet, dst, cmd.dstInlet);
		return err ? { ok: false, error: err } : { ok: true };
	},

	delete_object(cmd, target) {
		const obj = resolveById(target, cmd.id);
		if (!obj) return { ok: false, error: `object not found: ${cmd.id}` };
		target.remove(obj);
		return { ok: true };
	},

	create_fragment(cmd, target) {
		const created = {}; // local name → { id, obj }
		const objects = [];
		const errors = [];
		for (const spec of cmd.objects || []) {
			const r = createOne(target, spec);
			if (r.ok) {
				created[spec.name] = r;
				objects.push({ name: spec.name, id: r.id, numinlets: r.numinlets, numoutlets: r.numoutlets });
				if (r.warning) errors.push(`object "${spec.name}": ${r.warning}`);
			} else {
				errors.push(`object "${spec.name}" (${spec.classname || spec.box}): ${r.error}`);
			}
		}
		const resolve = (ref) => created[ref]?.obj || resolveById(target, ref);
		let connected = 0;
		for (const c of cmd.connections || []) {
			const src = resolve(c.from);
			const dst = resolve(c.to);
			if (!src || !dst) {
				errors.push(`connection ${c.from}:${c.outlet} → ${c.to}:${c.inlet}: unknown ${src ? c.to : c.from}`);
				continue;
			}
			const err = connectObjs(target, src, c.outlet, dst, c.inlet);
			if (err) errors.push(`connection ${c.from}:${c.outlet} → ${c.to}:${c.inlet}: ${err}`);
			else connected++;
		}
		return { ok: errors.length === 0, objects, connected, errors };
	},
};

const MUTATIONS = { create_object: 1, connect_objects: 1, delete_object: 1, create_fragment: 1 };

function reply(payload) {
	outlet(0, "bridgeResult", JSON.stringify(payload));
}

// Entry point: `command <json>` (Max may split the symbol into atoms — rejoin).
function command(...atoms) {
	let cmd = null;
	try {
		cmd = JSON.parse(atoms.join(" "));
	} catch (e) {
		post(`bridge: bad command JSON: ${e}\n`);
		return;
	}
	const requestId = cmd.requestId;
	try {
		const handler = handlers[cmd.type];
		if (!handler) {
			reply({ requestId, ok: false, error: `unknown command: ${cmd.type}` });
			return;
		}
		if (!MUTATIONS[cmd.type]) {
			reply({ requestId, ...handler(cmd) });
			return;
		}
		const target = pickTarget(true);
		const result = handler(cmd, target);
		reply({ requestId, ...result, context: snapshot(target) });
	} catch (e) {
		post(`bridge: ${cmd.type} failed: ${e}\n${e?.stack || ""}\n`);
		reply({ requestId, ok: false, error: `bridge exception: ${e}` });
	}
}

function reset() {
	createdTarget = null; // lastFocused is kept: it follows the user, not the chat
	registry = [];
	registryOwner = null;
	nextObjId = 1;
}

// Stop the tracker when [v8] reloads or the patch closes.
function notifydeleted() {
	focusTracker.cancel();
}

// Top-level functions don't always reach Max's dispatch table in v8.
globalThis.command = command;
globalThis.reset = reset;
globalThis.pin = pin;
globalThis.report = report;
globalThis.unpin = unpin;
