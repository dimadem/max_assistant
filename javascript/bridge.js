/**
 * bridge.js — runs in [v8]. Executes patch commands for the assistant.
 *
 * Transport: [node.script] sends `command <json>`; we run it against the
 * target patcher and answer with `bridgeResult <json>` on outlet 0.
 * No polling, no files, no auto-saving.
 *
 * Command JSON: { requestId, type, ...params } — the contract (params and
 * results of every command) is typed in src/types/bridge.ts; keep in sync.
 * Box specs arrive tokenised: { box, atoms, text } (see src/box-spec.ts).
 * Every mutation result carries a fresh `context` snapshot
 * { patch, boxes, connections: [{ from, outlet, to, inlet }] } (box ids).
 * `pin` / `unpin` messages lock the target patch.
 * Outlet `target <json>` reports the current target { name, pinned } on change.
 */

autowatch = 1;
inlets = 1;
outlets = 1;
const jsthis = this; // the [v8] object; `this` is not reliable inside callbacks

const VERSION = "v26";
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

// A freed Patcher can't be probed safely (any access prints "bad object"),
// but a Maxobj has `valid`. So remembered patches are entries
// { p, title, sentinel } and liveness is checked via an object inside them.
function safeValid(obj) {
	try {
		return !!obj && !!obj.valid; // Max returns 1, not true
	} catch (_) {
		return false;
	}
}

function remember(p) {
	if (!p) return null;
	let sentinel = null;
	let title = "";
	try {
		const first = p.firstobject;
		if (first && first.valid) sentinel = first;
		title = cleanTitle(p.wind.title || p.name || "");
	} catch (_) {}
	return { p, title, sentinel };
}

