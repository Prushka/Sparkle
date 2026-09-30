import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVoiceChat } from '../../../components/player/useVoiceChat';
import { RemoteVoiceAudio } from '../../../components/player/RemoteVoiceAudio';

const t: any = {
	controllers: {},
	messages: [],
	streams: [],
	pcs: [],
	appliedCandidates: [],
	gains: [],
	micCalls: 0,
	relay: false,
	delayMic: false
};
(window as any).voiceTest = t;
const NativePC = window.RTCPeerConnection;
window.RTCPeerConnection = new Proxy(NativePC, {
	construct(Target, args) {
		const pc = new Target(...args);
		const addIceCandidate = pc.addIceCandidate.bind(pc);
		pc.addIceCandidate = async (candidate) => {
			await addIceCandidate(candidate);
			t.appliedCandidates.push({ pc, candidate });
		};
		t.pcs.push(pc);
		return pc;
	}
});
const gainFactory = AudioContext.prototype.createGain;
AudioContext.prototype.createGain = function () {
	const gain = gainFactory.call(this);
	t.gains.push(gain);
	return gain;
};
const toneContext = new AudioContext();
function tone() {
	const dest = toneContext.createMediaStreamDestination();
	const oscillator = toneContext.createOscillator();
	oscillator.connect(dest);
	oscillator.start();
	t.streams.push(dest.stream);
	return dest.stream;
}
navigator.mediaDevices.getUserMedia = async () => {
	t.micCalls++;
	if (t.delayMic)
		await new Promise<void>((resolve) => {
			t.releaseMic = resolve;
		});
	return tone();
};

function Client({ id, players, online }: { id: string; players: any[]; online: boolean }) {
	const send = useCallback(
		(payload: any) => {
			t.messages.push({ from: id, ...payload });
			if (t.delayAnswers && payload.broadcast.signal.kind === 'answer') {
				t.answers ??= [];
				t.answers.push({ from: id, ...payload });
				return;
			}
			if (t.relay)
				setTimeout(() => {
					if (t.dropOffersFrom === id && payload.broadcast.signal.kind === 'offer') return;
					for (const [other, controller] of Object.entries<any>(t.controllers)) {
						if (other !== id) void controller.handleVoiceBroadcast(id, payload.broadcast);
					}
				}, 0);
		},
		[id]
	);
	const voice = useVoiceChat({
		playerId: id,
		roomPlayers: players,
		socketCommunicating: online,
		send,
		addSystemMessage: () => {}
	});
	useEffect(() => {
		t.controllers[id] = voice;
	});
	return (
		<div>
			{id}:{voice.status}:{voice.connectedPeers}
		</div>
	);
}
function Harness() {
	const [players, setPlayers] = useState<any[]>([{ id: 'a' }, { id: 'b' }]);
	const [online, setOnline] = useState(true);
	const [audio, setAudio] = useState<any>(null);
	useEffect(() => {
		t.presenceTick = () => setPlayers((p) => p.map((player) => ({ ...player, time: 1 })));
		t.setOnline = setOnline;
		t.setPlayers = setPlayers;
		t.showAudio = () => setAudio({ stream: tone(), volume: 2, deafened: false });
		t.setAudio = (patch: any) => setAudio((prev: any) => ({ ...prev, ...patch }));
	}, []);
	return (
		<>
			<Client id="a" players={players} online={online} />
			<Client id="b" players={players} online={online} />
			{audio && <RemoteVoiceAudio {...audio} />}
		</>
	);
}
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Harness />
	</StrictMode>
);
