// A suspended worker or network request must not hold the command queue forever.
// Cancellation rejects the caller even if the underlying browser API never settles.
export function playbackOperation<T>(
	operation: Promise<T>,
	signal: AbortSignal,
	timeout = 45_000
): Promise<T> {
	return new Promise((resolve, reject) => {
		const finish = (callback: () => void) => {
			clearTimeout(timer);
			signal.removeEventListener('abort', cancel);
			callback();
		};
		const cancel = () => finish(() => reject(new DOMException('Playback replaced', 'AbortError')));
		const timer = setTimeout(
			() =>
				finish(() =>
					reject(new Error('Playback stopped responding. Retry playback to reconnect.'))
				),
			timeout
		);
		signal.addEventListener('abort', cancel, { once: true });
		operation.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		);
		if (signal.aborted) cancel();
	});
}

// Bind calls to the real engine, but bound the asynchronous public operations.
// Internal libmedia calls keep their original methods and worker lifecycle.
export function recoverableEngine<T extends object>(engine: T, signal: AbortSignal): T {
	const asynchronous = new Set([
		'load',
		'play',
		'pause',
		'seek',
		'selectAudio',
		'selectSubtitle',
		'setSubtitleLayers'
	]);
	return new Proxy(engine, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== 'function') return value;
			if (!asynchronous.has(String(property))) return value.bind(target);
			return (...args: unknown[]) => {
				if (signal.aborted && property !== 'pause')
					return Promise.reject(new DOMException('Playback replaced', 'AbortError'));
				return playbackOperation(
					Promise.resolve(value.apply(target, args)),
					signal,
					property === 'load' ? 150_000 : 45_000
				);
			};
		}
	});
}
