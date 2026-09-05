#!/usr/bin/env bash
#
# One command that takes a fresh clone to Kart running on an attached iPhone.
#
#   ./scripts/setup.sh            set everything up and install on the attached phone
#   ./scripts/setup.sh --check    say what is missing and change nothing
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
# Everything else is done here, on any Mac, asking for nothing but the Mac password where Apple
# or Homebrew require it: pointing the command line tools at an installed Xcode, Xcode's licence
# and first launch, Homebrew, Node and CocoaPods when they are missing, the node path Xcode's
# build phases need, the OpenAI key (asked first, so the slow part runs unattended), waiting for
# the phone to be plugged in and trusted, and the two things that would otherwise fail
# confusingly on any machine that is not the original author's:
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

# CocoaPods calls String#unicode_normalize on the repository path and dies with
# "Unicode Normalization not appropriate for ASCII-8BIT" when the locale is not UTF-8. A login
# shell usually sets one; a script run from another program inherits whatever it was given, which
# on a fresh clone here was nothing. Found by running this script in a clean clone, which is the
# only way it shows up: the machine that wrote it has LANG set in its profile.
case "${LANG:-}" in
  *UTF-8|*utf8) : ;;
  *) export LANG=en_US.UTF-8 ;;
esac

RC="$ROOT/.kartrc"
STEP=0

# `--check` answers "will this work on my machine" without spending the ten minutes that finding
# out the slow way costs. It reads the machine and reports; it installs nothing, writes nothing,
# and builds nothing.
CHECK=0
if [ "${1:-}" = "--check" ]; then CHECK=1; shift; fi

# Where an installed Xcode is looked for, where Homebrew lives, and how long to wait for a phone.
# Each is overridable so the tests can stand a throwaway Mac up around this script.
XCODE_APPS="${KART_XCODE_APPS:-/Applications:$HOME/Applications}"
if [ "$(uname -m 2>/dev/null)" = "arm64" ]; then BREW_PREFIX_DEFAULT=/opt/homebrew; else BREW_PREFIX_DEFAULT=/usr/local; fi
BREW_PREFIX="${KART_BREW_PREFIX:-$BREW_PREFIX_DEFAULT}"
PHONE_WAIT="${KART_PHONE_WAIT_SECONDS:-180}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
# Twelve. The count was wrong from the first version and the last step printed "[9/8]", which is
# a small thing that reads like the script has lost its place. Recount when adding a step.
step()  { STEP=$((STEP + 1)); printf '\n\033[1m[%d/12] %s\033[0m\n' "$STEP" "$*"; }
ok()    { printf '      %s\n' "$*"; }
WARNINGS=0
warn()  { WARNINGS=$((WARNINGS + 1)); printf '      warning: %s\n' "$*"; }
fail()  { printf '\n\033[1mStopped.\033[0m %s\n\n' "$1" >&2; exit 1; }

# `.kartrc` holds this machine's answers so a re-run does not ask again. Git ignored: it names an
# Apple team and a LAN address, both of which are specific to one person's machine.
[ -f "$RC" ] && . "$RC"

# Whether node_modules and ios/Pods are current, read from what npm and CocoaPods write.
. "$ROOT/scripts/lib/deps.sh"

# ---------------------------------------------------------------------------------------------
step "Checking this Mac"

[ "$(uname -s)" = "Darwin" ] || fail "Kart is an iOS app, so it builds on macOS only. This is $(uname -s)."

# Xcode, and the command line tools pointed at it. Installing Xcode from the App Store does not
# point them there: `xcode-select -p` goes on answering CommandLineTools until someone runs
# `xcode-select -s`, which needs an administrator password. That is the single most common state
# of a Mac that has "installed Xcode", so it is handled here rather than stopped on.
find_xcode() {
  local dir app
  local IFS=:
  for dir in $XCODE_APPS; do
    for app in "$dir"/Xcode.app "$dir"/Xcode*.app; do
      [ -d "$app/Contents/Developer" ] && { printf '%s' "$app"; return 0; }
    done
  done
  return 1
}

