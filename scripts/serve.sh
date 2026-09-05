#!/usr/bin/env bash
#
# The recognition service on this Mac, which is the thing the phone dials.
#
#   ./scripts/serve.sh            running on the checked-out code when this returns, or says why not
#   ./scripts/serve.sh --status   report and change nothing; exits 0 if it is up
#   ./scripts/serve.sh --stop     stop this project's service, and never anything else's
#
# Until this existed nothing owned the service's lifetime. setup.sh built and installed the app
# and then printed `npm run serve` for the reader to type, so a phone that reached the Mac found
# nothing on 4310 and every scan came back "unavailable", which reads as recognition being
# broken. And on the machine that wrote this, the service was up but from a process started
# before the last change to server/src/prompts.ts, so the phone was scanning against code that a
# measurement had already replaced. Same fault both times, so one script for both: start it if
# it is down, restart it if the code moved, leave it alone otherwise.
#
# "Ours" is decided by asking, not by name: this project's service answers GET / with a JSON body
# carrying "ok". Anything else on the port is somebody's and is not touched. Whether it is stale
# is decided from the process table, by comparing when the listener started with the newest
# file it is built from, including server/.env.local, which is read once at startup.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The same variable server/scripts/serve.ts reads, so the two cannot disagree. 4310 because
# 3000, 8000 and 5432 are taken on the machine this was written on.
PORT="${PORT:-4310}"
export PORT
LOG="$ROOT/server/.serve.log"
MODE="${1:-start}"

name="$(scutil --get LocalHostName 2>/dev/null || true)"
if [ -n "$name" ]; then ADDR="http://$name.local:$PORT"; else ADDR="http://127.0.0.1:$PORT"; fi

# macOS's application firewall. Overridable so the tests can stand in for it; absent on Linux.
FW="${KART_FIREWALL_TOOL:-/usr/libexec/ApplicationFirewall/socketfilterfw}"

# What to do once the service is up. A service that is running is not one a phone can reach,
# and the phone cannot say what it sees, so this says what to check from there and warns about
# the one setting on this Mac that silently refuses every phone.
reachability() {
  echo "check from the phone: open $ADDR in Safari on the phone. It must show {\"ok\":true}."
  [ -x "$FW" ] || return 0
  local state block
  state="$("$FW" --getglobalstate 2>/dev/null)"
  case "$state" in
    *"State = 0"*|*disabled*) return 0 ;;
  esac
  block="$("$FW" --getblockall 2>/dev/null)"
  case "$block" in
    *disabled*|*DISABLED*)
      echo "note: this Mac's firewall is on. If macOS asks whether node may accept incoming connections, allow it."
      ;;
    *)
      echo "warning: this Mac's firewall blocks all incoming connections, so no phone can reach the service." >&2
      echo "         System Settings > Network > Firewall > Options: turn off \"Block all incoming connections\"." >&2
      ;;
  esac
}

listener() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1; }
answers()  { curl -fsS -m 2 "http://127.0.0.1:$PORT/" 2>/dev/null | grep -q '"ok"'; }

# Epoch seconds at which a process started. `lstart` is the one form macOS ps offers that is not
# already rounded to the minute. Its trailing padding is trimmed because date warns about it.
started_at() {
  local l
  l="$(LC_ALL=C ps -p "$1" -o lstart= 2>/dev/null | sed -E 's/ +$//')"
  [ -n "$l" ] || return 1
  LC_ALL=C date -j -f '%a %b %d %T %Y' "$l" '+%s' 2>/dev/null
}

# Epoch seconds of the newest file the service is built from.
newest_source() {
  {
    find server/src server/api server/scripts -type f -name '*.ts' -print0 2>/dev/null
    local f
    for f in server/package.json server/.env.local; do [ -f "$f" ] && printf '%s\0' "$f"; done
  } | xargs -0 stat -f '%m' 2>/dev/null | sort -n | tail -1
}

stale() {
  local started newest
  started="$(started_at "$1")" || return 1
  newest="$(newest_source)"
  [ -n "$newest" ] && [ "$newest" -gt "$started" ]
}

stop_service() {
  kill "$1" 2>/dev/null
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(listener)" ] && return 0
    sleep 0.5
  done
  kill -9 "$1" 2>/dev/null
  sleep 0.5
  [ -z "$(listener)" ]
}

start_service() {
  printf '\n==== %s: started by scripts/serve.sh ====\n' "$(date)" >> "$LOG"
  # Detached three ways: nohup so closing the terminal does not take it down, stdin from
  # /dev/null and both outputs to the log so no pipe back to whatever ran this stays open, and
  # disown so this shell does not wait on it. `npm run serve` is the one definition of how the
  # service starts; this does not restate it.
  nohup npm --prefix server run serve < /dev/null >> "$LOG" 2>&1 &
  local launcher=$! i
  disown "$launcher" 2>/dev/null || true
  for i in $(seq 1 40); do
    if answers; then
      echo "recognition service: running (pid $(listener)) at $ADDR"
      echo "                     log: server/.serve.log"
      reachability
      return 0
    fi
    # The launcher exiting with nothing listening means the service printed its reason and
    # quit, most often for want of an OpenAI key. Say so now rather than after the timeout.
    if ! kill -0 "$launcher" 2>/dev/null && [ -z "$(listener)" ]; then break; fi
    sleep 0.5
  done
  printf 'recognition service: did not start. The last thing it said:\n\n' >&2
  tail -n 12 "$LOG" | sed 's/^/    /' >&2
  printf '\nFull log: server/.serve.log\n' >&2
  return 1
}

pid="$(listener)"
if [ -n "$pid" ] && ! answers; then
  printf 'port %s is held by %s (pid %s), which is not this project'"'"'s service.\n' \
    "$PORT" "$(ps -p "$pid" -o comm= 2>/dev/null || echo '?')" "$pid" >&2
  printf 'Stop it, or run the service elsewhere with PORT=..., which needs the app rebuilt.\n' >&2
  exit 1
fi

case "$MODE" in
  --status)
    if [ -z "$pid" ]; then
      echo "recognition service: not running"
      exit 1
    elif stale "$pid"; then
      echo "recognition service: running (pid $pid) on code older than the checkout"
      echo "                     ./scripts/serve.sh restarts it"
    else
      echo "recognition service: running on current code (pid $pid) at $ADDR"
    fi
    exit 0
    ;;
  --stop)
    if [ -z "$pid" ]; then
      echo "recognition service: not running"
      exit 0
    fi
    stop_service "$pid" || { echo "recognition service: pid $pid would not stop" >&2; exit 1; }
    echo "recognition service: stopped (pid $pid)"
    exit 0
    ;;
  start) ;;
  *)
    printf 'usage: %s [--status|--stop]\n' "$0" >&2
    exit 2
    ;;
esac

if [ -n "$pid" ]; then
  if stale "$pid"; then
    echo "recognition service: restarting, its code changed since it started (pid $pid)"
    stop_service "$pid" || { echo "recognition service: pid $pid would not stop" >&2; exit 1; }
  else
    echo "recognition service: already running on current code (pid $pid) at $ADDR"
    reachability
    exit 0
  fi
fi

start_service
