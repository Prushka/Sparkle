# Sparkle Backend

This directory contains only the backend pieces used by the frontend:

- Serve processed media assets from `OUTPUT` under `/static/*`
- Return processed media metadata from `OUTPUT/*/job.json` via `/all`
- Store uploaded profile images at `OUTPUT/pfp/:id.png`
- Synchronize rooms over `/sync/:room/:id` websockets

## Run

```sh
../start-backend.sh
```

The API listens on `:1323` and exposes:

- `GET /all`
- `POST /pfp/:id`
- `GET /sync/:room/:id` websocket endpoint
- `GET /static/*` from `OUTPUT`

Useful runtime environment variables:

- `ADDR`, default `:1323`
- `PORT`, used only when `ADDR` is unset
- `OUTPUT`, default `./output`
- `JOBS_CACHE_TTL`, default `15m`
- `MAX_PFP_BYTES`, default `12000000`