XCODE_PATH="$(xcode-select -p 2>/dev/null || true)"
case "$XCODE_PATH" in
  *Xcode*.app*) ;;
  *)
    if XCODE_APP="$(find_xcode)"; then
      if [ "$CHECK" = 1 ]; then
        warn "Xcode is installed at $XCODE_APP, but the command line tools point at"
        warn "${XCODE_PATH:-nothing}. A real run points them at Xcode, which asks for your password."
      else
        ok "Xcode is installed at $XCODE_APP, but the command line tools point elsewhere."
        ok "Pointing them at it. This asks for your Mac password once."
        sudo xcode-select -s "$XCODE_APP/Contents/Developer" \
          || fail "Could not point the command line tools at Xcode. Run this yourself, then run setup again:

       sudo xcode-select -s $XCODE_APP/Contents/Developer"
      fi
    elif [ -n "$XCODE_PATH" ]; then
      fail "Only the Command Line Tools are installed. This project has its own Swift modules and
needs the full Xcode to build them.

  1. Install Xcode from the App Store (about 15 GB).
  2. Run this again. It points the tools at Xcode and finishes Xcode's first launch itself."
    else
      fail "No Xcode found. Install it from the App Store (about 15 GB), then run this again."
    fi
    ;;
esac
ok "Xcode: $(xcodebuild -version 2>/dev/null | head -1)"

# The licence and the first-launch components block every build with a message that does not
# mention either when the build is run from a script. Both need an administrator, and both are
# one command, so they are done here rather than described.
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  if [ "$CHECK" = 1 ]; then
    warn "Xcode has not finished its first launch. A real run accepts the licence and installs"
    warn "its components, which asks for your password."
  else
    ok "Xcode has not finished its first launch. Accepting the licence and installing its"
    ok "components. This asks for your Mac password and takes a minute or two."
    sudo xcodebuild -license accept >/dev/null 2>&1 || true
    sudo xcodebuild -runFirstLaunch \
      || fail "Xcode's first launch did not finish. Open Xcode once, let it install its components, then run this again."
    xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 \
      || fail "Xcode still reports its first launch as unfinished. Open Xcode once, let it finish, then run this again."
  fi
fi

# Xcode being present is not the same as Xcode being able to build this. app.json pins a
# deployment target of iOS 17.0, and an Xcode whose iPhoneOS SDK is older cannot compile against
# it. Asked as "what SDK do you have" rather than "what Xcode version is this", because the SDK
# is the thing that has to be new enough and the mapping from Xcode version to SDK is not one a
# script should be carrying a table of.
SDK_VER="$(xcrun --sdk iphoneos --show-sdk-version 2>/dev/null)"
SDK_MAJOR="$(printf '%s' "$SDK_VER" | sed -E 's/^([0-9]+).*/\1/')"
if printf '%s' "$SDK_MAJOR" | grep -qE '^[0-9]+$'; then
  if [ "$SDK_MAJOR" -lt 17 ]; then
    fail "This Xcode's iPhone SDK is $SDK_VER, and Kart is built against iOS 17.

The deployment target is 17.0 because the app uses Vision instance mask segmentation,
which does not exist before then. An SDK older than that cannot compile it.

  Update Xcode from the App Store, open it once, then run this again."
  fi
  ok "iPhone SDK: $SDK_VER"
else
  SDK_MAJOR=""
  warn "Could not read the iPhone SDK version from this Xcode. Continuing; a build against an"
  warn "SDK older than iOS 17 will fail at compile time rather than here."
fi

