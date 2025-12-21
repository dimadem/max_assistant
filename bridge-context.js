/** Gets full patch context: all objects (boxes) and connections (lines) */
const getContext = (p, helpers) => {
	const { sendSuccess, log } = helpers;

	const boxes = [];
	const lines = [];
	const objIndexMap = new Map();
	const objArray = [];

	// Собираем все объекты
	let obj = p.firstobject;
	let index = 0;

	while (obj) {
		const id = obj.varname || `_obj_${index}`;
		objIndexMap.set(obj, index);
		objArray.push(obj);

		boxes.push({
			id,
			maxclass: obj.maxclass,
			text: obj.text || "",
			rect: obj.rect,
			numinlets: obj.numinlets,
			numoutlets: obj.numoutlets,
		});

		obj = obj.nextobject;
		index++;
	}

	// Получаем соединения через patchcords каждого объекта
	// v8 не поддерживает p.firstline, но можно получить через объекты
	for (let srcIdx = 0; srcIdx < objArray.length; srcIdx++) {
		const srcObj = objArray[srcIdx];
		const numOutlets = srcObj.numoutlets || 0;

		for (let outlet = 0; outlet < numOutlets; outlet++) {
			try {
				// patchcords возвращает массив соединений для outlet
				const cords = srcObj.patchcords ? srcObj.patchcords[outlet] : null;
				if (cords && Array.isArray(cords)) {
					for (const cord of cords) {
						if (cord && cord.dstobject) {
							const dstIdx = objIndexMap.get(cord.dstobject);
							if (dstIdx !== undefined) {
								lines.push({
									src: [srcIdx, outlet],
									dst: [dstIdx, cord.dstinlet || 0],
								});
							}
						}
					}
				}
			} catch (e) {
				// Игнорируем ошибки для отдельных объектов
			}
		}
	}

	log(`getContext: ${boxes.length} boxes, ${lines.length} lines`);
	sendSuccess("context", JSON.stringify({ boxes, lines }));
};

module.exports = { getContext };
