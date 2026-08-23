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
#   ./scripts/install-on-device.sh            installs a Debug build (Frame Lab included)
#   ./scripts/install-on-device.sh Release    installs a Release build
#
set -uo pipefail

CONFIG="${1:-Debug}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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

DEVICE_NAME="$(printf '%s' "$DEVICE_LINE" | sed -E 's/ \([0-9]+\.[0-9.]+\) \([0-9A-Fa-f-]+\)$//' | xargs)"
echo "Device: $DEVICE_NAME"

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
echo "Building $CONFIG for $DEVICE_NAME. The first device build takes a few minutes."
xcodebuild \
  -workspace ios/Kart.xcworkspace \
  -scheme Kart \
  -configuration "$CONFIG" \
  -destination "platform=iOS,name=$DEVICE_NAME" \
  -allowProvisioningUpdates \
  build || fail "
The build failed. Two failures are common and neither is about this project's code:

  'No profiles for dev.ayaangupta.kart were found'
      Xcode has an account but has not been asked to make a profile for this device yet.
      Open ios/Kart.xcworkspace in Xcode once, pick the team under Signing & Capabilities,
      and let it register the device. Then run this again.

  'Unable to install ... device is locked'
      Unlock the phone and keep it unlocked while this runs."

echo
echo "Installed. On the phone: Settings -> General -> VPN & Device Management, and trust the"
echo "developer certificate the first time. Then open Kart."
echo
echo "A free Apple ID signs this for seven days. Re-run this script to re-sign it."
