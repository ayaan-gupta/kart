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
# A phone's line is `Name (26.6.1) (00008120-...)`: an OS version, then a UDID. This Mac's own
# line is `Name (8053D28D-...)`, one group and no version. The shape tells them apart, and unlike
# a name it is the same on every machine.
#
# Matching this Mac by `scutil --get ComputerName`, which is what this did, had two ways to be
# wrong and no way to say so. If the name did not match the line, the Mac stayed in the list and
# `head -1` below pointed the entire build at the laptop; that line carries no version, so the
# iOS 17 check reads a non-number and skips itself, and the first honest error arrives much later
# from xcodebuild. If this Mac's name was a substring of the phone's, which is one rename away on
# a machine where both are named after their owner, the phone was filtered out instead and the
# script reported no phone attached while one was plugged in.
#
# The hardware UUID is exact, has no characters that need quoting, and is what this Mac's own
# line ends with, so it also covers a Mac whose name happens to end in something version shaped.
HOST_UUID="$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')"
[ -n "$HOST_UUID" ] || HOST_UUID='___no-such-machine___'

attached_devices() {
  xcrun xctrace list devices 2>/dev/null \
    | sed -n '/^== Devices ==/,/^== Simulators ==/p' \
    | grep -E '\([0-9]+\.[0-9.]+\) \([0-9A-Fa-f-]+\)$' \
    | grep -v 'Simulator' \
    | grep -vF "$HOST_UUID"
}

DEVICE_LINE="$(attached_devices | head -1)"

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
# Absent is not the same as empty, and treating them alike is how this refused to run on a Mac
# that was correctly set up. The key holds an empty list when Xcode has no accounts, which is the
# case worth stopping on. But `defaults read` also exits non-zero when the key does not exist at
# all, which happens on a Mac where Xcode has never written that preference, and this then told
# someone with an Apple ID signed in that they had none, with no way to get past it.
#
# So: empty list is still a stop, because it is positive evidence. Key missing falls back to
# asking the keychain whether anything here can sign at all, and if something can, this proceeds
# and lets xcodebuild speak for itself. Its "No Accounts" error is clear; being blocked by a
# preference key that moved between Xcode versions is not.
if ACCOUNTS_RAW="$(defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists 2>/dev/null)"; then
  ACCOUNTS_KEY_PRESENT=1
else
  ACCOUNTS_KEY_PRESENT=0
  ACCOUNTS_RAW=""
fi
ACCOUNTS="$(printf '%s' "$ACCOUNTS_RAW" | tr -d ' \n')"

if [ "$ACCOUNTS_KEY_PRESENT" = 0 ]; then
  if security find-identity -v -p codesigning 2>/dev/null | grep -q '[1-9][0-9]* valid identities found'; then
    printf '\nNote: Xcode has not written its accounts preference on this Mac, so this script cannot\n'
    printf 'read which Apple IDs are signed in. There is a valid signing identity in the keychain,\n'
    printf 'so the build goes ahead. If it stops with "No Accounts", add your Apple ID under\n'
    printf 'Xcode, Settings, Accounts and run this again.\n\n'
  else
    cat >&2 <<'MSG'

Xcode has no Apple ID signed in, and this Mac has no signing identity in its keychain
either, so no provisioning profile can be created.

  Xcode -> Settings -> Accounts -> + -> Apple ID

A free Apple ID is enough. It signs a build that runs for seven days before it needs
re-signing, which is fine for trying the app. A paid membership removes the seven-day
limit and allows installing without a cable.

MSG
    fail "Sign in, then run this again."
  fi
elif [ -z "$ACCOUNTS" ] || printf '%s' "$ACCOUNTS" | grep -q '=();'; then
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
anything: every request returns `unconfigured`. Run ./scripts/setup.sh first: it writes this
Mac's address into .env and starts the recognition service.

MSG
  read -r -p "Install anyway? [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || exit 1
fi

