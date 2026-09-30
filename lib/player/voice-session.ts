import { BroadcastTypes, SyncTypes, type BroadcastPayload, type VoiceSignalPayload } from './t';

export type VoicePeerState = {
	id: string;
	connectionState: RTCPeerConnectionState | 'retrying';
	attempts: number;
};
export type VoiceSnapshot = {
	desiredJoined: boolean;
	muted: boolean;
	status: 'idle' | 'joining' | 'ready' | 'listen-only';
	peerList: VoicePeerState[];
	peerMuted: Record<string, boolean>;
	remoteAudioStreams: { id: string; stream: MediaStream }[];
	localStream: MediaStream | null;
};
type Peer = {
	id: string;
	session: string;
	pc: RTCPeerConnection;
	queue: Promise<void>;
	ignoreOffer: boolean;
	candidates: RTCIceCandidateInit[];
	attempts: number;
	timer?: ReturnType<typeof setTimeout>;
	state: VoicePeerState['connectionState'];
	stream?: MediaStream;
};
const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const newSession = () =>
	typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

/** One room participant. Signaling is ordered per peer, independently of media playback. */
export class VoiceSession {
	private joined = false;
	private online = false;
	private disposed = false;
	private muted = true;
	private session = newSession();
	private generation = 0;
	private microphonePending: Promise<void> | null = null;
	private localStream: MediaStream | null = null;
	private peers = new Map<string, Peer>();
	private members = new Set<string>();
	private participants = new Map<
		string,
		{ session: string; muted: boolean; announcedAt: number }
	>();
	private status: VoiceSnapshot['status'] = 'idle';
	private configTimer?: ReturnType<typeof setInterval>;

	constructor(
		private id: string,
		private send: (_payload: unknown) => void,
		private changed: (_snapshot: VoiceSnapshot) => void,
		private message: (_text: string) => void,
		private iceServers: RTCIceServer[] = defaultIceServers
	) {}

	private publish() {
		if (this.disposed) return;
		this.changed({
			desiredJoined: this.joined,
			muted: this.muted,
			status: this.status,
			localStream: this.localStream,
			peerList: [...this.peers.values()].map((p) => ({
				id: p.id,
				connectionState: p.state,
				attempts: p.attempts
			})),
			peerMuted: Object.fromEntries([...this.participants].map(([id, p]) => [id, p.muted])),
			remoteAudioStreams: [...this.peers.values()].flatMap((p) =>
				p.stream ? [{ id: p.id, stream: p.stream }] : []
			)
		});
	}
	private signal(
		kind: VoiceSignalPayload['kind'],
		targetId?: string,
		extra: Partial<VoiceSignalPayload> = {}
	) {
		if (!this.joined || !this.online || this.disposed) return;
		this.send({
			type: SyncTypes.BroadcastSync,
			broadcast: {
				type: BroadcastTypes.VoiceSignal,
				targetId,
				signal: {
					kind,
					sessionId: this.session,
					muted: this.muted,
					...(targetId ? { targetSessionId: this.participants.get(targetId)?.session } : {}),
					...extra
				}
			}
		});
	}
	setOnline(online: boolean) {
		if (online === this.online) return;
		this.online = online;
		clearInterval(this.configTimer);
		this.resetPeers();
		this.participants.clear();
		if (online) {
			this.configTimer = setInterval(
				() => {
					if (this.joined) this.send({ type: 'voiceConfig' });
				},
				30 * 60 * 1000
			);
			this.session = newSession();
			this.signal('hello');
		}
		this.publish();
	}
	configure(servers: RTCIceServer[] | undefined) {
		if (!Array.isArray(servers) || servers.length === 0 || servers.length > 9) return;
		this.iceServers = servers;
		for (const peer of this.peers.values()) {
			try {
				peer.pc.setConfiguration({ iceServers: servers });
				if (peer.pc.connectionState !== 'connected') peer.pc.restartIce();
			} catch {
				this.retry(peer);
			}
		}
	}
	setMembers(ids: string[]) {
		const previousMembers = this.members;
		this.members = new Set(ids);
		let changed = false;
		for (const [id, participant] of this.participants) {
			// A hello can precede the next full presence snapshot. Do not erase a
			// newcomer when an older status heartbeat arrives during that interval.
			if (
				!this.members.has(id) &&
				(previousMembers.has(id) || Date.now() - participant.announcedAt > 5000)
			) {
				this.closePeer(id);
				this.participants.delete(id);
				changed = true;
			}
		}
		if (changed) this.publish();
	}
	join() {
		if (this.disposed || this.joined) return;
		if (typeof RTCPeerConnection === 'undefined') {
			this.message('Voice chat is unavailable in this browser');
			return;
		}
		this.joined = true;
		this.muted = true;
		this.status = 'listen-only';
		this.session = newSession();
		this.signal('hello');
		this.publish();
	}
	leave() {
		this.signal('leave');
		this.joined = false;
		this.muted = true;
		this.status = 'idle';
		this.generation++;
		this.microphonePending = null;
		this.resetPeers();
		this.participants.clear();
		this.localStream?.getTracks().forEach((track) => {
			track.onended = null;
			track.stop();
		});
		this.localStream = null;
		this.publish();
	}
	dispose() {
		clearInterval(this.configTimer);
		this.leave();
		this.disposed = true;
	}

