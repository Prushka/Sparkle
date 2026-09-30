#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

# Only configuration tokens are accepted; never evaluate environment values as code.
# Keep the shared secret out of turnserver's command line and startup diagnostics.
case "${TURN_REALM:-}" in
  ''|*[!A-Za-z0-9.-]*) fail 'TURN_REALM must be a DNS hostname' ;;
esac
for address in "${TURN_EXTERNAL_IP:-}" "${TURN_RELAY_IP:-}"; do
  case "$address" in
    ''|*[!0-9.]*) fail 'TURN_EXTERNAL_IP and TURN_RELAY_IP must be IPv4 addresses' ;;
  esac
done
case "${VOICE_TURN_SECRET:-}" in
  ''|*[!A-Za-z0-9_+/=-]*) fail 'VOICE_TURN_SECRET must use hex, base64, or base64url characters' ;;
esac
[ "${#VOICE_TURN_SECRET}" -ge 32 ] || fail 'VOICE_TURN_SECRET must contain at least 32 characters'
# The container uses /certs; an explicit directory permits isolated config tests.
cert_dir=${1:-/certs}
case "${TURN_TLS_ENABLED:-false}" in
  true)
    [ -r "$cert_dir/fullchain.pem" ] && [ -r "$cert_dir/privkey.pem" ] ||
      fail 'TLS requires readable fullchain.pem and privkey.pem in the certificate directory'
    ;;
  false) ;;
  *) fail 'TURN_TLS_ENABLED must be true or false' ;;
esac

umask 077
config=$(mktemp /tmp/sparkle-turn.XXXXXX)
{
  printf 'realm=%s\n' "$TURN_REALM"
  printf 'listening-ip=%s\nrelay-ip=%s\n' "$TURN_RELAY_IP" "$TURN_RELAY_IP"
  printf 'external-ip=%s/%s\n' "$TURN_EXTERNAL_IP" "$TURN_RELAY_IP"
  printf 'static-auth-secret=%s\n' "$VOICE_TURN_SECRET"
  cat <<'CONFIG'
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49259
use-auth-secret
fingerprint
cli=0
no-multicast-peers
no-tcp-relay
dtls=0
tlsv1=0
tlsv1_1=0
user-quota=24
total-quota=100
max-bps=128000
bps-capacity=12800000
# Public relay credentials must not grant access to the host's private networks.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
pidfile=/tmp/turnserver.pid
CONFIG
  if [ "${TURN_TLS_ENABLED:-false}" = true ]; then
    printf 'cert=%s/fullchain.pem\npkey=%s/privkey.pem\n' "$cert_dir" "$cert_dir"
  else
    printf '%s\n' 'no-tls'
  fi
} > "$config"
unset VOICE_TURN_SECRET
exec turnserver -c "$config"
