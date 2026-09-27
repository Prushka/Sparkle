export type SubtitleMergeCue = {
	startTime: number;
	endTime: number;
	text: string;
};

export function getActiveTrackText(cues: SubtitleMergeCue[], time: number) {
	return cues
		.filter((cue) => cue.startTime <= time && cue.endTime > time)
		.map((cue) => cue.text)
		.filter(Boolean)
		.join('\n');
}

/** One cue per time interval keeps all selected languages visible in native players. */
export function mergeSubtitleCues(documents: { cues: SubtitleMergeCue[] }[]) {
	const timePoints = new Set<number>();
	for (const document of documents) {
		for (const cue of document.cues) {
			timePoints.add(cue.startTime);
			timePoints.add(cue.endTime);
		}
	}
	const sortedTimes = [...timePoints].sort((a, b) => a - b);
	const mergedCues: SubtitleMergeCue[] = [];
	for (let index = 0; index < sortedTimes.length - 1; index++) {
		const startTime = sortedTimes[index];
		const endTime = sortedTimes[index + 1];
		if (
			!Number.isFinite(startTime) ||
			!Number.isFinite(endTime) ||
			endTime <= startTime ||
			endTime - startTime < 0.01
		)
			continue;
		const sampleTime = startTime + (endTime - startTime) / 2;
		const text = documents
			.map((document) => getActiveTrackText(document.cues, sampleTime))
			.filter(Boolean)
			.join('\n');
		if (!text) continue;
		const previousCue = mergedCues[mergedCues.length - 1];
		if (
			previousCue &&
			previousCue.text === text &&
			Math.abs(previousCue.endTime - startTime) < 0.02
		)
			previousCue.endTime = endTime;
		else mergedCues.push({ startTime, endTime, text });
	}
	return mergedCues;
}
