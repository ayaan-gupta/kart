# Sourced by scripts/setup.sh. Two decisions, each answered by exit status: 0 means "run the
# install", 1 means "what is installed is current".
#
# Both were "does the directory exist", which is right on a fresh clone and wrong on every Mac
# that has built before. A pull that adds a package to package.json leaves node_modules present
# and stale, and the next Release build fails resolving the new import on a machine where the
# same script succeeded a week earlier. That is what happened when expo-image-picker arrived on
# 2026-09-02. The pods have the same shape of fault: Expo links native modules from node_modules
# at `pod install` time, so a new native dependency needs the pods installed again even though
# ios/Pods is sitting right there.
#
# Freshness is read from what the installers themselves write, not from a stamp of this script's
# own. npm rewrites node_modules/.package-lock.json when an install completes. CocoaPods writes
# Pods/Manifest.lock as a copy of the Podfile.lock it installed from, and Xcode's own
# "[CP] Check Pods Manifest.lock" build phase compares those two files exactly this way.

needs_npm_install() {
  local dir="$1" stamp="$1/node_modules/.package-lock.json"
  [ -d "$dir/node_modules" ] || return 0
  [ -f "$stamp" ] || return 0
  [ "$dir/package-lock.json" -nt "$stamp" ] && return 0
  [ "$dir/package.json" -nt "$stamp" ] && return 0
  return 1
}

needs_pod_install() {
  local root="$1" manifest="$1/ios/Pods/Manifest.lock"
  [ -d "$root/ios/Pods" ] || return 0
  [ -f "$manifest" ] || return 0
  cmp -s "$root/ios/Podfile.lock" "$manifest" || return 0
  [ "$root/ios/Podfile" -nt "$manifest" ] && return 0
  [ "$root/node_modules/.package-lock.json" -nt "$manifest" ] && return 0
  return 1
}