# React Native 0.86 and Expo SDK 57 are built and tested against Xcode 16. Older may work and is
# not refused, because this is a number that goes stale and a wrong guess here would stop a
# machine that would have built fine. Said out loud so an odd build failure has a first suspect.
XCODE_MAJOR="$(xcodebuild -version 2>/dev/null | sed -nE '1s/^Xcode ([0-9]+).*/\1/p')"
if printf '%s' "$XCODE_MAJOR" | grep -qE '^[0-9]+$' && [ "$XCODE_MAJOR" -lt 16 ]; then
  warn "Xcode $XCODE_MAJOR. React Native 0.86 expects Xcode 16 or newer; this may still build,"
  warn "but if it fails in a way that mentions Swift or the toolchain, update Xcode first."
fi

# Homebrew is how Node and CocoaPods get onto a Mac that has neither. A Mac that has it but not
# on this shell's PATH (installed a minute ago, profile not yet reloaded) is the common case, so
# the prefix is looked at before anything is downloaded. The installer is Homebrew's own, from
# https://brew.sh, and asks for an administrator password.
ensure_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  if [ -x "$BREW_PREFIX/bin/brew" ]; then
    eval "$("$BREW_PREFIX/bin/brew" shellenv)"
    ok "Homebrew is installed at $BREW_PREFIX and was not on this shell's PATH. Using it."
  else
    [ "$CHECK" = 1 ] && return 1
    ok "Installing Homebrew, which is how Node and CocoaPods are installed. This asks for your"
    ok "Mac password and takes a few minutes."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || fail "Homebrew did not install. The output above says why; https://brew.sh has the same command."
    [ -x "$BREW_PREFIX/bin/brew" ] \
      || fail "Homebrew installed somewhere other than $BREW_PREFIX. Open a new terminal and run this again."
    eval "$("$BREW_PREFIX/bin/brew" shellenv)"
  fi
  # So the next terminal finds it as well. This is the one line Homebrew's installer asks you to
  # add to your profile, added for you.
  if [ "$CHECK" != 1 ] && ! grep -qs 'brew shellenv' "$HOME/.zprofile"; then
    printf '\n# Homebrew, added by Kart'"'"'s scripts/setup.sh\neval "$(%s/bin/brew shellenv)"\n' "$BREW_PREFIX" >> "$HOME/.zprofile"
    ok "added Homebrew to ~/.zprofile so new terminals see it"
  fi
}

# Node 22, not 20: `npm run serve` reads the key with --env-file-if-exists, which landed in 22.
if ! command -v node >/dev/null 2>&1; then
  if [ "$CHECK" = 1 ]; then
    warn "Node is not on this shell's PATH. A real run installs it with Homebrew. (If you use nvm,"
    warn "fnm or asdf, it is only on the PATH of a login shell; that is fine, brew's works too.)"
  else
    ensure_brew
    ok "Installing Node with Homebrew."
    brew install node || fail "brew install node failed. The output above says why."
    command -v node >/dev/null 2>&1 || fail "Node installed but is still not on PATH. Open a new terminal and run this again."
  fi
fi
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || fail "Node $(node --version) is too old. This needs Node 22 or newer: \`brew install node\`, then open a new terminal."
  ok "Node: $(node --version)"
fi

if ! command -v pod >/dev/null 2>&1; then
  if [ "$CHECK" = 1 ]; then
    warn "CocoaPods is not installed. A real run installs it with Homebrew."
  else
    ensure_brew
    ok "Installing CocoaPods with Homebrew."
    brew install cocoapods || fail "brew install cocoapods failed. The output above says why."
    command -v pod >/dev/null 2>&1 || fail "CocoaPods installed but is still not on PATH. Open a new terminal and run this again."
  fi
fi
command -v pod >/dev/null 2>&1 && ok "CocoaPods: $(pod --version)"

command -v python3 >/dev/null 2>&1 && ok "Python: $(python3 --version 2>&1)" \
  || warn "No python3. Only needed to build replay clips for the offline harness, not to run the app."

# ---------------------------------------------------------------------------------------------
step "The one thing only you have: an OpenAI key"

