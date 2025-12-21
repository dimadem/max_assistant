let idCounter = 0;

/** Generates unique ID for new objects (ai_obj_1, ai_obj_2, ...) */
const generateId = () => `ai_obj_${++idCounter}`;

/** Resets ID counter (for testing) */
const resetIdCounter = () => {
	idCounter = 0;
};

/** Sends error message to Max console and outlet */
const sendError = (command, message) => {
	post(`bridge ERROR [${command}]: ${message}\n`);
	outlet(0, "error", command, message);
};

/** Sends success response through outlet */
const sendSuccess = (command, ...args) => {
	outlet(0, command, ...args);
};

/** Logs debug message to Max console */
const log = (message) => {
	post(`bridge: ${message}\n`);
};

/** Validates that a required parameter is present */
const validateRequired = (value, paramName, command) => {
	if (value === undefined || value === null || value === "") {
		sendError(command, `${paramName} is required`);
		return false;
	}
	return true;
};

/** Validates that value is a number */
const validateNumber = (value, paramName, command) => {
	if (typeof value !== "number") {
		sendError(command, `${paramName} must be a number, got: ${typeof value}`);
		return false;
	}
	return true;
};

/** Validates that object exists in patcher, returns object or null */
const validateObject = (patcher, id, command) => {
	const obj = patcher.getnamed(id);
	if (!obj) {
		sendError(command, `Object not found: ${id}`);
		return null;
	}
	return obj;
};

module.exports = {
	generateId,
	resetIdCounter,
	sendError,
	sendSuccess,
	log,
	validateRequired,
	validateNumber,
	validateObject,
};
