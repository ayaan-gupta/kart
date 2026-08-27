#!/usr/bin/env bash
#
# Installs Kart on a physical iPhone.
#
# This exists because the install is the one step in `docs/running-on-a-phone.md` that cannot be
# done from a tool: it needs an Apple ID signed into Xcode and a device attached at least once,
# both of which need the account password. Everything either side of it is automated, so this
# script checks the two prerequisites, says exactly what is missing, and otherwise does the whole
# thing in one command.
#
# There is no way around the signing step. Expo Go is not an option: the project carries its own
# Swift modules (AppleInstanceMaskDetector, KartDetector, FrameMetrics, KartFrameLab) plus
# react-native-vision-camera and react-native-worklets-core, and Expo Go can only load the fixed
# set of modules it was built with.
#
#   ./scripts/install-on-device.sh          installs a Release build, which runs on its own
#   ./scripts/install-on-device.sh Debug    installs a Debug build, which needs Metro running
#
# Release is the default because Debug does not stand alone. A Debug build loads its JavaScript
# from the Metro dev server over the network, so opening it without Metro gives
# "No script URL provided ... unsanitizedScriptURLString = (null)" before a single screen draws.
# Release embeds the bundle in the app, which is what "downloaded it to my phone" means. Debug is
# still worth having: it carries the Frame Lab screen, which Release does not.
set -uo pipefail

CONFIG="${1:-Release}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# This machine's Apple team and bundle identifier, written by scripts/setup.sh.
#
# The project reads $(KART_TEAM_ID:default=...) and $(KART_BUNDLE_ID:default=...), so with this
# file absent the build uses the committed defaults and the original author's machine keeps
# working exactly as before. With it present, whoever cloned the repository builds under their
# own team and their own identifier, and project.pbxproj is never edited locally.
#
# The identifier matters more than it looks. App IDs are unique across the entire Apple developer
# program, so a second person building this against `dev.ayaangupta.kart` is told the identifier
# is not available, which reads like a signing misconfiguration rather than what it is.
[ -f "$ROOT/.kartrc" ] && . "$ROOT/.kartrc"
export KART_TEAM_ID="${KART_TEAM_ID:-}" KART_BUNDLE_ID="${KART_BUNDLE_ID:-}"

fail() { printf '\n%s\n' "$*" >&2; exit 1; }

# ---- 1. A device has to be attached, and paired.
# `xctrace list devices` prints simulators too, so the physical ones are the entries that are
# neither a Simulator nor this Mac.
DEVICE_LINE="$(xcrun xctrace list devices 2>/dev/null \
  | sed -n '/^== Devices ==/,/^== Simulators ==/p' \
  | grep -viE 'simulator|^== |^$' \
  | grep -viE "$(scutil --get ComputerName 2>/dev/null || echo '___nope___')" \
  | head -1)"

if [ -z "$DEVICE_LINE" ]; then
  fail "No iPhone is attached.

Plug the phone in with a cable and unlock it. The first time, the phone asks whether to
trust this Mac; answer Trust, then run this again. After that first pairing, later
installs can go over wifi.

Attached devices seen right now:
$(xcrun xctrace list devices 2>/dev/null | sed -n '/^== Devices ==/,/^== Simulators ==/p' | grep -v '^== ' | sed 's/^/  /')"
fi

# The name is for the reader; the UDID is what the build is pointed at.
#
# `-destination "name=..."` was what this used, and it broke on the only device it has ever run
# against: this phone is called "Ayaan's Phone", the trim was a pipe through `xargs`, and `xargs`
# parses quotes, so an apostrophe in a device name makes it exit with "unterminated quote" and
# print nothing. `set -uo pipefail` does not catch that, because the failure is inside a command
# substitution whose exit status is discarded, so the script sailed on with an empty name and
# xcodebuild answered with its full usage text. The UDID is hex and a dash, so nothing downstream
# can misparse it, and the trim is now sed rather than a program that reads shell syntax.
DEVICE_NAME="$(printf '%s' "$DEVICE_LINE" | sed -E 's/ \([0-9]+\.[0-9.]+\) \([0-9A-Fa-f-]+\)$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
DEVICE_ID="$(printf '%s' "$DEVICE_LINE" | sed -E 's/.*\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]+|[0-9A-Fa-f-]{25,})\)$/\1/')"

