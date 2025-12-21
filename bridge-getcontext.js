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
	setinletassist(0, "Commands: getcontext");
}

if (typeof setoutletassist === "function") {
	setoutletassist(0, "Output: context JSON");
}

function anything() {
	const cmd = messagename;

	if (cmd === "getcontext") {
		getContext();
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

post("═════════\n");
post("bridge-getcontext.js loaded (js object)\n");
post("Commands: getcontext\n");
post("Output: context <JSON>\n");
post("═════════\n");
