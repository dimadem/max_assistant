/**
 * bridge-getobject.js — детальная информация об объекте по ID
 *
 * Max объект: [js bridge-getobject.js]
 */

autowatch = 1;
inlets = 1;
outlets = 1;

const p = this.patcher;

if (typeof setinletassist === "function") {
	setinletassist(0, "Commands: get <id>");
}

if (typeof setoutletassist === "function") {
	setoutletassist(0, "Output: object JSON");
}

function anything() {
	const cmd = messagename;
	// biome-ignore lint/complexity/noArguments: Max API требует использовать arguments
	const args = arrayfromargs(arguments);

	if (cmd === "get") {
		if (args.length === 0) {
			post("bridge-getobject: error - Object ID is required\n");
			outlet(0, "error", "get", "Object ID is required");
			return;
		}
		getObject(args[0]);
	} else {
		post(`bridge-getobject: unknown command: ${cmd}\n`);
	}
}

function getObject(id) {
	const obj = p.getnamed(id);

	if (!obj) {
		post(`bridge-getobject: object not found: ${id}\n`);
		outlet(0, "object", "null");
		return;
	}

	const rect = obj.rect;
	const info = {
		id: obj.varname,
		maxclass: obj.maxclass,
		text: obj.text || "",
		rect: rect,
		numinlets: obj.numinlets,
		numoutlets: obj.numoutlets,
		hidden: obj.hidden || false,
		attributes: {},
	};

	// Получаем box attributes
	if (typeof obj.getboxattr === "function") {
		try {
			info.hint = obj.getboxattr("hint") || "";
			info.annotation = obj.getboxattr("annotation") || "";
			info.background = obj.getboxattr("background") || 0;
			info.ignoreclick = obj.getboxattr("ignoreclick") || 0;
			info.presentation = obj.getboxattr("presentation") || 0;

			if (rect && rect.length === 4) {
				info.position = [rect[0], rect[1]];
				info.size = [rect[2] - rect[0], rect[3] - rect[1]];
			}
		} catch (_e) {
			// Игнорируем ошибки
		}
	}

	// Получаем attributes
	if (typeof obj.getattrnames === "function") {
		try {
			const attrNames = obj.getattrnames();
			if (attrNames && attrNames.length > 0) {
				// biome-ignore lint/correctness/noInnerDeclarations: старый js не поддерживает let в циклах
				for (var i = 0; i < attrNames.length; i++) {
					const name = attrNames[i];
					try {
						const value = obj.getattr(name);
						if (value !== undefined && value !== null) {
							info.attributes[name] = value;
						}
					} catch (_e) {
						// Игнорируем ошибки для отдельных атрибутов
					}
				}
			}
		} catch (_e) {
			// Игнорируем ошибки
		}
	}

	post(`bridge-getobject: found ${info.maxclass}\n`);

	const result = JSON.stringify(info);
	outlet(0, "object", result);
}

post("═════════\n");
post("bridge-getobject.js loaded (js object)\n");
post("Commands: get <id>\n");
post("Output: object <JSON>\n");
post("═════════\n");
