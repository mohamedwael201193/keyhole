#!/usr/bin/env bash
# Source after securely supplying OUTLAYER_PAYMENT_KEY. Never log the value.
# This pinned CLI calls its environment variable PAYMENT_KEY (submit AND poll).
grant_key_check() {
  case "${OUTLAYER_PAYMENT_KEY:-}" in
    keyhole-devmo.near:2:?*) return 0 ;;
    *) printf '%s\n' 'STOP: key-2 grant credential required' >&2; return 1 ;;
  esac
}
worker_call() {
  grant_key_check || return 1
  local used=0 next
  if test -f "$E/compute.reserved.micro-usd"; then read -r used < "$E/compute.reserved.micro-usd"; fi
  [[ "$used" =~ ^[0-9]+$ ]] || return 1
  next=$((used+3000)); test "$next" -le 99000 || { printf '%s\n' 'STOP: compute reservation cap' >&2; return 1; }
  printf '%s\n' "$next" > "$E/compute.reserved.micro-usd"
  PAYMENT_KEY="$OUTLAYER_PAYMENT_KEY" "$OUT" run keyhole-devmo.near/keyhole --input "$1" --version "$HNEW" --async --compute-limit 3000 --secrets-profile default --secrets-account keyhole-devmo.near
}
worker_status() {
  grant_key_check || return 1
  PAYMENT_KEY="$OUTLAYER_PAYMENT_KEY" "$OUT" status "$1"
}
grant_balance() {
  grant_key_check || return 1
  curl -fsS https://api.outlayer.ai/public/payment-keys/keyhole-devmo.near/2/balance
}