# Asked first, before the installs, so everything this script needs from a person is asked in
# the first minute and the slow part runs unattended. Nothing else in this script asks a question
# except your Mac password, and the phone asking to trust this Mac.
if [ "$CHECK" = 1 ]; then
  grep -q '^OPENAI_API_KEY=sk-' server/.env.local 2>/dev/null \
    && ok "OpenAI key configured" \
    || warn "no OpenAI key yet. The app runs and names nothing until there is one."
elif [ ! -f server/.env.local ] || ! grep -q '^OPENAI_API_KEY=sk-' server/.env.local; then
  cat <<'MSG'

      The recognition service needs an OpenAI API key. Without one the app still installs,
      the camera works, items get outlined and tracked, and barcodes still resolve, but
      nothing is ever named.

      The key is yours and is never committed, never sent to the phone, and never put in
      the app binary: it lives only in server/.env.local, which git ignores.

      Get one at https://platform.openai.com/api-keys

MSG
  printf '      Paste an OpenAI key now, or press Return to skip: '
  # Not echoed. This is the only secret in the project, the rule about it is that it never
  # appears in a log or a message, and a terminal that prints it leaves it in the scrollback of
  # whatever window the reader pastes into next. `read -s` costs the reader the reassurance of
  # seeing the paste land, which is why the next line confirms the length instead.
  read -rs KEY
  printf '\n'
  if [ -n "$KEY" ]; then
    if [ -f server/.env.local ] && grep -q '^OPENAI_API_KEY=' server/.env.local; then
      sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$KEY|" server/.env.local
    else
      printf 'OPENAI_API_KEY=%s\n' "$KEY" >> server/.env.local
    fi
    chmod 600 server/.env.local
    # The length, never the value, so a mis-paste is visible without the key being printed.
    ok "saved to server/.env.local, readable only by you (${#KEY} characters)"
  else
    warn "skipped. The app will install and run and will not name anything."
    warn "Add one later: echo 'OPENAI_API_KEY=sk-...' >> server/.env.local"
  fi
else
  ok "OpenAI key already configured"
fi

# ---------------------------------------------------------------------------------------------
step "Looking for the phone"

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

# Looked for now so the person can plug it in while the installs run, and again, with patience,
# just before the build. A phone that is plugged in but not yet trusted does not appear at all,
# so "not attached" here is also "not trusted yet".
phone_check() {
  local line os
  line="$(attached_devices | head -1)"
  [ -n "$line" ] || return 1
  ok "Phone: $line"
  # The phone's iOS has to be one this Xcode can build for. A phone a major version ahead of
  # the SDK fails deep inside xcodebuild with a message about device support files, which does
  # not say "update Xcode", so it is said here.
  os="$(printf '%s' "$line" | sed -E 's/.*\(([0-9]+)\.[0-9.]+\) \([0-9A-Fa-f-]+\)$/\1/')"
  if printf '%s' "$os" | grep -qE '^[0-9]+$' && [ -n "${SDK_MAJOR:-}" ] && [ "$os" -gt "$SDK_MAJOR" ]; then
    fail "The phone runs iOS $os and this Xcode's iPhone SDK is $SDK_VER, so it cannot build for it.

  Update Xcode from the App Store, open it once, then run this again."
  fi
  return 0
}

if ! phone_check; then
  if [ "$CHECK" = 1 ]; then
    warn "no phone attached. A real run waits for one before building."
  else
    ok "No iPhone is attached yet. Plug it in with a cable and unlock it; the first time, it"
    ok "asks whether to trust this Mac. Answer Trust. The installs below carry on meanwhile."
  fi
fi

# ---------------------------------------------------------------------------------------------
step "Working out who is signing this build"

