/** Creates a new Max object at specified position */
const createObject = (p, args, helpers) => {
	const { sendError, sendSuccess, generateId, validateRequired } = helpers;

	const [type, x = 100, y = 100, ...objArgs] = args;

	if (!validateRequired(type, "Object type", "create")) {
		return;
	}

	if (typeof x !== "number" || typeof y !== "number") {
		sendError("create", `Invalid coordinates: x=${x}, y=${y}`);
		return;
	}

	const obj =
		objArgs.length > 0
			? p.newdefault(x, y, type, ...objArgs)
			: p.newdefault(x, y, type);

	if (obj) {
		const id = obj.varname || generateId();
		obj.varname = id;
		sendSuccess("created", id, type, x, y);
	} else {
		sendError("create", `Failed to create object of type: ${type}`);
	}
};

/** Removes an object from the patcher by ID */
const removeObject = (p, id, helpers) => {
	const { sendSuccess, validateRequired, validateObject } = helpers;

	if (!validateRequired(id, "Object ID", "remove")) {
		return;
	}

	const obj = validateObject(p, id, "remove");
	if (!obj) return;

	p.remove(obj);
	sendSuccess("removed", id);
};

module.exports = {
	createObject,
	removeObject,
};
