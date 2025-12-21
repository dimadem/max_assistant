/**
 * bridge-listobjects.js — список объектов с varname
 *
 * Max объект: [js bridge-listobjects.js]
 */

autowatch = 1;
inlets = 1;
outlets = 1;

const p = this.patcher;

if (typeof setinletassist === "function") {
	setinletassist(0, "Commands: list");
}

if (typeof setoutletassist === "function") {
	setoutletassist(0, "Output: list JSON");
}

function anything() {
	const cmd = messagename;

	if (cmd === "list") {
		listObjects();
	} else {
		post(`bridge-listobjects: unknown command: ${cmd}\n`);
	}
}

function listObjects() {
	const objects = [];
	let obj = p.firstobject;

	while (obj) {
		if (obj.varname) {
			objects.push({
				id: obj.varname,
				maxclass: obj.maxclass,
				text: obj.text || "",
			});
		}
		obj = obj.nextobject;
	}

	post(`bridge-listobjects: ${objects.length} objects\n`);

	const result = JSON.stringify(objects);
	outlet(0, "list", result);
}

post("═════════\n");
post("bridge-listobjects.js loaded (js object)\n");
post("Commands: list\n");
post("Output: list <JSON>\n");
post("═════════\n");