# A codesigning certificate carries the team identifier in its OU field, and that is the most
# reliable place to read it: the Xcode preference that lists accounts holds Apple IDs, not teams,
# and it exists and reads as present even when it is empty.
# Every unexpired Apple Development certificate on this Mac, one team identifier per line.
#
# Three things this handles that reading the first certificate did not, and all three are the
# difference between one machine and any machine.
#
#   - `security find-certificate` without -a returns one arbitrary match. Anyone who has ever
#     built for an employer has two Apple IDs on their Mac, so the team was whichever came back
#     first, and the wrong one fails much later with a provisioning error naming neither.
#   - It returns expired certificates too, and a lapsed one sorts no differently from a live one.
#     `-checkend 0` drops those.
#   - A team chosen silently is a team nobody can see was chosen. Two means stop and ask.
apple_team_ids() {
  local tmp cert
  tmp="$(mktemp -d -t kart-certs)" || return 0
  security find-certificate -a -c "Apple Development" -p 2>/dev/null \
    | awk -v dir="$tmp" '/-----BEGIN CERTIFICATE-----/{n++} n{print > (dir "/" n ".pem")}'
  for cert in "$tmp"/*.pem; do
    [ -e "$cert" ] || continue
    openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1 || continue
    openssl x509 -in "$cert" -noout -subject 2>/dev/null \
      | sed -nE 's/.*OU[ ]*=[ ]*([A-Z0-9]{10}).*/\1/p'
  done | sort -u
  rm -rf "$tmp"
}

# Xcode's own record of the accounts signed into it, one team identifier per line. This is the
# team before any certificate exists: an Apple ID added to Xcode a minute ago has a team and no
# certificate, and `xcodebuild -allowProvisioningUpdates` mints the certificate on first use once
# it knows the team. Read second, because a certificate is a stronger claim than a preference.
xcode_pref_teams() {
  defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null \
    | sed -nE 's/.*teamID = "?([A-Z0-9]{10})"?;.*/\1/p' | sort -u
}

if [ -z "${KART_TEAM_ID:-}" ]; then
  TEAMS="$(apple_team_ids)"
  if [ -z "$TEAMS" ]; then
    TEAMS="$(xcode_pref_teams)"
    [ -n "$TEAMS" ] && ok "No development certificate yet; Xcode's accounts name the team, and the build makes the certificate."
  fi
  TEAM_COUNT=0
  [ -n "$TEAMS" ] && TEAM_COUNT="$(printf '%s\n' "$TEAMS" | grep -c .)"
  if [ "$TEAM_COUNT" -gt 1 ]; then
    fail "This Mac has certificates for more than one Apple team, so there is no single right
answer to sign as:

$(printf '%s\n' "$TEAMS" | sed 's/^/       /')

Pick the one you want and record it, then run this again:

       echo 'KART_TEAM_ID=$(printf '%s\n' "$TEAMS" | head -1)' >> .kartrc

If you do not know which is which, Xcode, Settings, Accounts shows the team name beside
each Apple ID, and the ten character identifier beside that."
  fi
  KART_TEAM_ID="$(printf '%s\n' "$TEAMS" | head -1)"
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
# Reported from the identifier rather than from the team, which is what it is describing. Read
# from the team, this line claimed "nothing needed changing" while printing a changed identifier
# on the author's own machine: install-on-device.sh's retry had recorded a derived identifier in
# .kartrc after Apple refused to re-register the committed default, which it does to a free team
# that has used up its weekly allowance. The team was still the owning one, so the old test was
# true and the sentence beneath it was false.
if [ "$KART_BUNDLE_ID" = "$DEFAULT_BUNDLE_ID" ]; then
  ok "(the committed default, which belongs to this team, so nothing needed changing)"
elif [ "$KART_TEAM_ID" = "$DEFAULT_TEAM" ]; then
  ok "(this team owns the committed default, but .kartrc already carries its own identifier)"
else
  ok "(the committed default belongs to another team, and Apple lets exactly one register it)"
fi

# ---------------------------------------------------------------------------------------------
step "Installing dependencies"

# Decided by freshness, not by whether the directory exists. The existence test was right on a
# fresh clone and wrong on every Mac that had built once: a pull that added expo-image-picker
# left node_modules present and without it, and the Release build failed resolving the import on
# a machine where this script had succeeded the week before. scripts/lib/deps.sh reads what npm
# and CocoaPods write when they finish, so a re-run after a pull installs exactly what changed.
if [ "$CHECK" = 1 ]; then
  if needs_npm_install .;      then warn "app dependencies missing or older than package-lock.json";     else ok "app dependencies current"; fi
  if needs_npm_install server; then warn "service dependencies missing or older than server/package-lock.json"; else ok "service dependencies current"; fi
  if needs_pod_install .;      then warn "pods missing or older than what the app now depends on";       else ok "pods current"; fi
