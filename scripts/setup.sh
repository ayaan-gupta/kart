#!/usr/bin/env bash
#
# One command that takes a fresh clone to Kart running on an attached iPhone.
#
#   ./scripts/setup.sh
#
# Written for someone who has never seen this repository, on a Mac that has never built it, with
# their own Apple ID and their own phone. Everything that can be derived from the machine is
# derived. Everything that cannot is named exactly, once, with the literal thing to click.
#
# Four things genuinely cannot be scripted, because Apple does not allow it, and this script
# detects each one and stops with the specific fix rather than a build error:
#
#   1. Installing Xcode. 15 GB from the App Store, needs an Apple ID and an admin password.
#   2. Signing an Apple ID into Xcode. GUI only, and it wants the account password.
#   3. Developer Mode on the phone. An on-device toggle plus a reboot plus the passcode.
#   4. Trusting the developer certificate on the phone, the first time it runs.
#
# Everything else, including the two things that would otherwise fail confusingly on any machine
# that is not the original author's, is handled here:
#
#   - The bundle identifier. `dev.ayaangupta.kart` is registered to one Apple team, and App IDs
#     are globally unique across the whole developer program, so a second person building this
#     gets "Failed to register bundle identifier ... it is not available". The project reads
#     $(KART_BUNDLE_ID:default=dev.ayaangupta.kart), so this script gives each machine its own
#     identifier derived from its own team, and project.pbxproj never needs a local edit that
#     would come back as a merge conflict on every pull.
#   - The service address. The phone reaches the recognition service over wifi by this Mac's LAN
#     address, which is different on every machine and changes when the network does.
#
# Re-running is safe and is the intended way to pick up a changed network, a new phone, or a
# re-signed build after a free Apple ID's seven days expire.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RC="$ROOT/.kartrc"
STEP=0

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { STEP=$((STEP + 1)); printf '\n\033[1m[%d/8] %s\033[0m\n' "$STEP" "$*"; }
ok()    { printf '      %s\n' "$*"; }
warn()  { printf '      warning: %s\n' "$*"; }
fail()  { printf '\n\033[1mStopped.\033[0m %s\n\n' "$1" >&2; exit 1; }

# `.kartrc` holds this machine's answers so a re-run does not ask again. Git ignored: it names an
# Apple team and a LAN address, both of which are specific to one person's machine.
[ -f "$RC" ] && . "$RC"

# ---------------------------------------------------------------------------------------------
step "Checking this Mac"

[ "$(uname -s)" = "Darwin" ] || fail "Kart is an iOS app, so it builds on macOS only. This is $(uname -s)."

XCODE_PATH="$(xcode-select -p 2>/dev/null || true)"
case "$XCODE_PATH" in
  *Xcode.app*) ok "Xcode: $(xcodebuild -version 2>/dev/null | head -1)" ;;
  *CommandLineTools*)
    fail "Only the Command Line Tools are installed. This project has its own Swift modules and
needs the full Xcode to build them.

  1. Install Xcode from the App Store (about 15 GB).
  2. Open it once and accept the licence.
  3. Point the tools at it:

       sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

Then run this again." ;;
  *) fail "No Xcode found. Install it from the App Store, open it once, then run this again." ;;
esac

# The licence blocks every build with a message that does not mention the licence when it is run
# from a script rather than a terminal Xcode owns, so it is worth testing for directly.
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  fail "Xcode has not finished its first launch, so no build can start.

  Open Xcode once and let it install its additional components. If it asks for the
  licence, accept it. Or, from a terminal:

       sudo xcodebuild -runFirstLaunch

Then run this again."
fi

