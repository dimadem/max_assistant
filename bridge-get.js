/** Gets full info about an object by ID (properties, attributes, box attrs) */
const getObject = (p, id, helpers) => {
	const { sendSuccess, validateRequired } = helpers;

	if (!validateRequired(id, "Object ID", "get")) return;

	const obj = p.getnamed(id);

	if (obj) {
		const rect = obj.rect;
		const info = {
			id: obj.varname,
			maxclass: obj.maxclass,
			text: obj.text || "",
			rect,
			numinlets: obj.numinlets,
			numoutlets: obj.numoutlets,
			hidden: obj.hidden || false,
			attributes: {},
		};

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
			} catch (_e) {}
		}

		if (typeof obj.getattrnames === "function") {
			try {
				const attrNames = obj.getattrnames();
				if (attrNames && attrNames.length > 0) {
					for (let i = 0; i < attrNames.length; i++) {
						const name = attrNames[i];
						try {
							const value = obj.getattr(name);
							if (value !== undefined && value !== null) {
								info.attributes[name] = value;
							}
						} catch (_e) {}
					}
				}
			} catch (_e) {}
		}

		sendSuccess("object", JSON.stringify(info));
	} else {
		sendSuccess("object", "null");
	}
};

module.exports = { getObject };
