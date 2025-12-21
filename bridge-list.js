/** Lists all objects that have a varname (scripting name) */
const listObjects = (p, helpers) => {
	const { sendSuccess } = helpers;

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

	sendSuccess("list", JSON.stringify(objects));
};

module.exports = { listObjects };
