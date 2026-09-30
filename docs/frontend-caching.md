# Frontend asset caching

Production uses a service worker on HTTPS and loopback origins. It caches only
files listed in the build's asset manifest: Next.js chunks, fonts, icons, emotes,
sound effects, subtitle workers and decoder WASM. Assets are downloaded on demand;
installation fetches only the manifest and the small offline page.

Each file has a SHA-256 revision. A full page navigation revalidates the manifest
before serving page subresources. An unchanged file reuses its cached bytes;
a changed file gets a new cache key and a validated network fetch. Downloaded
bytes must match the manifest before storage, including during rolling updates.
Old revisions are evicted within a 256-entry / 256 MiB budget, with a 32 MiB
per-file limit. Cache failures or eviction fall back to the network. Next.js also
keeps its normal immutable HTTP caching for hashed chunks.

Only the dedicated asset cache is searched. API responses, runtime configuration,
sessions, room HTML/state, Plex metadata, original/encoded media and byte ranges
are not stored. Offline navigation displays an offline page, never a cached room.
The worker honors `private` and `no-store` responses and request `no-store`.
Requests containing `X-Plex-Token` bypass the worker, even for manifest asset paths.
See the [Cache API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
for why worker caches need explicit invalidation and storage limits.

`npm run build` generates `public/_sparkle/sw.js` and `assets.json` and their
standalone copies. Production rewrites `/sw.js` to this generated worker, so both
`next start` and the standalone Docker server use the same policy. Deploy these
files together with the matching public assets and Next build. They are generated
and ignored by Git. Edit `scripts/service-worker.js` and `scripts/generate-sw.mjs`.
The worker updates without forcing a reload or interrupting playback; a full
navigation checks new asset revisions even before the new worker activates.

`npm run dev` generates a small cleanup worker at `public/sw.js`. It removes old
Sparkle caches, takes control and unregisters itself, leaving development requests
on the network. Production caching is based on the build mode, not the hostname.
Plain HTTP LAN origins cannot run a service worker; they retain normal HTTP caching.

Run `npx playwright test tests/e2e/service-worker.spec.ts` for isolated Chrome
checks of cache hits, deployment invalidation, private/range exclusion, byte
verification, cache bounds and offline fallback. These tests use disposable local
HTTP fixtures and do not need a running Sparkle backend or real Plex account.