NODE_MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
[ -n "$NODE_MAJOR" ] || fail "Node is not installed. Install it with \`brew install node\`, or from nodejs.org, then run this again."
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $(node --version) is too old. This needs Node 20 or newer: \`brew install node\`."
ok "Node: $(node --version)"

if ! command -v pod >/dev/null 2>&1; then
  fail "CocoaPods is not installed, and React Native's native dependencies are installed with it.

       brew install cocoapods

  (\`sudo gem install cocoapods\` also works and wants your password; brew does not.)

Then run this again."
fi
ok "CocoaPods: $(pod --version)"

command -v python3 >/dev/null 2>&1 && ok "Python: $(python3 --version 2>&1)" \
  || warn "No python3. Only needed to build replay clips for the offline harness, not to run the app."

# ---------------------------------------------------------------------------------------------
step "Working out who is signing this build"

# A codesigning certificate carries the team identifier in its OU field, and that is the most
# reliable place to read it: the Xcode preference that lists accounts holds Apple IDs, not teams,
# and it exists and reads as present even when it is empty.
if [ -z "${KART_TEAM_ID:-}" ]; then
  KART_TEAM_ID="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -nE 's/.*OU[ ]*=[ ]*([A-Z0-9]{10}).*/\1/p' | head -1)"
fi

if [ -z "${KART_TEAM_ID:-}" ]; then
  fail "No Apple development certificate on this Mac, so there is no team to sign as.

This is the one step that needs your Apple ID and cannot be done from a script:

  1. Open Xcode, Settings, Accounts, and add your Apple ID. A free one is enough.
  2. Open this project's workspace:

       open ios/Kart.xcworkspace

  3. Select the Kart target, then Signing & Capabilities, and pick your name under Team.
     Xcode creates the certificate at that moment. Ignore any bundle identifier error it
     shows there: this script gives you your own identifier in a second, and does not
     change the file Xcode is complaining about.
  4. Quit Xcode and run this again.

If you already know your ten character Team ID, you can skip all of that:

       echo 'KART_TEAM_ID=XXXXXXXXXX' >> .kartrc && ./scripts/setup.sh"
fi
ok "Apple team: $KART_TEAM_ID"

# Derived from the team rather than from a username, because team identifiers are unique across
# the entire developer program and two people called `ayaan` are not. Lowercased because bundle
# identifiers are compared case insensitively and mixed case reads like a mistake.
#
# The team that already owns the committed identifier keeps it. Deriving a fresh one there is
# harmless to the build and wrong for the person: iOS keys an installed app to its bundle
# identifier, so a new one installs a second Kart beside the existing one rather than replacing
# it, and the phone ends up with two icons that look identical. Verified the tedious way, by
# doing it.
DEFAULT_TEAM=9H4C3NF3SZ
DEFAULT_BUNDLE_ID=dev.ayaangupta.kart
if [ -z "${KART_BUNDLE_ID:-}" ]; then
  if [ "$KART_TEAM_ID" = "$DEFAULT_TEAM" ]; then
    KART_BUNDLE_ID="$DEFAULT_BUNDLE_ID"
  else
    KART_BUNDLE_ID="dev.kart.$(printf '%s' "$KART_TEAM_ID" | tr '[:upper:]' '[:lower:]')"
  fi
fi
ok "Bundle identifier: $KART_BUNDLE_ID"
if [ "$KART_TEAM_ID" = "$DEFAULT_TEAM" ]; then
  ok "(this is the team the committed default belongs to, so nothing needed changing)"
else
  ok "(the committed default belongs to another team, and Apple lets exactly one register it)"
fi

# ---------------------------------------------------------------------------------------------
step "Installing dependencies"

if [ ! -d node_modules ]; then
  ok "npm install, in the app. First time takes a couple of minutes."
  npm install --silent || fail "npm install failed in the app. The output above says why."
else
  ok "app dependencies already present"
fi

if [ ! -d server/node_modules ]; then
  ok "npm install, in the recognition service."
  (cd server && npm install --silent) || fail "npm install failed in server/. The output above says why."
else
  ok "service dependencies already present"
fi

if [ ! -d ios/Pods ]; then
  ok "pod install. First time takes a few minutes and downloads the CocoaPods spec repo."
  (cd ios && pod install) >/dev/null 2>&1 || {
    (cd ios && pod install) || fail "pod install failed. The output above says why."
  }
else
  ok "pods already installed"
fi

# ---------------------------------------------------------------------------------------------
step "Pointing the app at this Mac"

# The phone talks to the recognition service over wifi, by this machine's address on the local
# network. Taken from whichever interface actually carries the default route, so this is right on
# a Mac on ethernet, on a dock, or on any interface that is not en0.
lan_address() {
  local iface addr
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  for i in $iface en0 en1 en2; do
    [ -n "$i" ] || continue
    addr="$(ipconfig getifaddr "$i" 2>/dev/null)"
    [ -n "$addr" ] && { printf '%s' "$addr"; return; }
  done
}

LAN="$(lan_address)"
if [ -z "$LAN" ]; then
  warn "This Mac has no address on a local network, so the phone will have nothing to reach."
  warn "Join a wifi network and run this again. Continuing, but recognition will not work."
  API_URL=""
else
  API_URL="http://$LAN:4310"
  ok "Service address for the phone: $API_URL"
fi

# EXPO_PUBLIC_ is the only prefix Expo inlines into the client bundle, which is exactly why
# nothing secret goes in this file. It holds a hostname and nothing else.
if [ -n "$API_URL" ]; then
  if [ -f .env ] && grep -q '^EXPO_PUBLIC_KART_API_URL=' .env; then
    sed -i '' "s|^EXPO_PUBLIC_KART_API_URL=.*|EXPO_PUBLIC_KART_API_URL=$API_URL|" .env
  else
    printf 'EXPO_PUBLIC_KART_API_URL=%s\n' "$API_URL" >> .env
  fi
  ok "written to .env"
fi

# ---------------------------------------------------------------------------------------------
step "Checking the recognition service can start"

for port in 4310 4330; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    holder="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}')"
    warn "port $port is already taken by $holder"
    warn "the service picks these two; stop that process or the service will not bind"
  fi
done

if [ ! -f server/.env.local ] || ! grep -q '^OPENAI_API_KEY=sk-' server/.env.local; then
  cat <<'MSG'

      The recognition service needs an OpenAI API key. Without one the app still installs,
      the camera works, items get outlined and tracked, and barcodes still resolve, but
      nothing is ever named.

      The key is yours and is never committed, never sent to the phone, and never put in
      the app binary: it lives only in server/.env.local, which git ignores.

      Get one at https://platform.openai.com/api-keys

MSG
  printf '      Paste an OpenAI key now, or press Return to skip: '
  read -r KEY
  if [ -n "$KEY" ]; then
    if [ -f server/.env.local ] && grep -q '^OPENAI_API_KEY=' server/.env.local; then
      sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$KEY|" server/.env.local
    else
      printf 'OPENAI_API_KEY=%s\n' "$KEY" >> server/.env.local
    fi
    chmod 600 server/.env.local
    ok "saved to server/.env.local, readable only by you"
  else
    warn "skipped. The app will install and run and will not name anything."
    warn "Add one later: echo 'OPENAI_API_KEY=sk-...' >> server/.env.local"
  fi
else
  ok "OpenAI key already configured"
fi

# ---------------------------------------------------------------------------------------------
step "Remembering this machine's answers"

cat > "$RC" <<RC_EOF
# Written by scripts/setup.sh. Git ignored: this names an Apple team and is specific to this Mac.
# Delete it to have setup work everything out again from scratch.
KART_TEAM_ID=$KART_TEAM_ID
KART_BUNDLE_ID=$KART_BUNDLE_ID
RC_EOF
ok "$RC"

# ---------------------------------------------------------------------------------------------
step "Checking the tree is sound before building it"

if npm run --silent typecheck >/dev/null 2>&1; then
  ok "typecheck clean"
else
  warn "typecheck failed. Building anyway; run \`npm run typecheck\` to see it."
fi

# ---------------------------------------------------------------------------------------------
step "Building and installing on the phone"

export KART_TEAM_ID KART_BUNDLE_ID

if ! xcrun xctrace list devices 2>/dev/null \
  | sed -n '/^== Devices ==/,/^== Simulators ==/p' \
  | grep -viE "simulator|^== |^$|$(scutil --get ComputerName 2>/dev/null || echo '___nope___')" \
  | grep -q .; then
  bold ""
  bold "Everything on this Mac is ready. The phone is not attached yet."
  cat <<'MSG'

  Plug the iPhone in with a cable and unlock it. The first time, it asks whether to trust
  this Mac: answer Trust.

  Then run this again, or just the install step on its own:

      ./scripts/install-on-device.sh

MSG
  exit 0
fi

exec ./scripts/install-on-device.sh "${1:-Release}"