# ---- 3b. A free Apple ID's profile lasts seven days, and a stale one is used in preference
# to minting a new one, so a build made after it lapses is signed with the dead profile and the
# install is refused with `0xe8008011 This provisioning profile has expired`. That error arrives
# at the install, long after the build reports success, which reads as the phone rejecting the
# app rather than as the seven days being up. Deleting the expired ones first is what makes
# `-allowProvisioningUpdates` actually update anything.
#
# Only expired ones are removed, and only for this bundle identifier's team, so a valid profile
# for another project on this Mac is left alone.
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
[ -d "$PROFILE_DIR" ] || PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PRUNED=0
if [ -d "$PROFILE_DIR" ]; then
  for prof in "$PROFILE_DIR"/*.mobileprovision; do
    [ -e "$prof" ] || continue
    plist="$(security cms -D -i "$prof" 2>/dev/null)" || continue
    exp="$(printf '%s' "$plist" | plutil -extract ExpirationDate raw - 2>/dev/null)" || continue
    [ -n "$exp" ] || continue
    # String comparison is correct here: both sides are ISO 8601 in UTC, which sorts lexically.
    if [ "$exp" \< "$NOW" ]; then
      rm -f "$prof"
      PRUNED=$((PRUNED + 1))
    fi
  done
fi
[ "$PRUNED" -gt 0 ] && echo "Removed $PRUNED expired provisioning profile(s); Xcode will issue new ones."

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
  # Retry once under a bundle identifier derived from this team, then give up.
  #
  # The obvious reading of this error is "that App ID belongs to someone else", and that is what
  # a fresh clone hits. It is not the only cause: a free Apple ID may also be refused an App ID
  # it held until recently, because free provisioning recycles registrations and caps how many a
  # team may register in a week. That happened here to the identifier this repository ships as
  # its default, on the very team that owns it, and the message is identical. Since the remedy is
  # the same either way, take it automatically rather than printing instructions to run a second
  # script that would work the same thing out.
  DERIVED="dev.kart.$(printf '%s' "${KART_TEAM_ID:-}" | tr '[:upper:]' '[:lower:]')"
  if [ -n "${KART_TEAM_ID:-}" ] && [ "$DERIVED" != "${KART_BUNDLE_ID:-}" ]; then
    echo
    echo "The identifier $KART_BUNDLE_ID cannot be registered to team $KART_TEAM_ID."
    echo "Retrying as $DERIVED, which is derived from the team and is yours alone."
    export KART_BUNDLE_ID="$DERIVED"
    if ! grep -q '^KART_BUNDLE_ID=' "$ROOT/.kartrc" 2>/dev/null; then
      printf 'KART_BUNDLE_ID=%s\n' "$DERIVED" >> "$ROOT/.kartrc"
    else
      sed -i '' "s|^KART_BUNDLE_ID=.*|KART_BUNDLE_ID=$DERIVED|" "$ROOT/.kartrc"
    fi
    echo "Recorded in .kartrc, so later runs use it without asking."
    exec "$0" "$CONFIG"
  fi

  fail "The bundle identifier this build asked for cannot be registered to your Apple team.

App IDs are unique across the whole Apple developer program, so two teams cannot both
register one, and a free team is additionally capped on how many it may register per week.

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
INSTALL_LOG="$(mktemp -t kart-device-install)"
if ! xcrun devicectl device install app --device "$DEVICE_ID" "$APP_DIR" 2>&1 | tee "$INSTALL_LOG"; then :; fi

if ! grep -q 'App installed' "$INSTALL_LOG"; then
  # The expired profile deserves its own message because it is the one failure here that is not
  # a mistake: a free Apple ID signs for seven days, and on the eighth every install stops with
  # `0xe8008011`, reported as an integrity failure. Read literally, "its integrity could not be
  # verified" says the app is corrupt, so the week this went unclassified was spent looking at
  # the build rather than at the calendar. Step 3b already prunes expired profiles before the
  # build, so reaching this means the fresh one was expired too, which only happens if the
  # system clock is wrong or the account lost its certificate.
  if grep -qi 'profile has expired\|0xe8008011' "$INSTALL_LOG"; then
    fail "The signing profile for this build has already expired.

A free Apple ID signs a build for seven days. This script deletes expired profiles before
building so Xcode issues a new one, and the new one is expired too, which means either
this Mac's clock is wrong or the Apple ID in Xcode no longer has a valid certificate.

Check the date, then Xcode -> Settings -> Accounts -> your Apple ID -> Manage Certificates,
and confirm there is an Apple Development certificate. Then run this again.

$(grep -m3 -i 'expired\|error' "$INSTALL_LOG")"
  fi

  if grep -qi 'device is locked\|passcode' "$INSTALL_LOG"; then
    fail "The phone was locked during the install. Unlock it, keep it unlocked, and run this again."
  fi

  fail "The build succeeded and the install did not. Nothing is on the phone.

$(tail -15 "$INSTALL_LOG")

Full log: $INSTALL_LOG"
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
# The phone dials this Mac, so the app is no use until the service is up. serve.sh starts it
# detached from this terminal, or restarts it when the checked-out code is newer than the
# running process, so a re-install after a pull never scans against yesterday's service.
echo "The phone dials this Mac for recognition. Keep the phone on this Mac's wifi."
if ! "$ROOT/scripts/serve.sh"; then
  echo
  echo "Fix the above, then: ./scripts/serve.sh"
fi
echo
echo "A free Apple ID signs this for seven days. Re-run this script to re-sign it."