else
  if needs_npm_install .; then
    ok "npm install, in the app. First time takes a couple of minutes."
    npm install --no-audit --no-fund || fail "npm install failed in the app. The output above says why."
    # npm leaves its hidden lockfile alone when nothing needed changing, which would keep the
    # pulled package-lock.json newer and re-run this on every setup. Marking it done is exact:
    # the tree now matches the lockfile.
    touch node_modules/.package-lock.json
  else
    ok "app dependencies current"
  fi

  if needs_npm_install server; then
    ok "npm install, in the recognition service."
    (cd server && npm install --no-audit --no-fund) || fail "npm install failed in server/. The output above says why."
    touch server/node_modules/.package-lock.json
  else
    ok "service dependencies current"
  fi

  if needs_pod_install .; then
    ok "pod install. First time takes a few minutes and downloads the CocoaPods spec repo."
    (cd ios && pod install) || fail "pod install failed. The output above says why."
  else
    ok "pods current"
  fi

  # Xcode's "Bundle React Native code" phase runs node, from a shell whose PATH is not this one.
  # ios/.xcode.env asks `command -v node`, which finds nothing when Node came from Homebrew or
  # nvm, and the build dies with "node: command not found" a long way from anything that
  # mentions PATH. The absolute path, in the git-ignored local file the template provides for
  # exactly this, makes the build phase's answer the same as this shell's.
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  if [ -n "$NODE_BIN" ]; then
    printf '# Written by scripts/setup.sh. Git ignored. Which node Xcode'"'"'s build phases run.\nexport NODE_BINARY="%s"\n' "$NODE_BIN" > ios/.xcode.env.local
    ok "ios/.xcode.env.local points Xcode's build at $NODE_BIN"
  fi
fi

# ---------------------------------------------------------------------------------------------
step "Pointing the app at this Mac"

# The phone talks to the recognition service over wifi. Both ways of reaching this Mac are
# written, because neither survives on its own and the cost of the wrong one going stale is not a
# setting to change: EXPO_PUBLIC_ values are inlined into the JS bundle at build time, so a dead
# address means a full native rebuild.
#
#   - The Bonjour name is stable. It does not change when the laptop moves between wifi and a
#     phone hotspot, so it goes first.
#   - The address is not stable, being a DHCP lease, but it works on the networks that block
#     mDNS and leave the name unresolvable. It goes in the fallbacks.
#
# Writing only the address, which is what this did, is the case .env.example warns about in so
# many words. It produced a build that worked on the network it was made on and was dead on
# every other one, and the only working .env on the machine that wrote this script was a
# hand-written file that did it the way described here. So the script had never once produced
# the configuration the project actually runs on.
lan_address() {
  local iface addr i
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  for i in $iface en0 en1 en2; do
    [ -n "$i" ] || continue
    addr="$(ipconfig getifaddr "$i" 2>/dev/null)"
    [ -n "$addr" ] && { printf '%s' "$addr"; return; }
  done
  # Last resort: whatever this Mac actually has. en0 through en2 covers the built-in wifi and
  # ethernet of a laptop and nothing else, and a Mac on a USB-C dock or a Thunderbolt adapter
  # numbers those interfaces much higher. Skipped: loopback, Apple's own peer-to-peer radios,
  # and VPN tunnels, none of which is an address a phone on the same wifi can reach.
  for i in $(ifconfig -l 2>/dev/null); do
    case "$i" in lo*|awdl*|llw*|utun*|gif*|stf*|bridge*|ap1) continue ;; esac
    addr="$(ipconfig getifaddr "$i" 2>/dev/null)"
    [ -n "$addr" ] && { printf '%s' "$addr"; return; }
  done
}

