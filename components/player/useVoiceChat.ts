'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type BroadcastPayload, type Player } from '@/lib/player/t';
import { VoiceSession, type VoiceSnapshot } from '@/lib/player/voice-session';
export type { VoicePeerState } from '@/lib/player/voice-session';

type UseVoiceChatOptions = {
	playerId: string;
	roomPlayers: Player[];
	socketCommunicating: boolean;
	disabled?: boolean;
	send: (_payload: any) => void;
	addSystemMessage: (_message: string) => void;
};
const emptySnapshot: VoiceSnapshot = {
	desiredJoined: false,
	muted: true,
	status: 'idle',
	peerList: [],
	peerMuted: {},
	remoteAudioStreams: [],
	localStream: null
};

export function useVoiceChat({
	playerId,
	roomPlayers,
	socketCommunicating,
	disabled = false,
	send,
	addSystemMessage
}: UseVoiceChatOptions) {
	const controller = useRef<VoiceSession | null>(null);
	const callbacks = useRef({ send, addSystemMessage });
	const [state, setState] = useState(emptySnapshot);
	const [deafened, setDeafened] = useState(false);
	const [speakingIds, setSpeakingIds] = useState<string[]>([]);
	useEffect(() => {
		callbacks.current = { send, addSystemMessage };
	}, [send, addSystemMessage]);
	useEffect(() => {
		if (disabled || !playerId) return;
		let active = true;
		const session = new VoiceSession(
			playerId,
			(payload) => callbacks.current.send(payload),
			(snapshot) => {
				if (active) setState(snapshot);
			},
			(message) => callbacks.current.addSystemMessage(message)
		);
		controller.current = session;
		return () => {
			active = false;
			session.dispose();
			if (controller.current === session) controller.current = null;
		};
	}, [disabled, playerId]);
	useEffect(() => {
		controller.current?.setMembers(roomPlayers.map((p) => p.id));
	}, [disabled, playerId, roomPlayers]);
	useEffect(() => {
		controller.current?.setOnline(socketCommunicating);
	}, [disabled, playerId, socketCommunicating]);

	// Speaking indicators are optional: audio-device failures must not stop voice.
	const monitors = useRef(
		new Map<
			string,
			{
				stream: MediaStream;
				source: MediaStreamAudioSourceNode;
				analyser: AnalyserNode;
				data: Uint8Array<ArrayBuffer>;
				until: number;
			}
		>()
	);
	const context = useRef<AudioContext | null>(null);
	useEffect(() => {
		const streams = new Map(state.remoteAudioStreams.map(({ id, stream }) => [id, stream]));
		if (state.localStream) streams.set(playerId, state.localStream);
		for (const [id, monitor] of monitors.current) {
			if (streams.get(id) !== monitor.stream) {
				monitor.source.disconnect();
				monitor.analyser.disconnect();
				monitors.current.delete(id);
			}
		}
		for (const [id, stream] of streams) {
			if (monitors.current.has(id) || !stream.getAudioTracks().length) continue;
			let source: MediaStreamAudioSourceNode | undefined;
			try {
				if (!context.current || context.current.state === 'closed')
					context.current = new AudioContext();
				void context.current.resume().catch(() => {});
				source = context.current.createMediaStreamSource(stream);
				const analyser = context.current.createAnalyser();
				analyser.fftSize = 512;
				source.connect(analyser);
				monitors.current.set(id, {
					stream,
					source,
					analyser,
					data: new Uint8Array(new ArrayBuffer(512)),
					until: 0
				});
			} catch {
				source?.disconnect();
			}
		}
	}, [playerId, state.localStream, state.remoteAudioStreams]);
	useEffect(() => {
		let frame = 0;
		const tick = () => {
			const speaking: string[] = [];
			for (const [id, monitor] of monitors.current) {
				const live = monitor.stream
					.getAudioTracks()
					.some((t) => t.readyState === 'live' && t.enabled && !t.muted);
				if (live && context.current?.state === 'running') {
					monitor.analyser.getByteTimeDomainData(monitor.data);
					let sum = 0;
					for (const value of monitor.data) sum += ((value - 128) / 128) ** 2;
					if (Math.sqrt(sum / monitor.data.length) > 0.035) monitor.until = performance.now() + 450;
				}
				if (live && monitor.until > performance.now()) speaking.push(id);
			}
			setSpeakingIds((previous) =>
				previous.length === speaking.length && previous.every((id) => speaking.includes(id))
					? previous
					: speaking
			);
			frame = requestAnimationFrame(tick);
		};
		const resume = () => {
			void context.current?.resume().catch(() => {});
		};
		if (state.desiredJoined && !disabled) {
			frame = requestAnimationFrame(tick);
			document.addEventListener('pointerdown', resume);
			document.addEventListener('keydown', resume);
		}
		const activeMonitors = monitors.current;
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener('pointerdown', resume);
			document.removeEventListener('keydown', resume);
			for (const monitor of activeMonitors.values()) {
				monitor.source.disconnect();
				monitor.analyser.disconnect();
			}
			activeMonitors.clear();
			void context.current?.close().catch(() => {});
			context.current = null;
		};
	}, [disabled, state.desiredJoined]);
	const join = useCallback(() => controller.current?.join(), []);
	const configure = useCallback(
		(servers: RTCIceServer[] | undefined) => controller.current?.configure(servers),
		[]
	);
	const leave = useCallback(() => controller.current?.leave(), []);
	const toggleMuted = useCallback(async () => {
		await controller.current?.toggleMuted();
	}, []);
	const toggleDeafened = useCallback(() => setDeafened((value) => !value), []);
	const handleVoiceBroadcast = useCallback(
		async (from: string | undefined, broadcast: BroadcastPayload | undefined) =>
			controller.current?.receive(from, broadcast) ?? false,
		[]
	);
	return {
		...(disabled ? emptySnapshot : state),
		deafened,
		speakingIds,
		join,
		configure,
		leave,
		toggleMuted,
		toggleDeafened,
		handleVoiceBroadcast,
		connectedPeers: state.peerList.filter((peer) => peer.connectionState === 'connected').length
	};
}
