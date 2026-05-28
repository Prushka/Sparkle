'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	BroadcastTypes,
	SyncTypes,
	type BroadcastPayload,
	type Player,
	type VoiceSignalPayload
} from '@/lib/player/t';

type VoiceStatus = 'idle' | 'joining' | 'ready' | 'listen-only' | 'error';
type VoiceConnectionState = RTCPeerConnectionState | 'new' | 'retrying';

export type VoicePeerState = {
	id: string;
	connectionState: VoiceConnectionState;
	attempts: number;
};

type PeerRecord = {
	id: string;
	pc: RTCPeerConnection;
	attempts: number;
	retryTimer: number | null;
	makingOffer: boolean;
	pendingCandidates: RTCIceCandidateInit[];
};

type SpeakingMonitor = {
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	analyser: AnalyserNode;
	data: Uint8Array<ArrayBuffer>;
	activeUntil: number;
};

type UseVoiceChatOptions = {
	playerId: string;
	roomPlayers: Player[];
	socketCommunicating: boolean;
	send: (_payload: any) => void;
	addSystemMessage: (_message: string) => void;
};

const voiceIceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const maxPeerRetryAttempts = 5;
const speakingThreshold = 0.035;
const speakingHoldMs = 450;

function createSessionId() {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
}

function omitKey<T>(value: Record<string, T>, key: string) {
	const next = { ...value };
	delete next[key];
	return next;
}

function isPeerBroken(state: RTCPeerConnectionState | RTCIceConnectionState) {
	return state === 'failed' || state === 'disconnected' || state === 'closed';
}

function toSessionDescription(
	description: RTCSessionDescription | null
): RTCSessionDescriptionInit {
	return {
		type: description?.type ?? 'offer',
		sdp: description?.sdp ?? ''
	};
}

function createAudioSampleBuffer(size: number): Uint8Array<ArrayBuffer> {
	return new Uint8Array(new ArrayBuffer(size));
}

