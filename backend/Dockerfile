# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.25.1-bookworm AS build

ARG TARGETOS
ARG TARGETARCH
ARG GIT_COMMIT
ARG GIT_VERSION

RUN echo "Building for OS: ${TARGETOS}, Architecture: ${TARGETARCH}, Commit: ${GIT_COMMIT}, Version: ${GIT_VERSION}"

WORKDIR /app
RUN apt update -y

COPY go.mod ./
COPY go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags "-s -w -X Sparkle/config.gitHash=${GIT_COMMIT} -X Sparkle/config.gitVersion=${GIT_VERSION}" \
    -trimpath -a -installsuffix cgo -o main ./cmd/api

FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
# Copy the pre-built binary file from the previous stage
COPY --from=build /app/main ./
CMD [ "./main" ]