LAN="$(lan_address)"
# `scutil --get LocalHostName`, not ComputerName: this is the sanitised form Bonjour actually
# publishes, so "Ayaan's MacBook Pro" is "Ayaans-MacBook-Pro" here and .local resolves it.
BONJOUR="$(scutil --get LocalHostName 2>/dev/null)"

API_URL=""
# 192.0.0.2 is the address this Mac takes when it is tethered to an iPhone's hotspot, which is
# the one network where the laptop has no lease worth writing down. A fallback that does not
# answer costs a probe and nothing else, so it is always worth carrying.
FALLBACKS="http://192.0.0.2:4310"

if [ -n "$BONJOUR" ]; then
  API_URL="http://$BONJOUR.local:4310"
  [ -n "$LAN" ] && FALLBACKS="http://$LAN:4310,$FALLBACKS"
elif [ -n "$LAN" ]; then
  warn "This Mac publishes no Bonjour name, so the phone has to use the address instead."
  warn "That works until this Mac's lease changes, and fixing it then needs a full rebuild."
  API_URL="http://$LAN:4310"
fi

if [ -z "$API_URL" ]; then
  warn "This Mac has no address on a local network, so the phone will have nothing to reach."
  warn "Join a wifi network and run this again. Continuing, but recognition will not work."
else
  ok "Service address for the phone: $API_URL"
  ok "Fallbacks, probed in order if that one does not answer: $FALLBACKS"
fi