export function useVoiceChat({
	playerId,
	roomPlayers,
	socketCommunicating,
	send,
	addSystemMessage
}: UseVoiceChatOptions) {
	const sessionIdRef = useRef(createSessionId());
	const playerIdRef = useRef(playerId);
	const localStreamRef = useRef<MediaStream | null>(null);
	const peersRef = useRef(new Map<string, PeerRecord>());
	const audioContextRef = useRef<AudioContext | null>(null);
	const speakingMonitorsRef = useRef(new Map<string, SpeakingMonitor>());
	const speakingFrameRef = useRef<number | null>(null);
	const speakingIdsRef = useRef(new Set<string>());
	const desiredJoinedRef = useRef(false);
	const mutedRef = useRef(true);
	const ensurePeerRef = useRef<
		((_remoteId: string, _forceOffer?: boolean) => Promise<void>) | null
	>(null);

	const [desiredJoined, setDesiredJoined] = useState(false);
	const [muted, setMuted] = useState(true);
	const [deafened, setDeafened] = useState(false);
	const [status, setStatus] = useState<VoiceStatus>('idle');
	const [peerStates, setPeerStates] = useState<Record<string, VoicePeerState>>({});
	const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
	const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({});
	const [speakingIds, setSpeakingIds] = useState<string[]>([]);

	useEffect(() => {
		playerIdRef.current = playerId;
	}, [playerId]);

	useEffect(() => {
		desiredJoinedRef.current = desiredJoined;
	}, [desiredJoined]);

	useEffect(() => {
		mutedRef.current = muted;
		for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
			track.enabled = !muted;
		}
	}, [muted]);

	const peerList = useMemo(() => Object.values(peerStates), [peerStates]);
	const connectedPeers = peerList.filter((peer) => peer.connectionState === 'connected').length;
	const remoteAudioStreams = useMemo(
		() => Object.entries(remoteStreams).map(([id, stream]) => ({ id, stream })),
		[remoteStreams]
	);

	const publishSpeakingIds = useCallback(() => {
		const next = Array.from(speakingIdsRef.current);
		setSpeakingIds((prev) => {
			if (prev.length === next.length && prev.every((id) => speakingIdsRef.current.has(id))) {
				return prev;
			}
			return next;
		});
	}, []);

	const markSpeaking = useCallback(
		(id: string, active: boolean) => {
			const speakingIdsSet = speakingIdsRef.current;
			if (active === speakingIdsSet.has(id)) {
				return;
			}
			if (active) {
				speakingIdsSet.add(id);
			} else {
				speakingIdsSet.delete(id);
			}
			publishSpeakingIds();
		},
		[publishSpeakingIds]
	);

	const ensureAudioContext = useCallback(() => {
		if (audioContextRef.current) {
			return audioContextRef.current;
		}
		const AudioContextConstructor =
			window.AudioContext ||
			(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioContextConstructor) {
			return null;
		}
		const context = new AudioContextConstructor();
		audioContextRef.current = context;
		return context;
	}, []);

	const startSpeakingLoop = useCallback(() => {
		if (speakingFrameRef.current !== null) {
			return;
		}
		const tick = () => {
			speakingFrameRef.current = null;
			const now = performance.now();
			for (const [id, monitor] of speakingMonitorsRef.current) {
				const isLocalMuted = id === playerIdRef.current && mutedRef.current;
				const hasLiveAudio = monitor.stream
					.getAudioTracks()
					.some((track) => track.readyState === 'live' && track.enabled);
				if (!isLocalMuted && monitor.stream.active && hasLiveAudio) {
					monitor.analyser.getByteTimeDomainData(monitor.data);
					let sum = 0;
					for (const value of monitor.data) {
						const centered = (value - 128) / 128;
						sum += centered * centered;
					}
					const rms = Math.sqrt(sum / monitor.data.length);
					if (rms > speakingThreshold) {
						monitor.activeUntil = now + speakingHoldMs;
					}
				}
				markSpeaking(id, monitor.activeUntil > now && !isLocalMuted);
			}
			if (speakingMonitorsRef.current.size > 0) {
				speakingFrameRef.current = window.requestAnimationFrame(tick);
			}
		};
		speakingFrameRef.current = window.requestAnimationFrame(tick);
	}, [markSpeaking]);

	const stopSpeakingMonitor = useCallback(
		(id: string) => {
			const monitor = speakingMonitorsRef.current.get(id);
			if (!monitor) {
				return;
			}
			monitor.source.disconnect();
			monitor.analyser.disconnect();
			speakingMonitorsRef.current.delete(id);
			markSpeaking(id, false);
		},
		[markSpeaking]
	);

	const trackSpeakingStream = useCallback(
		(id: string, stream: MediaStream) => {
			if (!id || stream.getAudioTracks().length === 0) {
				return;
			}
			const existing = speakingMonitorsRef.current.get(id);
			if (existing?.stream === stream) {
				return;
			}
			stopSpeakingMonitor(id);
			const context = ensureAudioContext();
			if (!context) {
				return;
			}
			void context.resume().catch(() => {});
			const source = context.createMediaStreamSource(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			analyser.smoothingTimeConstant = 0.45;
			source.connect(analyser);
			speakingMonitorsRef.current.set(id, {
				stream,
				source,
				analyser,
				data: createAudioSampleBuffer(analyser.fftSize),
				activeUntil: 0
			});
			startSpeakingLoop();
		},
		[ensureAudioContext, startSpeakingLoop, stopSpeakingMonitor]
	);

	const updatePeerState = useCallback((id: string, patch: Partial<VoicePeerState>) => {
		setPeerStates((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? { connectionState: 'new', attempts: 0 }), ...patch, id }
		}));
	}, []);

	const sendVoiceSignal = useCallback(
		(targetId: string | undefined, signal: VoiceSignalPayload) => {
			if (!desiredJoinedRef.current) {
				return;
			}
			send({
				type: SyncTypes.BroadcastSync,
				broadcast: {
					type: BroadcastTypes.VoiceSignal,
					targetId,
					signal
				}
			});
		},
		[send]
	);

	const broadcastVoiceStatus = useCallback(() => {
		sendVoiceSignal(undefined, {
			kind: 'status',
			sessionId: sessionIdRef.current,
			muted: mutedRef.current
		});
	}, [sendVoiceSignal]);

	const closePeer = useCallback(
		(remoteId: string) => {
			const record = peersRef.current.get(remoteId);
			if (!record) {
				return;
			}
			if (record.retryTimer !== null) {
				window.clearTimeout(record.retryTimer);
			}
			record.pc.onicecandidate = null;
			record.pc.ontrack = null;
			record.pc.onconnectionstatechange = null;
			record.pc.oniceconnectionstatechange = null;
			record.pc.close();
			peersRef.current.delete(remoteId);
			stopSpeakingMonitor(remoteId);
			setRemoteStreams((prev) => omitKey(prev, remoteId));
			setPeerStates((prev) => omitKey(prev, remoteId));
			setPeerMuted((prev) => omitKey(prev, remoteId));
		},
		[stopSpeakingMonitor]
	);

	const schedulePeerRetry = useCallback(
		(remoteId: string) => {
			const record = peersRef.current.get(remoteId);
			if (!record || record.retryTimer !== null) {
				return;
			}
			if (record.attempts >= maxPeerRetryAttempts) {
				updatePeerState(remoteId, { connectionState: 'failed', attempts: record.attempts });
				return;
			}
			record.attempts += 1;
			const delay = Math.min(8000, 600 * 2 ** Math.max(0, record.attempts - 1));
			updatePeerState(remoteId, { connectionState: 'retrying', attempts: record.attempts });
			record.retryTimer = window.setTimeout(() => {
				const latest = peersRef.current.get(remoteId);
				if (latest) {
					latest.retryTimer = null;
				}
				closePeer(remoteId);
				void ensurePeerRef.current?.(remoteId, true);
			}, delay);
		},
		[closePeer, updatePeerState]
	);

	const createPeerConnection = useCallback(
		(remoteId: string) => {
			const pc = new RTCPeerConnection({ iceServers: voiceIceServers });
			const record: PeerRecord = {
				id: remoteId,
				pc,
				attempts: peersRef.current.get(remoteId)?.attempts ?? 0,
				retryTimer: null,
				makingOffer: false,
				pendingCandidates: []
			};

			const localStream = localStreamRef.current;
			if (localStream) {
				for (const track of localStream.getAudioTracks()) {
					pc.addTrack(track, localStream);
				}
			} else {
				pc.addTransceiver('audio', { direction: 'recvonly' });
			}

			pc.onicecandidate = (event) => {
				if (!event.candidate) {
					return;
				}
				sendVoiceSignal(remoteId, {
					kind: 'ice',
					sessionId: sessionIdRef.current,
					candidate: event.candidate.toJSON()
				});
			};
			pc.ontrack = (event) => {
				const [stream] = event.streams;
				if (!stream) {
					return;
				}
				setRemoteStreams((prev) =>
					prev[remoteId] === stream ? prev : { ...prev, [remoteId]: stream }
				);
				trackSpeakingStream(remoteId, stream);
			};
			pc.onconnectionstatechange = () => {
				updatePeerState(remoteId, {
					connectionState: pc.connectionState || 'new',
					attempts: record.attempts
				});
				if (pc.connectionState === 'connected') {
					record.attempts = 0;
				} else if (isPeerBroken(pc.connectionState)) {
					schedulePeerRetry(remoteId);
				}
			};
			pc.oniceconnectionstatechange = () => {
				if (isPeerBroken(pc.iceConnectionState)) {
					schedulePeerRetry(remoteId);
				}
			};

			peersRef.current.set(remoteId, record);
			updatePeerState(remoteId, { connectionState: 'new', attempts: record.attempts });
			return record;
		},
		[schedulePeerRetry, sendVoiceSignal, trackSpeakingStream, updatePeerState]
	);

	const createOffer = useCallback(
		async (record: PeerRecord) => {
			if (record.makingOffer || record.pc.signalingState !== 'stable') {
				return;
			}
			record.makingOffer = true;
			try {
				const offer = await record.pc.createOffer();
				await record.pc.setLocalDescription(offer);
				sendVoiceSignal(record.id, {
					kind: 'offer',
					sessionId: sessionIdRef.current,
					description: toSessionDescription(record.pc.localDescription)
				});
			} catch (error) {
				console.warn('Voice offer failed', error);
				schedulePeerRetry(record.id);
			} finally {
				record.makingOffer = false;
			}
		},
		[schedulePeerRetry, sendVoiceSignal]
	);

	const ensurePeer = useCallback(
		async (remoteId: string, forceOffer = false) => {
			if (!desiredJoinedRef.current || !playerId || remoteId === playerId) {
				return;
			}
			let record = peersRef.current.get(remoteId);
			if (!record || record.pc.connectionState === 'closed') {
				record = createPeerConnection(remoteId);
			}
			if ((forceOffer || playerId < remoteId) && record.pc.signalingState === 'stable') {
				await createOffer(record);
			}
		},
		[createOffer, createPeerConnection, playerId]
	);

	useEffect(() => {
		ensurePeerRef.current = ensurePeer;
	}, [ensurePeer]);

	const ensureMicrophone = useCallback(async () => {
		if (localStreamRef.current) {
			return localStreamRef.current;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('Voice chat is not supported in this browser');
		}
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true
			},
			video: false
		});
		for (const track of stream.getAudioTracks()) {
			track.enabled = !mutedRef.current;
		}
		localStreamRef.current = stream;
		trackSpeakingStream(playerIdRef.current, stream);
		return stream;
	}, [trackSpeakingStream]);

	const attachLocalStreamToPeers = useCallback(
		(stream: MediaStream) => {
			for (const record of peersRef.current.values()) {
				const hasAudioSender = record.pc
					.getSenders()
					.some((sender) => sender.track?.kind === 'audio');
				if (!hasAudioSender) {
					for (const track of stream.getAudioTracks()) {
						record.pc.addTrack(track, stream);
					}
					void createOffer(record);
				}
			}
		},
		[createOffer]
	);

	const join = useCallback(async () => {
		if (desiredJoinedRef.current) {
			return;
		}
		desiredJoinedRef.current = true;
		setDesiredJoined(true);
		setMuted(true);
		mutedRef.current = true;
		setDeafened(false);
		setStatus('joining');

		try {
			const stream = await ensureMicrophone();
			attachLocalStreamToPeers(stream);
			setStatus('ready');
		} catch (error) {
			console.warn('Voice microphone unavailable', error);
			setStatus('listen-only');
		}

		sendVoiceSignal(undefined, {
			kind: 'hello',
			sessionId: sessionIdRef.current,
			muted: mutedRef.current
		});
	}, [attachLocalStreamToPeers, ensureMicrophone, sendVoiceSignal]);

	const leave = useCallback(() => {
		sendVoiceSignal(undefined, {
			kind: 'leave',
			sessionId: sessionIdRef.current
		});
		desiredJoinedRef.current = false;
		setDesiredJoined(false);
		setStatus('idle');
		for (const remoteId of Array.from(peersRef.current.keys())) {
			closePeer(remoteId);
		}
		stopSpeakingMonitor(playerIdRef.current);
		localStreamRef.current?.getTracks().forEach((track) => track.stop());
		localStreamRef.current = null;
	}, [closePeer, sendVoiceSignal, stopSpeakingMonitor]);

	const toggleMuted = useCallback(async () => {
		if (!desiredJoinedRef.current) {
			await join();
			return;
		}
		if (mutedRef.current && !localStreamRef.current) {
			try {
				const stream = await ensureMicrophone();
				attachLocalStreamToPeers(stream);
				setStatus('ready');
			} catch (error) {
				console.warn('Voice microphone unavailable', error);
				addSystemMessage('Microphone unavailable');
				return;
			}
		}
		const nextMuted = !mutedRef.current;
		mutedRef.current = nextMuted;
		void audioContextRef.current?.resume().catch(() => {});
		for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
			track.enabled = !nextMuted;
		}
		if (nextMuted) {
			markSpeaking(playerIdRef.current, false);
		}
		setMuted(nextMuted);
		broadcastVoiceStatus();
	}, [
		addSystemMessage,
		attachLocalStreamToPeers,
		broadcastVoiceStatus,
		ensureMicrophone,
		join,
		markSpeaking
	]);

	const toggleDeafened = useCallback(() => {
		setDeafened((value) => !value);
	}, []);

	const handleVoiceBroadcast = useCallback(
		async (fromId: string | undefined, broadcast: BroadcastPayload | undefined) => {
			if (
				!fromId ||
				fromId === playerId ||
				broadcast?.type !== BroadcastTypes.VoiceSignal ||
				!broadcast.signal ||
				(broadcast.targetId && broadcast.targetId !== playerId)
			) {
				return false;
			}
			const signal = broadcast.signal;
			if (signal.sessionId === sessionIdRef.current || !desiredJoinedRef.current) {
				return true;
			}
			if (typeof signal.muted === 'boolean') {
				setPeerMuted((prev) => ({ ...prev, [fromId]: signal.muted ?? true }));
			}
			if (signal.kind === 'leave') {
				closePeer(fromId);
				return true;
			}
			if (signal.kind === 'hello') {
				await ensurePeer(fromId);
				broadcastVoiceStatus();
				return true;
			}
			if (signal.kind === 'status') {
				return true;
			}

			let record = peersRef.current.get(fromId);
			if (!record) {
				record = createPeerConnection(fromId);
			}

			try {
				if (signal.kind === 'offer' && signal.description) {
					if (record.pc.signalingState !== 'stable') {
						await record.pc.setLocalDescription({ type: 'rollback' });
					}
					await record.pc.setRemoteDescription(signal.description);
					for (const candidate of record.pendingCandidates.splice(0)) {
						await record.pc.addIceCandidate(candidate);
					}
					const answer = await record.pc.createAnswer();
					await record.pc.setLocalDescription(answer);
					sendVoiceSignal(fromId, {
						kind: 'answer',
						sessionId: sessionIdRef.current,
						description: toSessionDescription(record.pc.localDescription)
					});
				} else if (signal.kind === 'answer' && signal.description) {
					if (record.pc.signalingState !== 'stable') {
						await record.pc.setRemoteDescription(signal.description);
					}
				} else if (signal.kind === 'ice' && signal.candidate) {
					if (record.pc.remoteDescription) {
						await record.pc.addIceCandidate(signal.candidate);
					} else {
						record.pendingCandidates.push(signal.candidate);
					}
				}
			} catch (error) {
				console.warn('Voice signal failed', error);
				schedulePeerRetry(fromId);
			}
			return true;
		},
		[
			broadcastVoiceStatus,
			closePeer,
			createPeerConnection,
			ensurePeer,
			playerId,
			schedulePeerRetry,
			sendVoiceSignal
		]
	);

	useEffect(() => {
		if (!desiredJoined || !socketCommunicating || !playerId) {
			return;
		}
		const remoteIds = new Set(
			roomPlayers.map((player) => player.id).filter((id) => id && id !== playerId)
		);
		for (const remoteId of Array.from(peersRef.current.keys())) {
			if (!remoteIds.has(remoteId)) {
				closePeer(remoteId);
			}
		}
		for (const remoteId of remoteIds) {
			void ensurePeer(remoteId);
		}
	}, [closePeer, desiredJoined, ensurePeer, playerId, roomPlayers, socketCommunicating]);

	useEffect(() => {
		const peers = peersRef.current;
		const speakingMonitors = speakingMonitorsRef.current;
		const speakingIdsSet = speakingIdsRef.current;
		return () => {
			desiredJoinedRef.current = false;
			if (speakingFrameRef.current !== null) {
				window.cancelAnimationFrame(speakingFrameRef.current);
				speakingFrameRef.current = null;
			}
			for (const record of Array.from(peers.values())) {
				if (record.retryTimer !== null) {
					window.clearTimeout(record.retryTimer);
				}
				record.pc.close();
			}
			peers.clear();
			for (const monitor of speakingMonitors.values()) {
				monitor.source.disconnect();
				monitor.analyser.disconnect();
			}
			speakingMonitors.clear();
			speakingIdsSet.clear();
			void audioContextRef.current?.close().catch(() => {});
			audioContextRef.current = null;
			localStreamRef.current?.getTracks().forEach((track) => track.stop());
			localStreamRef.current = null;
		};
	}, []);

	return {
		join,
		leave,
		handleVoiceBroadcast,
		toggleMuted,
		toggleDeafened,
		muted,
		deafened,
		desiredJoined,
		status,
		peerList,
		peerMuted,
		connectedPeers,
		remoteAudioStreams,
		speakingIds
	};
}