	async toggleMuted() {
		if (this.disposed || !this.joined) return;
		if (this.microphonePending) return this.microphonePending;
		if (!this.muted) {
			this.setMuted(true);
			return;
		}
		if (this.localStream?.getAudioTracks().some((t) => t.readyState === 'live')) {
			this.setMuted(false);
			return;
		}
		const generation = this.generation;
		this.status = 'joining';
		this.publish();
		const request = async () => {
			try {
				if (!navigator.mediaDevices?.getUserMedia)
					throw new Error('Microphone requires a secure browser context');
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
					video: false
				});
				if (this.disposed || !this.joined || generation !== this.generation) {
					stream.getTracks().forEach((t) => t.stop());
					return;
				}
				if (!stream.getAudioTracks().some((t) => t.readyState === 'live')) {
					stream.getTracks().forEach((t) => t.stop());
					throw new Error('No microphone track');
				}
				this.localStream = stream;
				for (const track of stream.getAudioTracks()) {
					track.enabled = false;
					track.onended = () => {
						if (this.localStream !== stream) return;
						this.localStream = null;
						stream.getTracks().forEach((t) => {
							t.onended = null;
							t.stop();
						});
						this.setMuted(true);
						this.status = 'listen-only';
						this.publish();
						this.message('Microphone disconnected. Unmute to select an available microphone.');
					};
				}
				for (const peer of this.peers.values()) this.attachMicrophone(peer);
				this.status = 'ready';
				this.setMuted(false);
			} catch {
				if (generation === this.generation && !this.disposed && this.joined) {
					this.status = 'listen-only';
					this.publish();
					this.message('Microphone unavailable. Check microphone permission and HTTPS.');
				}
			} finally {
				if (generation === this.generation) this.microphonePending = null;
			}
		};
		this.microphonePending = Promise.resolve().then(request);
		return this.microphonePending;
	}
	private setMuted(muted: boolean) {
		this.muted = muted;
		for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
		this.signal('status');
		for (const id of this.participants.keys()) this.reconcile(id);
		this.publish();
	}
	private current(peer: Peer) {
		return !this.disposed && this.joined && this.online && this.peers.get(peer.id) === peer;
	}
	private closePeer(id: string) {
		const peer = this.peers.get(id);
		if (!peer) return;
		this.peers.delete(id);
		clearTimeout(peer.timer);
		peer.pc.onicecandidate = null;
		peer.pc.ontrack = null;
		peer.pc.onnegotiationneeded = null;
		peer.pc.onconnectionstatechange = null;
		peer.pc.oniceconnectionstatechange = null;
		peer.pc.close();
	}
	private resetPeers() {
		for (const id of this.peers.keys()) this.closePeer(id);
	}
	private enqueue(peer: Peer, operation: () => Promise<void>) {
		peer.queue = peer.queue
			.then(async () => {
				if (this.current(peer)) await operation();
			})
			.catch(() => {
				if (this.current(peer)) this.retry(peer);
			});
		return peer.queue;
	}
	private retry(peer: Peer, delay = 2000) {
		if (!this.current(peer) || peer.timer || peer.state === 'failed') return;
		if (peer.attempts >= 5) {
			peer.state = 'failed';
			this.publish();
			this.message('Voice could not connect to another player. Rejoin the room to retry.');
			return;
		}
		peer.state = 'retrying';
		this.publish();
		peer.timer = setTimeout(() => {
			peer.timer = undefined;
			if (!this.current(peer)) return;
			peer.attempts++;
			void this.enqueue(peer, async () => {
				// Abandon an unanswered local offer before requesting a fresh ICE generation.
				if (peer.pc.signalingState === 'have-local-offer')
					await peer.pc.setLocalDescription({ type: 'rollback' });
				if (!this.current(peer)) return;
				peer.pc.restartIce();
				this.retry(peer, 12000);
			});
		}, delay);
	}
	private attachMicrophone(peer: Peer) {
		const track = this.localStream?.getAudioTracks()[0];
		if (!track) return;
		const transceiver = peer.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
		if (transceiver) {
			transceiver.direction = 'sendrecv';
			void this.enqueue(peer, async () => {
				await transceiver.sender.replaceTrack(track);
			});
		} else {
			peer.pc.addTrack(track, this.localStream!);
		}
	}
	private reconcile(id: string) {
		const participant = this.participants.get(id);
		if (!this.joined || !this.online || !participant) {
			this.closePeer(id);
			return;
		}
		if (this.peers.has(id)) return;
		// Keep negotiated connections while muted. Toggling a microphone should
		// not discard ICE generations or race delayed messages from the same session.
		if (this.muted && participant.muted) return;
		try {
			const pc = new RTCPeerConnection({ iceServers: this.iceServers });
			const peer: Peer = {
				id,
				session: participant.session,
				pc,
				queue: Promise.resolve(),
				ignoreOffer: false,
				candidates: [],
				attempts: 0,
				state: 'new'
			};
			this.peers.set(id, peer);
			pc.onnegotiationneeded = () => {
				void this.enqueue(peer, async () => {
					if (pc.signalingState !== 'stable') return;
					if (!pc.remoteDescription && this.id > id && peer.attempts === 0) return;
					await pc.setLocalDescription();
					if (this.current(peer))
						this.signal('offer', id, { description: pc.localDescription!.toJSON() });
				});
			};
			pc.onicecandidate = (event) => {
				if (this.current(peer) && event.candidate)
					this.signal('ice', id, { candidate: event.candidate.toJSON() });
			};
			pc.ontrack = (event) => {
				if (!this.current(peer) || event.track.kind !== 'audio') return;
				// Streamless tracks are valid WebRTC. replaceTrack does not necessarily send an MSID.
				peer.stream = event.streams[0] ?? new MediaStream([event.track]);
				this.publish();
			};
			const connectionChanged = () => {
				if (!this.current(peer)) return;
				if (pc.connectionState === 'connected') {
					clearTimeout(peer.timer);
					peer.timer = undefined;
					peer.attempts = 0;
					peer.state = 'connected';
				} else if (
					pc.connectionState === 'failed' ||
					pc.connectionState === 'disconnected' ||
					pc.iceConnectionState === 'failed'
				) {
					this.retry(peer);
				} else if (peer.state !== 'retrying' && peer.state !== 'failed')
					peer.state = pc.connectionState;
				this.publish();
			};
			pc.onconnectionstatechange = connectionChanged;
			pc.oniceconnectionstatechange = connectionChanged;
			pc.addTransceiver('audio', { direction: this.localStream ? 'sendrecv' : 'recvonly' });
			this.attachMicrophone(peer);
			this.retry(peer, 12000);
			this.publish();
		} catch {
			this.closePeer(id);
			this.message('Unable to initialize voice in this browser');
		}
	}
	private candidateMatches(peer: Peer, candidate: RTCIceCandidateInit) {
		const ufrag = candidate.usernameFragment;
		return (
			!ufrag ||
			(peer.pc.remoteDescription?.sdp ?? '').split(/\r?\n/).includes(`a=ice-ufrag:${ufrag}`)
		);
	}
	async receive(from: string | undefined, broadcast: BroadcastPayload | undefined) {
		if (
			!from ||
			from === this.id ||
			broadcast?.type !== BroadcastTypes.VoiceSignal ||
			(broadcast.targetId && broadcast.targetId !== this.id)
		)
			return false;
		const s = broadcast.signal;
		if (!this.joined || !this.online || this.disposed || !s || typeof s.sessionId !== 'string')
			return true;
		if (s.targetSessionId && s.targetSessionId !== this.session) return true;
		if (s.kind === 'hello' || s.kind === 'status') {
			if (typeof s.muted !== 'boolean') return true;
			const previous = this.participants.get(from);
			if (previous && previous.session !== s.sessionId) this.closePeer(from);
			this.participants.set(from, {
				session: s.sessionId,
				muted: s.muted,
				announcedAt: Date.now()
			});
			if (s.kind === 'hello') this.signal('status', from);
			this.reconcile(from);
			this.publish();
			return true;
		}
		if (this.participants.get(from)?.session !== s.sessionId) return true;
		if (s.kind === 'leave') {
			this.closePeer(from);
			this.participants.delete(from);
			this.publish();
			return true;
		}
		const peer = this.peers.get(from);
		if (!peer || peer.session !== s.sessionId) return true;
		await this.enqueue(peer, async () => {
			const pc = peer.pc;
			if (
				(s.kind === 'offer' || s.kind === 'answer') &&
				s.description?.type === s.kind &&
				typeof s.description.sdp === 'string'
			) {
				const collision = s.kind === 'offer' && pc.signalingState !== 'stable';
				// Exactly one side yields to an overlapping offer (W3C perfect negotiation).
				peer.ignoreOffer = collision && this.id < from;
				if (peer.ignoreOffer) return;
				if (s.kind === 'answer' && pc.signalingState !== 'have-local-offer') return;
				await pc.setRemoteDescription(s.description);
				if (!this.current(peer)) return;
				for (const candidate of peer.candidates.splice(0))
					if (this.candidateMatches(peer, candidate)) await pc.addIceCandidate(candidate);
				if (s.kind === 'offer') {
					await pc.setLocalDescription();
					if (this.current(peer))
						this.signal('answer', from, { description: pc.localDescription!.toJSON() });
				}
			} else if (s.kind === 'ice' && s.candidate && typeof s.candidate === 'object') {
				if (peer.ignoreOffer) return;
				if (pc.remoteDescription && this.candidateMatches(peer, s.candidate)) {
					await pc.addIceCandidate(s.candidate);
				} else if (peer.candidates.length < 128) {
					// A restart's candidates can precede its SDP while the previous
					// remote description is still installed. Match them when SDP arrives.
					peer.candidates.push(s.candidate);
				}
			}
		});
		return true;
	}
}
