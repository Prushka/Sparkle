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
authentication. The repository includes [a standalone Compose service](../compose.coturn.yml).
Set these **backend** environment variables (use your actual TURN hostname):

```dotenv
VOICE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
VOICE_TURN_SECRET=<the-same-random-secret-on-Sparkle-and-coturn>
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

## Deploy coturn

This example targets a **Linux Docker host with Docker Compose v2 or newer**, on
the Sparkle server or a separate machine. It uses host networking so relay ports
are not translated by Docker. Windows Docker Desktop is not the qualified public
deployment target for this file. The relay is IPv4-only; publish an A record for
`turn.example.com` pointing directly to its public IPv4 address, without an HTTP
CDN proxy. Do not publish an AAAA record for this configuration.

1. Copy the repository to the relay host (only `compose.coturn.yml` and
   `scripts/coturn-entrypoint.sh` are required if Sparkle runs elsewhere).
2. Generate a secret with `openssl rand -hex 32`. Keep it private. Add the following
   settings to the existing `.env`, or create a dedicated private env file on the
   relay host. Do not replace an existing Sparkle `.env` with the example file.

   ```dotenv
   TURN_REALM=turn.example.com
   TURN_EXTERNAL_IP=203.0.113.10
   TURN_RELAY_IP=203.0.113.10
   TURN_TLS_ENABLED=false
   TURN_TLS_CERT_DIR=./data/coturn/certs
   VOICE_TURN_SECRET=<paste-the-generated-secret-here>
   VOICE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
   ```

   Replace the documentation IP with your server's address. `TURN_RELAY_IP` must
   be assigned to an interface on the Docker host. If the host is behind NAT, set
   it to that host's private IPv4 address and keep `TURN_EXTERNAL_IP` as the public
   address. For example, public `203.0.113.10` might map to local `192.168.1.50`.
   You need controllable port forwarding; an unreachable host behind CGNAT needs a
   public VPS or another TURN provider.

3. Open these inbound ports in the host firewall, cloud firewall, and any NAT router.
   Forward each port to the **same port** on `TURN_RELAY_IP`. Permit outbound UDP
   to public peer addresses and their negotiated ports.

   | Ports              | Purpose                                                                     |
   | ------------------ | --------------------------------------------------------------------------- |
   | UDP and TCP `3478` | Browser-to-TURN connections                                                 |
   | UDP `49160–49259`  | Allocated relay endpoints, including when the browser connects over TCP/TLS |
   | TCP `5349`         | TURN over TLS, after the TLS steps below                                    |

4. Create the certificate directory, validate without printing interpolated secrets,
   and start the relay as its own Compose project:

   ```sh
   mkdir -p data/coturn/certs
   chmod 600 .env
   docker compose --env-file .env -f compose.coturn.yml -p sparkle-turn config --quiet
   docker compose --env-file .env -f compose.coturn.yml -p sparkle-turn up -d
   docker compose --env-file .env -f compose.coturn.yml -p sparkle-turn logs --tail=50 coturn
   ```

   For a dedicated env file, substitute that path in every command. Run from the
   directory containing `compose.coturn.yml`. The image is pinned by version and
   digest; review both when upgrading. Its startup script renders a private
   configuration in tmpfs, keeping the secret out of the process arguments.
   Docker administrators can still inspect container environment variables.

5. Set `VOICE_TURN_URLS` and the **same** `VOICE_TURN_SECRET` on the Sparkle backend.
   [compose.example.yml](../compose.example.yml) passes them only to `sparkle-api`.
   Use frontend/API images from a release containing TURN support, or build the
   current checkout with the [local Docker build commands](../README.md#docker).
   Recreate that service to apply environment changes:

   ```sh
   docker compose --env-file .env -f compose.example.yml up -d sparkle-api
   ```

   If running Sparkle outside Docker, restart it with its normal startup script or
   tray after updating its `.env`. Restarting the backend interrupts room connections.
   Browsers receive TURN configuration on their next room connection. A separate
   relay machine needs the TURN settings only, without Plex or Discord credentials.

The relay allows 100 allocations total, 24 per temporary username, and caps each
allocation at 128,000 bytes/second in each direction. The total bandwidth cap is
12,800,000 bytes/second per direction. These are starting limits for voice, not a
guarantee of a particular room size: one participant can use several allocations.
Tune the quotas and relay port range together in
[coturn-entrypoint.sh](../scripts/coturn-entrypoint.sh), and update firewall rules
when changing the range. Private/link-local/multicast peers are denied, so clients
use their public candidates through this public relay. TURN TCP client connections
remain enabled; `no-tcp-relay` disables RFC 6062 TCP peer allocations, which browser
WebRTC audio does not require.

### Enable TURN over TLS

For public deployments, add TLS as another route through restrictive networks:

1. Obtain a publicly trusted certificate for `TURN_REALM` using your ACME client.
   DNS validation works without taking Caddy's HTTP/HTTPS ports. Place the PEM
   chain at `data/coturn/certs/fullchain.pem` and its private key at
   `data/coturn/certs/privkey.pem`. The directory may instead be an absolute
   `TURN_TLS_CERT_DIR` path. Mount actual files, or ensure any certificate symlink
   targets are also inside that mounted directory.
2. Allow the image's user `65534:65534` to read those files. For a dedicated copy,
   use `sudo chown 65534:65534 data/coturn/certs/*.pem` and
   `sudo chmod 600 data/coturn/certs/*.pem`; leave the containing directory
   traversable. Keep the private key out of Git and public media directories.
3. Set `TURN_TLS_ENABLED=true` and append
   `,turns:turn.example.com:5349?transport=tcp` to `VOICE_TURN_URLS`.
   Open TCP `5349`, then rerun both `up -d` commands above. Missing/unreadable
   certificates reject coturn startup instead of silently disabling requested TLS.
4. Arrange for certificate renewal to refresh those files and restart coturn:
   `docker compose --env-file .env -f compose.coturn.yml -p sparkle-turn restart coturn`.
   Restarting interrupts active relayed calls, so schedule it accordingly.

Networks restricted to TLS on port `443` need an additional deployment choice:
a separate public IP/server with TCP `443` forwarded to coturn's `5349`, or a
carefully configured Layer 4 proxy. Advertise
`turns:turn.example.com:443?transport=tcp` only once that path works. Plain TURN over
TCP `3478` does not provide the same firewall compatibility as TLS on `443`.

### Can Caddy reverse proxy TURN?

Caddy's standard [`reverse_proxy`](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
is an HTTP proxy. TURN is a different protocol, so an ordinary Caddyfile site such
as `turn.example.com { reverse_proxy localhost:3478 }` will not work. Keep Caddy
serving Sparkle HTTPS/WebSockets on `443`, and let coturn handle `3478`, `5349`, and
its UDP relay range directly. They can share a host and public IP using those
distinct ports.

A custom Caddy build with the third-party
[`caddy-l4` plugin](https://github.com/mholt/caddy-l4) can proxy raw TCP/UDP or route
TLS by hostname. This can provide TURN/TLS on `443`, but requires coordinated
listener ownership with Caddy's HTTPS service. The UDP relay endpoints still need
to be publicly reachable. This Compose file does not install or configure that
plugin. Caddy-managed certificates can be copied into coturn's dedicated certificate
directory by a renewal hook; ordinary HTTP proxying alone does not supply coturn's TLS.

### Verify the deployment

Configuring URLs is not proof that a relay works. Verify a selected `relay`
candidate pair and audible audio with participants on different networks, including
a network that blocks direct UDP. This repository's local browser tests do not
establish external TURN reachability, physical microphone quality, or speaker output.
In Chrome, inspect the selected candidate pair in `chrome://webrtc-internals`; in
Firefox, use `about:webrtc`. Normal calls may select direct connections even with
TURN configured. A controlled test with `iceTransportPolicy: 'relay'` verifies the
relay path specifically. Check credentialed allocation, bidirectional audio, and
each advertised UDP/TCP/TLS URL; an open port or a STUN response is insufficient.

Configuration options follow the [coturn Docker guide](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)
and [coturn server configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

## Regression checks

`node scripts/tests/coturn-config.mjs` checks the relay configuration renderer,
required settings, secret handling, and missing-certificate rejection without a
Docker daemon. On Windows, pass the Git Bash executable path as its first argument.
Compose can be checked separately with disposable env values and `config --quiet`;
these checks do not establish that a running relay is reachable from the Internet.

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
