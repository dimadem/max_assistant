/** Sets object property (rect, hidden) or sends a message */
const setProperty = (p, args, helpers) => {
	const { sendSuccess, validateRequired, validateObject } = helpers;

	const [id, prop, ...value] = args;

	if (!validateRequired(id, "Object ID", "set")) return;
	if (!validateRequired(prop, "Property name", "set")) return;

	const obj = validateObject(p, id, "set");
	if (!obj) return;

	if (prop === "rect") {
		obj.rect = value;
	} else if (prop === "hidden") {
		obj.hidden = value[0];
	} else {
		obj.message(prop, ...value);
	}

	sendSuccess("set", id, prop);
};

/** Sends an arbitrary message to an object */
const sendMessage = (p, args, helpers) => {
	const { sendSuccess, validateRequired, validateObject } = helpers;

	const [id, msg, ...msgArgs] = args;

	if (!validateRequired(id, "Object ID", "send")) return;
	if (!validateRequired(msg, "Message", "send")) return;

	const obj = validateObject(p, id, "send");
	if (!obj) return;

	obj.message(msg, ...msgArgs);
	sendSuccess("sent", id, msg);
};

module.exports = {
	setProperty,
	sendMessage,
};