# EXPO_PUBLIC_ is the only prefix Expo inlines into the client bundle, which is exactly why
# nothing secret goes in this file. It holds a hostname and nothing else.
#
# Both keys are rewritten rather than merged. Re-running is documented as the way to pick up a
# changed network, and a merge would keep the stale lease that made the re-run necessary.
set_env() {
  local key="$1" value="$2"
  if [ -f .env ] && grep -q "^$key=" .env; then
    # `|` as the delimiter, because every value here is a URL and contains slashes.
    sed -i '' "s|^$key=.*|$key=$value|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ -n "$API_URL" ]; then
  if [ "$CHECK" = 1 ]; then
    ok "would write EXPO_PUBLIC_KART_API_URL=$API_URL to .env"
    ok "would write EXPO_PUBLIC_KART_API_FALLBACKS=$FALLBACKS to .env"
  else
    set_env EXPO_PUBLIC_KART_API_URL "$API_URL"
    set_env EXPO_PUBLIC_KART_API_FALLBACKS "$FALLBACKS"
    ok "written to .env"
  fi
fi

# ---------------------------------------------------------------------------------------------
step "Checking the recognition service can start"

# Both of this project's own services answer GET / with a JSON body carrying "ok": the
# recognition service on 4310 (server/scripts/serve.ts) and the local vision model on 4330
# (server/localvlm/serve.py). Ask before warning, because the machine this is usually run on is
# one with those two already running, and reporting a developer's own service back to them as a
# stranger holding their port is the wrong answer to the right question.
for port in 4310 4330; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || continue
  holder="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}')"
  if curl -fsS -m 2 "http://127.0.0.1:$port/" 2>/dev/null | grep -q '"ok"'; then
    ok "port $port is this project's own service, already running ($holder)"
  else
    warn "port $port is already taken by $holder"
    warn "the service picks these two; stop that process or the service will not bind"
  fi
done

grep -q '^OPENAI_API_KEY=sk-' server/.env.local 2>/dev/null \
  && ok "OpenAI key in place" \
  || warn "no OpenAI key, so the service will refuse to start. Add one and run this again."

# ---------------------------------------------------------------------------------------------
step "Checking the grounded enumerator"

# Reported rather than prompted for, because unlike the OpenAI key this is not a value anyone has
# lying around: it is the address of a GPU host running the grounded detector, and most clones
# will not have one. It is here because leaving it out is silent. Everything still works, the
# camera and the tracker and the naming, so the only visible symptom is that the shopper never
# sees an outline on anything, which reads as a broken overlay rather than as a service that was
# never pointed anywhere. docs/running-on-a-phone.md gap 2 has the local host to run instead.
if grep -q '^ENUMERATOR_URL=http' server/.env.local 2>/dev/null; then
  ok "enumerator configured"
else
  warn "no ENUMERATOR_URL. The app names items and draws no outlines around them."
  warn "That is the supported degraded mode, not a fault. To close it, see gap 2 in"
  warn "docs/running-on-a-phone.md, then: echo 'ENUMERATOR_URL=http://...' >> server/.env.local"
fi

# ---------------------------------------------------------------------------------------------
step "Starting the recognition service on this Mac"

# The phone dials this Mac on 4310, and until this step existed nothing in the setup started
# what answers there: the install finished and printed `npm run serve` for the reader to type,
# so the first scan on a fresh setup came back "unavailable", which reads as recognition being
# broken. scripts/serve.sh starts it detached from this terminal, restarts it when the
# checked-out code is newer than the running process, and leaves it alone otherwise, so running
# setup again after a pull is the whole procedure.
if [ "$CHECK" = 1 ]; then
  if ./scripts/serve.sh --status 2>&1 | sed 's/^/      /'; then :; else ok "a real run starts it"; fi
elif ./scripts/serve.sh 2>&1 | sed 's/^/      /'; then :; else
  warn "the recognition service did not start, so the app will install and name nothing."
  warn "The reason is above. Fix it, then: ./scripts/serve.sh"
fi

# ---------------------------------------------------------------------------------------------
step "Remembering this machine's answers"

if [ "$CHECK" = 1 ]; then
  ok "would write $RC with the two values above"
else
cat > "$RC" <<RC_EOF
# Written by scripts/setup.sh. Git ignored: this names an Apple team and is specific to this Mac.
# Delete it to have setup work everything out again from scratch.
KART_TEAM_ID=$KART_TEAM_ID
KART_BUNDLE_ID=$KART_BUNDLE_ID
RC_EOF
ok "$RC"
fi

# ---------------------------------------------------------------------------------------------
step "Checking the tree is sound before building it"

if [ "$CHECK" = 1 ]; then
  ok "skipped in --check"
elif npm run --silent typecheck >/dev/null 2>&1; then
  ok "typecheck clean"
else
  warn "typecheck failed. Building anyway; run \`npm run typecheck\` to see it."
fi

# ---------------------------------------------------------------------------------------------
step "Building and installing on the phone"

export KART_TEAM_ID KART_BUNDLE_ID

# Everything on the Mac is done. Now the phone, with patience: the person was told to plug it in
# while the installs ran, and trusting a Mac takes a tap on the phone and a moment.
if [ "$CHECK" != 1 ] && ! attached_devices | grep -q .; then
  printf '      Waiting up to %d seconds for the phone. Plug it in with a cable, unlock it, and tap Trust.' "$PHONE_WAIT"
  waited=0
  while [ "$waited" -lt "$PHONE_WAIT" ] && ! attached_devices | grep -q .; do
    sleep 3
    waited=$((waited + 3))
    printf '.'
  done
  printf '\n'
  attached_devices | grep -q . && phone_check
fi

if ! attached_devices | grep -q .; then
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

if [ "$CHECK" = 1 ]; then
  ok "a phone is attached and ready to be built for"
  if [ "$WARNINGS" -eq 0 ]; then
    printf '\n\033[1mNothing is missing. Run ./scripts/setup.sh to build and install.\033[0m\n\n'
  else
    printf '\n\033[1m%d thing(s) above need attention.\033[0m\n' "$WARNINGS"
    printf 'Anything described as "not installed yet" is installed for you by a real run.\n'
    printf 'Run ./scripts/setup.sh when you have dealt with the rest.\n\n'
  fi
  exit 0
fi

exec ./scripts/install-on-device.sh "${1:-Release}"
