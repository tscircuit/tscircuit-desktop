#!/bin/bash
# Signs a built tscircuit desktop app with tscircuit's Developer ID, has Apple
# notarize it, and writes the .zip and .dmg to publish. Follows
# tscircuit-standalone's scripts/sign-macos.sh and uses the same credentials.
# It never falls back to ad hoc signing: any failure fails the build.
#
#   bash scripts/sign-macos.sh "path/to/tscircuit desktop.app" out-dir file-name
set -euo pipefail
umask 077

app="${1:?Usage: bash scripts/sign-macos.sh path/to/App.app out-dir file-name}"
out_dir="${2:?Missing the output directory}"
name="${3:?Missing the file name for the .zip and .dmg, without extension}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
entitlements="$script_dir/macos-entitlements.plist"
test "$(uname -s)" = Darwin
test -d "$app/Contents/MacOS"
test -s "$entitlements"
for variable in MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_NOTARY_KEY_P8_BASE64 APPLE_NOTARY_KEY_ID APPLE_NOTARY_ISSUER_ID APPLE_TEAM_ID; do
  if [ -z "${!variable:-}" ]; then
    echo "Missing required signing credential: $variable" >&2
    exit 1
  fi
done
if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Invalid Apple team ID" >&2
  exit 1
fi
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
zip="$out_dir/$name.zip"
dmg="$out_dir/$name.dmg"

