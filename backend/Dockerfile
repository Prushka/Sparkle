# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.25.1-bookworm AS build

ARG TARGETOS
ARG TARGETARCH
ARG GIT_COMMIT=unknown
ARG GIT_VERSION=unknown

RUN echo "Building for OS: ${TARGETOS}, Architecture: ${TARGETARCH}, Commit: ${GIT_COMMIT}, Version: ${GIT_VERSION}"

WORKDIR /app

COPY go.mod ./
COPY go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags "-s -w" \
    -trimpath -a -installsuffix cgo -o main ./cmd/api

FROM alpine:3.22

ARG GIT_COMMIT=unknown
ARG GIT_VERSION=unknown
LABEL org.opencontainers.image.title="Sparkle API" \
    org.opencontainers.image.revision=$GIT_COMMIT \
    org.opencontainers.image.version=$GIT_VERSION

RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
ENV ADDR=:1323
ENV OUTPUT=/data/output
RUN mkdir -p /data/output
COPY --from=build /app/main ./
EXPOSE 1323
CMD [ "./main" ]
