'use client';

import { useEffect, useRef } from 'react';

export function RemoteVoiceAudio({
	stream,
	deafened,
	volume
}: {
	stream: MediaStream;
	deafened: boolean;
	volume: number;
}) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const gainRef = useRef<GainNode | null>(null);
	const normalized = Number.isFinite(volume) ? Math.max(0, Math.min(5, volume)) : 1;
	const settings = useRef({ deafened, volume: normalized });
	useEffect(() => {
		settings.current = { deafened, volume: normalized };
		if (gainRef.current) gainRef.current.gain.value = deafened ? 0 : normalized;
		if (audioRef.current) {
			audioRef.current.volume = Math.min(1, normalized);
			audioRef.current.muted = deafened || !!gainRef.current;
		}
	}, [deafened, normalized]);
	const boosted = normalized > 1;
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		let disposed = false;
		let context: AudioContext | undefined;
		let source: MediaStreamAudioSourceNode | undefined;
		let gain: GainNode | undefined;
		audio.srcObject = stream;
		try {
			if (boosted) {
				context = new AudioContext();
				source = context.createMediaStreamSource(stream);
				gain = context.createGain();
				gain.gain.value = settings.current.deafened ? 0 : settings.current.volume;
				source.connect(gain);
				gain.connect(context.destination);
			}
		} catch {
			source?.disconnect();
			gain?.disconnect();
			void context?.close().catch(() => {});
			context = undefined;
			gain = undefined;
			source = undefined;
		}
		// Keep the native path audible until the gain context can actually run.
		const applyOutput = () => {
			if (disposed) return;
			const useGain = !!gain && context?.state === 'running';
			gainRef.current = useGain ? gain! : null;
			if (gain) gain.gain.value = settings.current.deafened ? 0 : settings.current.volume;
			audio.muted = settings.current.deafened || useGain;
			audio.volume = Math.min(1, settings.current.volume);
		};
		const play = () => {
			if (disposed) return;
			if (context?.state === 'suspended')
				void context
					.resume()
					.then(applyOutput)
					.catch(() => {});
			applyOutput();
			void audio.play().catch(() => {
				/* Autoplay denial is retried on the next user gesture. */
			});
		};
		if (context) context.onstatechange = applyOutput;
		play();
		document.addEventListener('pointerdown', play);
		document.addEventListener('keydown', play);
		const visible = () => {
			if (document.visibilityState === 'visible') play();
		};
		document.addEventListener('visibilitychange', visible);
		return () => {
			disposed = true;
			document.removeEventListener('pointerdown', play);
			document.removeEventListener('keydown', play);
			document.removeEventListener('visibilitychange', visible);
			if (context) context.onstatechange = null;
			gainRef.current = null;
			source?.disconnect();
			gain?.disconnect();
			void context?.close().catch(() => {});
			audio.pause();
			audio.srcObject = null;
		};
	}, [boosted, stream]);
	return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
}