signing_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tscircuit-desktop-signing.XXXXXX")"
keychain="$signing_dir/signing.keychain-db"
original_keychains=()
search_list_changed=false
phase="credential setup"
cleanup() {
  result=$?
  set +e
  echo "macOS signing ended in stage '$phase' with exit status $result."
  if [ "$search_list_changed" = true ]; then
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1
  fi
  security delete-keychain "$keychain" >/dev/null 2>&1
  rm -rf "${signing_dir:?}"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

security list-keychains -d user > "$signing_dir/keychains.txt"
while IFS= read -r path; do
  [ -z "$path" ] || original_keychains+=("$path")
done < <(sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' "$signing_dir/keychains.txt")
keychain_password="$(openssl rand -hex 32)"
printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$signing_dir/certificate.p12"
printf '%s' "$APPLE_NOTARY_KEY_P8_BASE64" | base64 --decode > "$signing_dir/notary.p8"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
# Trust evaluation must be able to find the imported G2 intermediate, even
# when codesign and find-identity receive an explicit keychain argument.
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
search_list_changed=true
security import "$signing_dir/certificate.p12" -k "$keychain" \
  -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$keychain_password" "$keychain" >/dev/null
# A PKCS#12 export can already include the public chain. Only tolerate Apple's
# duplicate-item error; other import errors still fail.
import_public_certificate() {
  if ! security import "$1" -k "$keychain" 2> "$signing_dir/certificate-import-error.txt"; then
    if ! grep -Fq 'The specified item already exists in the keychain' "$signing_dir/certificate-import-error.txt"; then
      cat "$signing_dir/certificate-import-error.txt" >&2
      return 1
    fi
  fi
}
# Both certificates are public; importing them does not change system trust.
curl --fail --silent --show-error --retry 3 \
  https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer \
  -o "$signing_dir/DeveloperIDG2CA.cer"
import_public_certificate "$signing_dir/DeveloperIDG2CA.cer"
curl --fail --silent --show-error --retry 3 \
  https://www.apple.com/appleca/AppleIncRootCertificate.cer \
  -o "$signing_dir/AppleRootCA.cer"
import_public_certificate "$signing_dir/AppleRootCA.cer"
identity="$(security find-identity -v -p codesigning "$keychain" |
  awk -v team="($APPLE_TEAM_ID)" '/Developer ID Application:/ && index($0, team) {print $2}')"
if [[ ! "$identity" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  security find-identity -p codesigning "$keychain" >&2 || true
  echo "Expected exactly one Developer ID Application identity for $APPLE_TEAM_ID" >&2
  exit 1
fi

# Apple's timestamp service fails now and then; a signature without a
# timestamp cannot be notarized, so try again rather than sign without one.
sign() {
  local attempt
  for attempt in 1 2 3; do
    if codesign --force --sign "$identity" --keychain "$keychain" --timestamp "$@"; then
      return 0
    fi
    [ "$attempt" -eq 3 ] || sleep $((attempt * 10))
  done
  return 1
}

# True for the program file a bundle names as its own. codesign treats that
# file as the bundle, so it is signed with the bundle, after what it contains.
is_bundle_program() {
  local file="$1" dir bundle
  dir="$(dirname "$file")"
  case "$dir" in
    *.app/Contents/MacOS)
      bundle="${dir%/Contents/MacOS}"
      [ "$(basename "$file")" = "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$bundle/Contents/Info.plist")" ]
      ;;
    *.framework/Versions/*)
      bundle="${dir%/Versions/*}"
      [ "$dir" = "$bundle/Versions/$(basename "$dir")" ] &&
        [ "$(basename "$file")" = "$(basename "$bundle" .framework)" ]
      ;;
    *) return 1 ;;
  esac
}

# Sign from the inside out: Apple does not support `codesign --deep` for
# distribution, and a bundle's signature seals the signatures of what it holds.
phase="Developer ID signing"
echo "Signing the program files inside the app."
signed_files=0
while IFS= read -r -d '' file; do
  kind="$(file -b "$file")"
  case "$kind" in *Mach-O*) ;; *) continue ;; esac
  if is_bundle_program "$file"; then continue; fi
  case "$kind" in
    *executable*) sign --options runtime --entitlements "$entitlements" "$file" ;;
    *) sign --options runtime "$file" ;;
  esac
  signed_files=$((signed_files + 1))
done < <(find "$app" -type f -print0)
echo "Signed $signed_files program files. Signing the bundles."
# -depth lists a bundle after everything inside it, and the app itself last.
while IFS= read -r -d '' bundle; do
  case "$bundle" in
    *.app) sign --options runtime --entitlements "$entitlements" "$bundle" ;;
    *) sign --options runtime "$bundle" ;;
  esac
done < <(find "$app" -depth -type d \( -name '*.app' -o -name '*.framework' \) -print0)

phase="signature verification"
codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --entitlements - --verbose=4 "$app" > "$signing_dir/signature.txt" 2>&1
cat "$signing_dir/signature.txt"
grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" "$signing_dir/signature.txt"
grep -F 'Authority=Developer ID Application:' "$signing_dir/signature.txt"
grep -E 'flags=.*\(runtime\)' "$signing_dir/signature.txt"
grep -E '^Timestamp=.' "$signing_dir/signature.txt"

auth=(--key "$signing_dir/notary.p8" --key-id "$APPLE_NOTARY_KEY_ID" --issuer "$APPLE_NOTARY_ISSUER_ID")
notarize() {
  local file="$1" label="$2" result="$signing_dir/submission-$2.json" status=0 id
  echo "Submitting the $label to Apple; waiting up to 30 minutes."
  xcrun notarytool submit "$file" "${auth[@]}" \
    --wait --timeout 30m --output-format json > "$result" || status=$?
  cat "$result"
  echo
  id="$(jq -r '.id // empty' "$result")"
  if [ -n "$id" ]; then
    # Apple's log names each file it objected to; it holds no credentials.
    xcrun notarytool log "$id" "${auth[@]}" "$signing_dir/notary-log-$label.json" || true
    if [ -s "$signing_dir/notary-log-$label.json" ]; then
      cat "$signing_dir/notary-log-$label.json"
      echo
    fi
  fi
  if [ "$status" -ne 0 ] || ! jq -e '.status == "Accepted"' "$result" >/dev/null; then
    echo "Apple did not accept the $label; refusing to release it." >&2
    return 1
  fi
}
staple() {
  local file="$1" action attempt status
  for action in staple validate; do
    for attempt in 1 2 3; do
      status=0
      xcrun stapler "$action" "$file" > "$signing_dir/stapler.txt" 2>&1 || status=$?
      cat "$signing_dir/stapler.txt"
      if [ "$status" -eq 0 ]; then break; fi
      # Status 68 also covers permanent ticket errors. Retry only when Apple's
      # output names a network failure, never a TLS or trust error.
      if [ "$attempt" -eq 3 ] || [ "$status" -ne 68 ] ||
        ! grep -Eq 'Error Domain=NSURLErrorDomain Code=-(1001|1003|1004|1005|1006|1009)([^0-9]|$)' "$signing_dir/stapler.txt"; then
        return "$status"
      fi
      sleep $((attempt * 10))
    done
  done
}

# notarytool takes an archive, not a folder. The ticket is then stapled to the
# app itself, so the archives to publish are made after this, from that app.
phase="app notarization"
ditto -c -k --keepParent "$app" "$signing_dir/submission.zip"
notarize "$signing_dir/submission.zip" app
phase="app ticket stapling"
staple "$app"
phase="app Gatekeeper verification"
spctl --assess --type execute --verbose=4 "$app"

phase="packaging"
ditto -c -k --keepParent "$app" "$signing_dir/app.zip"
# A disk image with the usual "drag to Applications" layout.
mkdir "$signing_dir/dmg"
ditto "$app" "$signing_dir/dmg/$(basename "$app")"
ln -s /Applications "$signing_dir/dmg/Applications"
hdiutil create -volname "$(basename "$app" .app)" -srcfolder "$signing_dir/dmg" \
  -ov -format UDZO "$signing_dir/app.dmg"
phase="disk image signing"
sign "$signing_dir/app.dmg"
phase="disk image notarization"
notarize "$signing_dir/app.dmg" dmg
phase="disk image ticket stapling"
staple "$signing_dir/app.dmg"
phase="disk image Gatekeeper verification"
spctl --assess --type open --context context:primary-signature --verbose=4 "$signing_dir/app.dmg"

# The zip to publish must hold exactly the app that was verified above.
phase="archive verification"
mkdir "$signing_dir/check"
ditto -x -k "$signing_dir/app.zip" "$signing_dir/check"
codesign --verify --deep --strict "$signing_dir/check/$(basename "$app")"
xcrun stapler validate "$signing_dir/check/$(basename "$app")"

# Only files that passed every check above reach the output directory.
phase="publishing the files"
mv -f "$signing_dir/app.zip" "$zip"
mv -f "$signing_dir/app.dmg" "$dmg"
chmod 644 "$zip" "$dmg"
shasum -a 256 "$zip" "$dmg"
echo "Developer ID signing and notarization succeeded."
phase="complete"
