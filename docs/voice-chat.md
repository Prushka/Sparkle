# Browser voice chat

Sparkle uses its Go room WebSocket for voice **signaling** (presence, SDP offers and
answers, and ICE candidates). Microphone audio is encrypted WebRTC traffic between
browsers, directly or through a TURN relay. It does not pass through the HTTP media
server and is independent of the room's movie playback timeline. Voice is disabled
inside Discord Activities, which provide their own voice facilities.

Joining a room starts listen-only participation. Unmute requests microphone access;
the browser needs HTTPS or a loopback development origin. Mute disables the local
audio track while retaining negotiated connections. Deafen and each participant's
volume affect local output only. Leaving or disposing the player stops microphone
tracks, including a permission request that completes after departure. Revoked room
authorization also stops capture. Device loss
returns the participant to listen-only mode; unmute can acquire a replacement device.

## Connection and audio contracts

- The lower participant ID starts the initial offer. Later overlapping offers use
  polite/impolite negotiation, and all SDP/ICE operations are serialized per peer.
- Voice sessions change when room signaling reconnects. Target session IDs prevent
  delayed negotiation from affecting the new session. Presence heartbeats cannot
  start new offers or prematurely remove a participant whose hello arrived first.
- Candidates arriving before a description are bounded and applied after either
  an offer or an answer, including during ICE restart with an older description
  still installed. Candidates that do not match the new ICE generation are discarded.
- Temporary disconnects get a recovery window. ICE restarts have a five-attempt
  budget, canceled on reconnection or teardown; a connected peer resets that budget.
- Microphone acquisition is single-flight. Speaking detection is optional and
  cannot break voice if Web Audio initialization fails.
- Remote audio supports streamless WebRTC tracks. Native audio remains available
  if volume amplification cannot initialize. Playback and suspended audio contexts
  retry on user interaction and foregrounding; denied autoplay is not an uncaught
  exception. Amplification retains its selected gain after deafen and stream changes.
- Go validates bounded signal payloads. Only hello/status/leave may be room-wide;
  SDP and ICE target a participant in the same room, with server-owned sender identity.
  Room/media authorization and exact-origin checks also apply to voice. No signal
  payloads or relay credentials should appear in browser logs.

## Public relay configuration

The default ICE server is Google's public STUN service. STUN helps discover a
direct route but cannot relay audio through restrictive NAT/firewall combinations.
For a public deployment, operate a reachable TURN service such as coturn with REST
authentication, then set these **backend** environment variables:

```dotenv
VOICE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
VOICE_TURN_SECRET=replace-with-the-same-random-secret-configured-in-coturn
```

Use a random secret of at least 32 characters, matching coturn's `static-auth-secret`
with `use-auth-secret` enabled. Configure the relay's public address, TLS certificate,
listening and relay ports, realm, and quotas for your deployment. TURN is a separate
network service: an HTTP reverse proxy alone does not relay WebRTC traffic.

Go sends one-hour HMAC credentials privately on an authorized room WebSocket;
clients request a refresh every 30 minutes. The long-lived shared secret never
enters a frontend environment variable, bundle, API response, or log. Guest access
to processed-media rooms also permits temporary relay credentials, so configure
relay resource quotas for public access. Raw-room access still requires Plex grants.
Both TURN settings must be supplied together; invalid configuration rejects startup.
An empty configuration preserves STUN-only behavior.

Configuring URLs is not proof that a relay works. Verify a selected `relay`
candidate pair and audible audio with participants on different networks, including
a network that blocks direct UDP. This repository's local browser tests do not
establish external TURN reachability, physical microphone quality, or speaker output.

## Regression checks

`tests/e2e/voice-chat.spec.ts` exercises the actual hook/audio components with real
browser peer connections and synthesized microphone streams. It covers simultaneous
negotiation, delayed ICE, stale sessions, delayed presence, retry bounds, microphone
request races, and device initialization failure. Before the fixes, reproductions
failed for simultaneous unmute, duplicate capture requests, capture completing after
leave, amplification resetting after deafen, and an audio-device exception unmounting
the React room. The original reported crash had no logs, so it cannot be identified
as the exact same device failure.

`tests/e2e/voice-room.spec.ts` uses three independent room sessions and real Go
WebSockets. It checks changing received audio energy, playing audio elements,
listen-only reception, mute/deafen, reconnect, and pause/play/seek synchronization.
It runs with normal browser autoplay rules. Set `SPARKLE_TEST_VOICE_BACKEND` to a
**disposable** backend with no Plex credentials and temporary output/profile/session
directories, and `SPARKLE_TEST_URL` to the running frontend. Prepare its media fixture
with `npm run test:audio`. Playwright does not start either service.

```sh
npx playwright test tests/e2e/voice-chat.spec.ts tests/e2e/voice-room.spec.ts
```

Set `SPARKLE_TEST_CHANNEL=firefox` for Firefox. With Chrome as the default,
`SPARKLE_TEST_VOICE_MIXED=1` uses two Chrome participants and one Firefox participant;
the Playwright Firefox binary must be installed. Go's `TestVoice*` tests cover
payload rejection, routing isolation, timeline preservation, temporary credentials,
and credential renewal. Run `go test ./...`, `go vet ./...`, and `go test -race ./...`
from `backend/` for backend validation.

The design follows the [W3C WebRTC negotiation model](https://www.w3.org/TR/webrtc/#perfect-negotiation-example),
[Chrome autoplay rules](https://developer.chrome.com/blog/autoplay/),
and [coturn's temporary credential protocol](https://github.com/coturn/coturn/blob/master/README.turnserver).