if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "$DEVICE_LINE" ]; then
  fail "Could not read a device identifier out of this line, so there is nothing to point the
build at:

  $DEVICE_LINE"
fi

echo "Device: $DEVICE_NAME ($DEVICE_ID)"

# ---- 1b. The phone has to be new enough to run the build at all.
# app.json pins a deployment target of iOS 17.0, so an older phone is refused by xcodebuild with
# a message about the destination rather than about the phone, which sends the reader to the
# signing settings. Read from the same line the UDID came from, so it costs nothing.
DEVICE_OS="$(printf '%s' "$DEVICE_LINE" | sed -E 's/.*\(([0-9]+)\.([0-9.]+)\) \([0-9A-Fa-f-]+\)$/\1/')"
if printf '%s' "$DEVICE_OS" | grep -qE '^[0-9]+$' && [ "$DEVICE_OS" -lt 17 ]; then
  fail "$DEVICE_NAME is on iOS $DEVICE_OS, and Kart needs iOS 17 or newer.

The deployment target is set in app.json, under expo.plugins, expo-build-properties,
ios, deploymentTarget. It is 17.0 because the app uses Vision instance mask
segmentation, which does not exist before then.

Update the phone, or use a different one."
fi

# ---- 2. Xcode has to have an Apple ID, or it cannot issue a provisioning profile.
# A development certificate in the keychain is not enough on its own: the profile is what names
# the device, and only an account can create one.
# The key exists even with no accounts in it, holding an empty list, so its presence proves
# nothing: on this machine `defaults read` succeeds and prints `IDE.Identifiers.Prod = ( )`
# while a signing build still fails with "No Accounts". Emptiness is what has to be tested.
# A codesigning identity in the keychain is not a substitute either. There is one here, and it
# is still not enough: the identity signs the binary, the profile names the device, and only an
# account can create a profile.
ACCOUNTS="$(defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists 2>/dev/null | tr -d ' \n')"
if [ -z "$ACCOUNTS" ] || printf '%s' "$ACCOUNTS" | grep -q '=();'; then
  cat >&2 <<'MSG'

Xcode has no Apple ID signed in, so it cannot create a provisioning profile.

  Xcode -> Settings -> Accounts -> + -> Apple ID

A free Apple ID is enough. It signs a build that runs for seven days before it needs
re-signing, which is fine for trying the app. A paid membership removes the seven-day
limit and allows installing without a cable.

MSG
  fail "Sign in, then run this again."
fi

# ---- 3. The endpoint has to be set, or the app installs and names nothing.
# This is gap 1 in docs/running-on-a-phone.md, and it is silent: the app runs, tracks and draws
# outlines with no endpoint at all, so a build made without this looks like a recognition failure
# rather than a configuration one.
if [ ! -f .env ] || ! grep -q '^EXPO_PUBLIC_KART_API_URL=http' .env; then
  cat >&2 <<'MSG'

Warning: EXPO_PUBLIC_KART_API_URL is not set in .env.

The app will install and run, the camera and outlines will work, and it will never name
anything: every request returns `unconfigured`. Start the recognition service with
`npm run serve --prefix server` and put the address it prints into .env first.

MSG
  read -r -p "Install anyway? [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || exit 1
fi

# ---- 4. Build and install.
#
# The output goes to a log rather than the terminal so a failure can be classified. The previous
# version of this script printed two guesses on every failure, and the real failure here was
# neither of them: Developer Mode off on the phone, which xcodebuild reports not as a build error
# but as a destination that never becomes available. Guessing sent the reader to Xcode's signing
# settings, which were already correct.
LOG="$(mktemp -t kart-device-build)"
echo "Building $CONFIG for $DEVICE_NAME. The first device build takes a few minutes."
echo "Log: $LOG"

