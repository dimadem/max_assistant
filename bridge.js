/**
 * bridge.js — главный роутер команд (мост между node.script и патчером Max)
 *
 * Max объект: [v8 bridge.js]
 *
 * НАЗНАЧЕНИЕ:
 * Этот скрипт работает внутри объекта [v8] в Max MSP и служит посредником
 * между Node.js скриптом (assistant.js) и визуальным патчером Max.
 * Он принимает команды и делегирует их выполнение соответствующим модулям.
 *
 * УСТАНОВКА:
 * 1. Размести объект [v8 bridge.js] в патче Max
 * 2. Соедини выход node.script с входом v8
 * 3. Соедини выход v8 со входом node.script (для ответов)
 *
 * АРХИТЕКТУРА:
 * node.script (JS/Node) <---> v8 bridge.js <---> Max Patcher
 *                                  │
 *                    ┌─────────────┼─────────────┐
 *                    ▼             ▼             ▼
 *              bridge/        bridge/        bridge/
 *              commands/      commands/      utils/
 *              create.js      connect.js     helpers.js
 *
 * СТРУКТУРА ПРОЕКТА:
 * max_assistant/
 * ├── bridge.js              ← этот файл (главный роутер)
 * ├── bridge-helpers.js      ← вспомогательные функции
 * ├── bridge-create.js       ← создание/удаление объектов
 * ├── bridge-connect.js      ← соединение объектов
 * ├── bridge-properties.js   ← управление свойствами
 * ├── bridge-get.js          ← получение информации об объекте
 * ├── bridge-list.js         ← список объектов
 * └── bridge-context.js      ← полный контекст патча
 *
 * @author AI Assistant
 * @version 1.0
 */

// =============================================================================
// КОНФИГУРАЦИЯ MAX
// =============================================================================

/**
 * autowatch — автоматическая перезагрузка скрипта при сохранении файла
 * Значение 1 = включено (удобно при разработке)
 * Значение 0 = выключено (для продакшена)
 */
autowatch = 1;

/**
 * inlets — количество входов объекта v8
 * Мы используем один вход для приёма всех команд
 */
inlets = 1;

/**
 * outlets — количество выходов объекта v8
 * Outlet 0: результаты обратно в node.script
 * Outlet 1: команды для js нод (getcontext, get, list)
 */
outlets = 2;

// =============================================================================
// ИМПОРТ МОДУЛЕЙ (CommonJS)
// =============================================================================

/**
 * Загружаем модули команд
 *
 * require() в Max ищет файлы относительно:
 * 1. Папки, где находится текущий скрипт
 * 2. Max search path
 *
 * Каждый модуль экспортирует функции для обработки своих команд.
 */

const helpers = require("bridge-helpers.js");
const createModule = require("bridge-create.js");
const connectModule = require("bridge-connect.js");
const propsModule = require("bridge-properties.js");

// Модули get, list, getcontext теперь делегируются в js ноды
// const { getObject } = require("bridge-get.js");
// const { listObjects } = require("bridge-list.js");
// const { getContext } = require("bridge-context.js");

// =============================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// =============================================================================

/**
 * p — ссылка на текущий патчер (patcher)
 *
 * this.patcher — это встроенное свойство объекта js/v8, которое возвращает
 * объект Patcher, содержащий текущий скрипт.
 */
const p = this.patcher;

// =============================================================================
// ОПИСАНИЯ ВХОДОВ И ВЫХОДОВ
// =============================================================================

/**
 * setinletassist / setoutletassist — подсказки при наведении мыши
 */
if (typeof setinletassist === "function") {
	setinletassist(
		0,
		"Команды: create, connect, remove, set, send, get, list, getcontext, getsubpatcher",
	);
}

if (typeof setoutletassist === "function") {
	setoutletassist(
		0,
		"Results to node.script: created, connected, error, context, list",
	);
	setoutletassist(1, "Commands to js nodes: getcontext, get, list");
}

// =============================================================================
// ТАБЛИЦА МАРШРУТИЗАЦИИ КОМАНД
// =============================================================================

/**
 * commandHandlers — карта команд и их обработчиков
 *
 * Формат: "имя_команды": (args) => функция_обработчик(patcher, args, helpers)
 *
 * Такая структура позволяет:
 * - Легко добавлять новые команды
 * - Видеть все доступные команды в одном месте
 * - Делегировать логику в отдельные модули
 */
const commandHandlers = {
	// --- Создание и удаление объектов ---
	create: (args) => createModule.createObject(p, args, helpers),
	remove: (args) => createModule.removeObject(p, args[0], helpers),

	// --- Соединение объектов ---
	connect: (args) => connectModule.connectObjects(p, args, helpers),
	disconnect: (args) => connectModule.disconnectObjects(p, args, helpers),

	// --- Управление свойствами ---
	set: (args) => propsModule.setProperty(p, args, helpers),
	send: (args) => propsModule.sendMessage(p, args, helpers),

	// --- Делегируем в js ноды (outlet 1) ---
	getcontext: (args) => {
		helpers.log("routing getcontext to js node");
		outlet(1, "getcontext", ...args);
	},
	getsubpatcher: (args) => {
		helpers.log("routing getsubpatcher to js node");
		outlet(1, "getsubpatcher", ...args);
	},
	get: (args) => {
		helpers.log("routing get to js node");
		outlet(1, "get", ...args);
	},
	list: (args) => {
		helpers.log("routing list to js node");
		outlet(1, "list", ...args);
	},
};

// =============================================================================
// ГЛАВНЫЙ РОУТЕР КОМАНД
// =============================================================================

/**
 * anything — универсальный обработчик входящих сообщений
 *
 * Эта функция вызывается автоматически Max'ом когда на вход приходит
 * любое сообщение, которое не соответствует специальным функциям
 * (bang, int, float, list).
 *
 * ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ MAX (доступны внутри функции):
 * - messagename — имя полученного сообщения (первый элемент)
 * - arguments — остальные аргументы сообщения
 * - arrayfromargs() — конвертирует arguments в обычный массив
 *
 * ПРИМЕР:
 * Входящее сообщение: "create slider 100 200"
 * - messagename = "create"
 * - arguments = ["slider", 100, 200]
 */
// biome-ignore lint/correctness/noUnusedVariables: вызывается Max автоматически
function anything() {
	// Получаем имя команды (первое слово сообщения)
	const cmd = messagename;

	// Конвертируем arguments (специальный объект) в обычный массив
	// biome-ignore lint/complexity/noArguments: требуется для Max API
	const args = arrayfromargs(arguments);

	// Логируем для отладки
	helpers.log(`received: ${cmd} ${JSON.stringify(args)}`);

	// Ищем обработчик для команды
	const handler = commandHandlers[cmd];

	if (handler) {
		// Выполняем команду с обработкой ошибок
		try {
			handler(args);
		} catch (error) {
			helpers.sendError(cmd, `Exception: ${error.message || error}`);
		}
	} else {
		helpers.sendError("router", `Unknown command: ${cmd}`);
	}
}

// =============================================================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================================================

/**
 * Сообщение о загрузке скрипта
 */
post("═════════\n");
post("bridge.js loaded successfully\n");
post(
	"Commands: create, remove, connect, disconnect, set, send, get, list, getcontext, getsubpatcher\n",
);
post("═════════\n");