// Empty patches have no sentinel: assumed alive until the user focuses another
// patch (the tracker replaces the entry) — they get one after the first edit.
function alive(e) {
	return !!e && (e.sentinel ? safeValid(e.sentinel) : true);
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

let createdTarget = null; // entry: window we opened ourselves
let lastFocused = null; // entry: last patch window the user was in (not the assistant)
let pinned = null; // entry: patch locked via 📌 — wins over focus

// max.frontpatcher is null while commands arrive (e.g. while Claude Desktop
// or the chat's jweb has focus), so remember the user's patch as they work.
// Every 150 ms: read the front window (always live) and check sentinels only.
const focusTracker = new Task(() => {
	try {
		trackerStats.ticks++;
		const fp = max.frontpatcher;
		if (fp) {
			trackerStats.seen++;
			const top = topLevel(fp);
			trackerStats.lastFront = String(top.name);
			if (!samePatcher(top, ownTop())) lastFocused = remember(top);
			else trackerStats.skippedOwn++;
		}
		reportTarget();
		trackerError = "";
	} catch (e) {
		trackerError = String(e);
	}
});

let reported = "";
let trackerError = "";
const trackerStats = { ticks: 0, seen: 0, lastFront: "", skippedOwn: 0 };
function cleanTitle(title) {
	return String(title).replace(/\s*\((unlocked|presentation|locked)\)\s*$/i, "");
}
// node.script asks for this once it's ready (earlier reports are dropped).
function report() {
	reportTarget(true);
}
function reportTarget(force) {
	const e = pickEntry();
	const state = JSON.stringify({
		name: e ? e.title : isStandalone() ? "" : cleanTitle(ownTop().name || ""),
		pinned: alive(pinned),
		embedded: !isStandalone(),
	});
	if (force || state !== reported) {
		reported = state;
		outlet(0, "target", state);
	}
}

function pin() {
	const e = pickEntry();
	if (e && isStandalone()) pinned = e;
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

// Standalone mode only: which remembered patch to use (no patcher access).
function pickEntry() {
	if (!isStandalone()) return null;
	if (alive(pinned)) return pinned;
	if (alive(lastFocused)) return lastFocused;
	if (alive(createdTarget)) return createdTarget;
	return null;
}

function pickTarget(allowCreate) {
	const own = ownTop();
	if (!isStandalone()) return own;
	const e = pickEntry();
	if (e) return e.p;
	if (!allowCreate) return null;
	const p = new Patcher(80, 80, 780, 620);
	p.wind.visible = 1;
	p.wind.title = "assistant work";
	createdTarget = remember(p);
	createdTarget.title = "assistant work";
	post("bridge: opened a new patcher for the assistant\n");
	return p;
}

// After an edit the target is known to be alive: re-pick its sentinel, since
// the edit may have deleted it (else the patch would look closed) or the patch
// may have been empty until now.
function refreshEntries(target) {
	for (const e of [pinned, lastFocused, createdTarget]) {
		if (e && e.p === target) e.sentinel = remember(target)?.sentinel || null;
	}
}

// Diagnostics: what [v8] sees when it walks the window list.
function describeWindows() {
	const own = ownTop();
	const out = {
		own: own.name,
		standalone: isStandalone(),
		lastFocused: alive(lastFocused) ? lastFocused.title : null,
		pinned: alive(pinned) ? pinned.title : null,
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
let registryOwner = ""; // title of the patch the registry belongs to
let nextObjId = 1;

function clearIds() {
	registry = [];
	nextObjId = 1;
}

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

// Maxobj.rect is [left, top, right, bottom]; expose [x, y, width, height]
// like .maxpat's patching_rect.
function xywh(r) {
	if (!r || r.length < 4) return r;
	const round = (n) => Math.round(n * 100) / 100;
	const h = r[3] - r[1];
	return [round(r[0]), round(r[1]), round(r[2] - r[0]), round(h > 0 ? h : 22)]; // new boxes report 0 height until drawn
}

function isSelected(obj) {
	try {
		return obj.selected === true || obj.selected === 1;
	} catch (_) {
		return false;
	}
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
	const owner = remember(target)?.title || "";
	if (owner !== registryOwner) {
		clearIds();
		registryOwner = owner;
	}
	// drop freed objects BEFORE touching them (avoids "bad object" spam)
	registry = registry.filter((r) => safeValid(r.obj) && objs.some((o) => sameObj(o, r.obj)));

	const ids = objs.map(idFor);
	const idOf = (o) => {
		for (let i = 0; i < objs.length; i++) if (sameObj(objs[i], o)) return ids[i];
		return null;
	};
	const boxes = objs.map((obj, i) => ({
		id: ids[i],
		maxclass: obj.maxclass,
		text: boxText(obj) || knownText[obj.varname] || "",
		rect: xywh(obj.rect),
		...(isSelected(obj) ? { selected: true } : {}),
	}));
	const connections = [];
	objs.forEach((obj, i) => {
		for (const c of obj.patchcords?.outputs || []) {
			const to = idOf(c.dstobject);
			if (to) connections.push({ from: ids[i], outlet: c.srcoutlet, to, inlet: c.dstinlet });
		}
	});
	let name = "";
	try {
		name = cleanTitle(target.wind.title || target.name || "");
	} catch (_) {
		name = target.name || "";
	}
	return { patch: name, boxes, connections };
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
//
// Message / comment boxes, verified in Max 9.2 (/probe): `set` with "," / ";"
// as separate atoms gives a real comma (`1 10, 0 500`). setboxattr/setattr
// ("text") do nothing, and `boxtext` reads back EMPTY for message boxes — so
// we remember what we wrote.

const knownText = {}; // varname → content of message boxes we created

// spec: { box, atoms, text, x, y, name?, varname? } — atoms come tokenised from TS.
function createOne(target, spec) {
	const atoms = spec.atoms || [];
	const isObject = spec.box !== "message" && spec.box !== "comment";
	if (isObject && atoms.length === 0) return { ok: false, error: "empty text" };
	if (spec.varname && nameInUse(target, spec.varname)) {
		return { ok: false, error: `varname collision: ${spec.varname}` };
	}
	const args = isObject ? atoms : [spec.box];
	let obj;
	try {
		obj = target.newdefault.apply(target, [spec.x, spec.y].concat(args));
	} catch (e) {
		return { ok: false, error: `newdefault failed: ${e}` };
	}
	if (isBogus(obj)) {
		if (!isObject) return { ok: false, error: `could not create a ${spec.box} box` };
		try {
			if (obj) target.remove(obj);
		} catch (_) {}
		return { ok: false, error: `"${atoms[0]}" is not a Max object — use search_objects to find the right name` };
	}
	if (!isObject && atoms.length) {
		try {
			obj.message.apply(obj, ["set"].concat(atoms));
		} catch (e) {
			return { ok: false, error: `setting ${spec.box} text failed: ${e}` };
		}
	}
	const name = spec.varname || uniqueName(target, spec.name || (isObject ? "mcp" : spec.box));
	obj.varname = name;
	if (!isObject) knownText[name] = String(spec.text || "");
	return { ok: true, id: name, obj, maxclass: obj.maxclass };
}

function hasCord(src, outlet, dst, inlet) {
	return (src.patchcords?.outputs || []).some(
		(c) => c.srcoutlet === outlet && c.dstinlet === inlet && sameObj(c.dstobject, dst),
	);
}

// Inlet/outlet counts aren't readable from [v8] (Max 9.2), so connect and
// then verify the cord exists — Max silently ignores out-of-range ports.
function connectObjs(target, src, srcOutlet, dst, dstInlet) {
	if (typeof srcOutlet !== "number" || srcOutlet < 0) return `invalid outlet ${srcOutlet}`;
	if (typeof dstInlet !== "number" || dstInlet < 0) return `invalid inlet ${dstInlet}`;
	if (hasCord(src, srcOutlet, dst, dstInlet)) return null; // already connected
	try {
		target.connect(src, srcOutlet, dst, dstInlet);
	} catch (e) {
		return `connect failed: ${e}`;
	}
	if (!hasCord(src, srcOutlet, dst, dstInlet)) {
		return `Max refused the cord (outlet ${srcOutlet} or inlet ${dstInlet} doesn't exist, or a signal outlet → control-only inlet). Check ports with get_object_docs.`;
	}
	return null;
}

function resolveCord(target, cmd) {
	const src = resolveById(target, cmd.srcId);
	if (!src) return { error: `source object not found: ${cmd.srcId}` };
	const dst = resolveById(target, cmd.dstId);
	if (!dst) return { error: `destination object not found: ${cmd.dstId}` };
	return { src, dst };
}

const queries = {
	get_context() {
		const target = pickTarget(false);
		if (target) return { ok: true, context: snapshot(target) };
		post(`bridge: no target window. ${JSON.stringify({ ...describeWindows(), tracker: trackerStats, trackerError })}\n`);
		return {
			ok: true,
			context: { patch: "", boxes: [], connections: [] },
			note: "No patch window found besides the assistant. A new one will be opened on the first edit.",
		};
	},
};

// Mutations run against the target (opened if needed) and return a fresh snapshot.
const mutations = {
	create_object(cmd, target) {
		const { obj: _obj, ...r } = createOne(target, cmd);
		return r;
	},

	connect_objects(cmd, target) {
		const { src, dst, error } = resolveCord(target, cmd);
		if (error) return { ok: false, error };
		const err = connectObjs(target, src, cmd.srcOutlet, dst, cmd.dstInlet);
		return err ? { ok: false, error: err } : { ok: true };
	},

	disconnect_objects(cmd, target) {
		const { src, dst, error } = resolveCord(target, cmd);
		if (error) return { ok: false, error };
		if (!hasCord(src, cmd.srcOutlet, dst, cmd.dstInlet)) {
			return { ok: false, error: `no patchcord ${cmd.srcId}:${cmd.srcOutlet} → ${cmd.dstId}:${cmd.dstInlet}` };
		}
		target.disconnect(src, cmd.srcOutlet, dst, cmd.dstInlet);
		return { ok: true };
	},

	delete_object(cmd, target) {
		const obj = resolveById(target, cmd.id);
		if (!obj) return { ok: false, error: `object not found: ${cmd.id}` };
		target.remove(obj);
		return { ok: true };
	},

	create_fragment(cmd, target) {
		const created = {}; // local name → Maxobj
		const objects = [];
		const errors = [];
		for (const spec of cmd.objects || []) {
			const r = createOne(target, spec);
			if (r.ok) {
				created[spec.name] = r.obj;
				objects.push({ name: spec.name, id: r.id });
			} else {
				errors.push(`object "${spec.name}" (${spec.text || spec.box}): ${r.error}`);
			}
		}
		const resolve = (ref) => created[ref] || resolveById(target, ref);
		let connected = 0;
		for (const c of cmd.connections || []) {
			const cord = `connection ${c.from}:${c.outlet} → ${c.to}:${c.inlet}`;
			const src = resolve(c.from);
			const dst = resolve(c.to);
			if (!src || !dst) {
				errors.push(`${cord}: unknown ${src ? c.to : c.from}`);
				continue;
			}
			const err = connectObjs(target, src, c.outlet, dst, c.inlet);
			if (err) errors.push(`${cord}: ${err}`);
			else connected++;
		}
		return { ok: errors.length === 0, objects, connected, errors };
	},
};

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
		if (queries[cmd.type]) {
			reply({ requestId, ...queries[cmd.type](cmd) });
			return;
		}
		const mutation = mutations[cmd.type];
		if (!mutation) {
			reply({ requestId, ok: false, error: `unknown command: ${cmd.type}` });
			return;
		}
		const target = pickTarget(true);
		const result = mutation(cmd, target);
		refreshEntries(target);
		reply({ requestId, ...result, context: snapshot(target) });
	} catch (e) {
		post(`bridge: ${cmd.type} failed: ${e}\n${e?.stack || ""}\n`);
		reply({ requestId, ok: false, error: `bridge exception: ${e}` });
	}
}

function reset() {
	createdTarget = null; // lastFocused/pinned are kept: they follow the user
	clearIds();
	for (const k of Object.keys(knownText)) delete knownText[k];
	registryOwner = "";
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
