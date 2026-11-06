#!/usr/bin/env bash
# Build the signed release APK and hand it to the hub, which offers it on the
# web UI's Devices page ("Get the app") at /app/ownsee.apk.
#
# Needs the release signing key (see android/app/build.gradle.kts) and the
# Android SDK. Usage, from the repo root:  bash scripts/publish-apk.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}
OUT=$REPO/data/app

(cd "$REPO/android" && ./gradlew assembleRelease --no-daemon --console=plain -q)
APK=$REPO/android/app/build/outputs/apk/release/app-release.apk

BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
"$BT/apksigner" verify "$APK" >/dev/null || { echo "APK is not signed (missing ~/.ownsee/signing.properties?)" >&2; exit 1; }
BADGE=$("$BT/aapt" dump badging "$APK" | head -1)
NAME=$(sed -E "s/.*versionName='([^']+)'.*/\1/" <<<"$BADGE")
CODE=$(sed -E "s/.*versionCode='([^']+)'.*/\1/" <<<"$BADGE")

mkdir -p "$OUT"
cp "$APK" "$OUT/ownsee.apk.tmp" && mv "$OUT/ownsee.apk.tmp" "$OUT/ownsee.apk"
SHA=$(sha256sum "$OUT/ownsee.apk" | cut -d' ' -f1)
printf '{"versionName":"%s","versionCode":%s,"size":%s,"sha256":"%s","published":"%s"}\n' \
  "$NAME" "$CODE" "$(stat -c%s "$OUT/ownsee.apk")" "$SHA" "$(date -Iseconds)" > "$OUT/ownsee.json"
echo "Published OwnSee $NAME ($CODE) to data/app/; the hub serves it at /app/ownsee.apk"