if ! xcodebuild \
  -workspace ios/Kart.xcworkspace \
  -scheme Kart \
  -configuration "$CONFIG" \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -allowProvisioningUpdates \
  ${KART_TEAM_ID:+KART_TEAM_ID="$KART_TEAM_ID"} \
  ${KART_BUNDLE_ID:+KART_BUNDLE_ID="$KART_BUNDLE_ID"} \
  build 2>&1 | tee "$LOG"; then :; fi

if grep -qi 'Developer Mode disabled' "$LOG"; then
  fail "Developer Mode is off on $DEVICE_NAME, so nothing can be installed on it.

On the phone: Settings -> Privacy & Security -> Developer Mode -> on. It asks to restart;
after the reboot, unlock and confirm the prompt with your passcode. The menu item only
appears once the phone has been attached to a Mac running Xcode, which it now has.

Then run this again."
fi

if grep -qi 'not available\|Failed to register bundle identifier' "$LOG"; then
  fail "The bundle identifier this build asked for belongs to somebody else's Apple team.

App IDs are unique across the whole Apple developer program, so two teams cannot both
register one. This is what a fresh clone hits before it has an identifier of its own.

  ./scripts/setup.sh

works one out from your team and writes it to .kartrc. Then run this again."
fi

if grep -q 'No profiles for' "$LOG"; then
  fail "Xcode has an account but has not made a provisioning profile for this device.

Open ios/Kart.xcworkspace in Xcode once, select the Kart target, and under Signing &
Capabilities pick the team. Xcode registers the device and creates the profile. Then run
this again.

$(grep -m3 'No profiles for' "$LOG")"
fi

if grep -qi 'device is locked' "$LOG"; then
  fail "The phone locked during the install. Unlock it and keep it unlocked, then run this again."
fi

if ! grep -q '\*\* BUILD SUCCEEDED \*\*' "$LOG"; then
  fail "The build failed for a reason this script does not recognise. The last lines were:

$(tail -25 "$LOG")

Full log: $LOG"
fi

# ---- 5. Install.
#
# A separate step because `xcodebuild build` does not install anything: it compiles for the device
# and stops. This script previously printed "Installed" on BUILD SUCCEEDED and the phone's home
# screen stayed empty, which reads as the phone refusing the app rather than as nothing having
# been sent to it. `devicectl` is what actually copies the bundle across.
APP_DIR="$(xcodebuild \
  -workspace ios/Kart.xcworkspace \
  -scheme Kart \
  -configuration "$CONFIG" \
  -destination "platform=iOS,id=$DEVICE_ID" \
  ${KART_TEAM_ID:+KART_TEAM_ID="$KART_TEAM_ID"} \
  ${KART_BUNDLE_ID:+KART_BUNDLE_ID="$KART_BUNDLE_ID"} \
  -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{d=$2} / FULL_PRODUCT_NAME /{n=$2} END{if (d != "" && n != "") print d"/"n}')"

if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR" ]; then
  fail "The build succeeded but the app bundle is not where the build settings say it is:

  ${APP_DIR:-<no path resolved>}

Nothing was installed."
fi

echo "Installing $APP_DIR"
if ! xcrun devicectl device install app --device "$DEVICE_ID" "$APP_DIR"; then
  fail "The build succeeded and the install did not. Nothing is on the phone.

If this says the device is locked, unlock it and run this again."
fi

echo
echo "Installed. On the phone: Settings -> General -> VPN & Device Management, and trust the"
echo "developer certificate the first time. Then open Kart."
echo
if [ "$CONFIG" = "Debug" ]; then
  echo "This is a Debug build, so it needs Metro: run \`npx expo start --dev-client\` and keep the"
  echo "phone on this Mac's wifi, or the app opens on \"No script URL provided\"."
  echo
fi
echo "Recognition needs the service running, with the phone on this Mac's wifi:"
echo
echo "    npm run serve --prefix server"
echo
echo "A free Apple ID signs this for seven days. Re-run this script to re-sign it."
