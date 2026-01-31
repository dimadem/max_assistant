/**
 * bridge-getcontext.js — получение полного контекста патча (boxes + lines)
 *
 * Max объект: [js bridge-getcontext.js]
 * Использует patcher.firstline для итерации по соединениям
 */

autowatch = 1;
inlets = 1;
outlets = 1;

const p = this.patcher;

if (typeof setinletassist === "function") {
	setinletassist(0, "Commands: getcontext, getsubpatcher <id>");
}

if (typeof setoutletassist === "function") {
	setoutletassist(0, "Output: context/subpatcher JSON");
}

function anything() {
	const cmd = messagename;
	const args = arrayfromargs(arguments);

	if (cmd === "getcontext") {
		getContext();
	} else if (cmd === "getsubpatcher") {
		getSubpatcher(args[0]);
	} else {
		post(`bridge-getcontext: unknown command: ${cmd}\n`);
	}
}

function getContext() {
	const boxes = [];
	const lines = [];
	const objIndexMap = {};
	const objArray = [];
	let obj = p.firstobject;
	let index = 0;

	while (obj) {
		const id = obj.varname || `_obj_${index}`;
		objIndexMap[id] = index;
		objArray[index] = obj;

		boxes.push({
			id: id,
			maxclass: obj.maxclass,
			text: obj.text || "",
			rect: obj.rect,
			numinlets: obj.numinlets,
			numoutlets: obj.numoutlets,
		});

		obj = obj.nextobject;
		index++;
	}

	let line = p.firstline;

	while (line) {
		const srcObj = line.box1;
		const dstObj = line.box2;

		let srcIdx = -1;
		let dstIdx = -1;

		for (let i = 0; i < objArray.length; i++) {
			if (objArray[i] === srcObj) srcIdx = i;
			if (objArray[i] === dstObj) dstIdx = i;
		}

		if (srcIdx !== -1 && dstIdx !== -1) {
			lines.push({
				src: [srcIdx, line.outletnum],
				dst: [dstIdx, line.inletnum],
			});
		}

		line = line.nextline;
	}

	post(`bridge-getcontext: ${boxes.length} boxes, ${lines.length} lines\n`);

	const result = JSON.stringify({
		boxes: boxes,
		lines: lines,
	});

	outlet(0, "context", result);
}

/**
 * Get context of a subpatcher by varname
 */
function getSubpatcher(id) {
	if (!id) {
		outlet(
			0,
			"subpatcher",
			JSON.stringify({ error: "No subpatcher ID provided" }),
		);
		return;
	}

	const obj = p.getnamed(id);
	if (!obj) {
		outlet(
			0,
			"subpatcher",
			JSON.stringify({ error: "Object not found: " + id }),
		);
		return;
	}

	// Check if it's a subpatcher type
	const subpatcherTypes = ["patcher", "bpatcher", "poly~", "pfft~", "gen~"];
	if (!subpatcherTypes.includes(obj.maxclass)) {
		outlet(
			0,
			"subpatcher",
			JSON.stringify({
				error: "Object is not a subpatcher: " + obj.maxclass,
			}),
		);
		return;
	}

	// Get subpatcher reference
	let subpatcher;
	try {
		subpatcher = obj.subpatcher();
	} catch (e) {
		outlet(
			0,
			"subpatcher",
			JSON.stringify({
				error: "Cannot access subpatcher contents: " + e,
			}),
		);
		return;
	}

	if (!subpatcher) {
		outlet(
			0,
			"subpatcher",
			JSON.stringify({
				error: "Subpatcher reference is null",
			}),
		);
		return;
	}

	// Collect boxes and lines from subpatcher
	const boxes = [];
	const lines = [];
	const objArray = [];
	let subObj = subpatcher.firstobject;
	let index = 0;

	while (subObj) {
		const subId = subObj.varname || `_obj_${index}`;
		objArray[index] = subObj;

		boxes.push({
			id: subId,
			maxclass: subObj.maxclass,
			text: subObj.text || "",
			rect: subObj.rect,
			numinlets: subObj.numinlets,
			numoutlets: subObj.numoutlets,
		});

		subObj = subObj.nextobject;
		index++;
	}

	let line = subpatcher.firstline;
	while (line) {
		const srcObj = line.box1;
		const dstObj = line.box2;

		let srcIdx = -1;
		let dstIdx = -1;

		for (let i = 0; i < objArray.length; i++) {
			if (objArray[i] === srcObj) srcIdx = i;
			if (objArray[i] === dstObj) dstIdx = i;
		}

		if (srcIdx !== -1 && dstIdx !== -1) {
			lines.push({
				src: [srcIdx, line.outletnum],
				dst: [dstIdx, line.inletnum],
			});
		}

		line = line.nextline;
	}

	post(
		`bridge-getcontext: subpatcher "${id}": ${boxes.length} boxes, ${lines.length} lines\n`,
	);

	outlet(
		0,
		"subpatcher",
		JSON.stringify({
			parentId: id,
			boxes: boxes,
			lines: lines,
		}),
	);
}

post("═════════\n");
post("bridge-getcontext.js loaded (js object)\n");
post("Commands: getcontext, getsubpatcher <id>\n");
post("Output: context/subpatcher <JSON>\n");
post("═════════\n");
