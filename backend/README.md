# Sparkle Backend

This directory contains the extracted HTTP and websocket API backend from
`Sparkle-BE/cmd/api` plus its local package dependency closure.

## Run

```sh
go run ./cmd/api
```

The API listens on `:1323` and exposes:

- `GET /all`
- `GET /purge`
- `POST /pfp/:id`
- `GET /sync/:room`
- `GET /sync/:room/:id` websocket endpoint
- `GET /static/*` from `OUTPUT`

Useful runtime environment variables include `OUTPUT`, `INPUT`, `FFMPEG`,
`FFPROBE`, `MKVEXTRACT`, and the Discord/AI variables defined in
`config/config.go`.
