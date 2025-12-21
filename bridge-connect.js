/** Creates a patch cord between two objects */
const connectObjects = (p, args, helpers) => {
	const { sendError, sendSuccess } = helpers;

	const [srcId, srcOutlet = 0, dstId, dstInlet = 0] = args;

	if (!srcId || !dstId) {
		sendError("connect", "Both source and destination IDs are required");
		return;
	}

	if (typeof srcOutlet !== "number" || typeof dstInlet !== "number") {
		sendError(
			"connect",
			`Invalid port numbers: outlet=${srcOutlet}, inlet=${dstInlet}`,
		);
		return;
	}

	const src = p.getnamed(srcId);
	const dst = p.getnamed(dstId);

	if (!src) {
		sendError("connect", `Source object not found: ${srcId}`);
		return;
	}
	if (!dst) {
		sendError("connect", `Destination object not found: ${dstId}`);
		return;
	}

	p.connect(src, srcOutlet, dst, dstInlet);
	sendSuccess("connected", srcId, srcOutlet, dstId, dstInlet);
};

/** Removes a patch cord between two objects */
const disconnectObjects = (p, args, helpers) => {
	const { sendError, sendSuccess } = helpers;

	const [srcId, srcOutlet = 0, dstId, dstInlet = 0] = args;

	if (!srcId || !dstId) {
		sendError("disconnect", "Both source and destination IDs are required");
		return;
	}

	const src = p.getnamed(srcId);
	const dst = p.getnamed(dstId);

	if (!src) {
		sendError("disconnect", `Source object not found: ${srcId}`);
		return;
	}
	if (!dst) {
		sendError("disconnect", `Destination object not found: ${dstId}`);
		return;
	}

	p.disconnect(src, srcOutlet, dst, dstInlet);
	sendSuccess("disconnected", srcId, srcOutlet, dstId, dstInlet);
};

module.exports = {
	connectObjects,
	disconnectObjects,
};
