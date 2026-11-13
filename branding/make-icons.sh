#!/bin/sh
# Regenerates the app's icons from branding/app-icon.svg, replacing T3 Code's.
# app-icon.svg is the tscircuit logo (branding/icon.svg) on a rounded square.
#
#   npm run setup          (the icons are written into .t3code/)
#   sh branding/make-icons.sh
#   npm run export         (saves them to overlay/)
#
# Needs rsvg-convert (librsvg) and ImageMagick. All three release channels
# (dev, nightly, prod) get the same icon.
set -eu
cd "$(dirname "$0")/.."
svg=branding/app-icon.svg
app=.t3code
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# square SIZE BODY FILE: the icon BODY pixels tall, centred on a transparent SIZE canvas.
square() {
  rsvg-convert --keep-aspect-ratio -w "$2" -h "$2" "$svg" -o "$tmp/body.png"
  convert -background none "$tmp/body.png" -gravity center -extent "$1x$1" "PNG32:$3"
}
ico() {
  square 256 256 "$tmp/256.png"
  convert "$tmp/256.png" -define icon:auto-resize=256,128,64,48,32,24,16 "$1"
}
web() { # web PREFIX: favicons and web-app icons named PREFIX-...
  square 16 16 "$1-favicon-16x16.png"
  square 32 32 "$1-favicon-32x32.png"
  square 180 180 "$1-apple-touch-180.png"
  square 192 192 "$1-icon-192x192.png"
  square 512 512 "$1-icon-512x512.png"
  ico "$1-favicon.ico"
}

# macOS wants the classic safe area: an 824px body inside a 1024px canvas. An
# icon that is narrower than that, or a different shape, is drawn smaller.
for icon in dev/blueprint nightly/nightly prod/black; do
  square 1024 824 "$app/assets/$icon-macos-1024.png"
  square 1024 1024 "$app/assets/$icon-universal-1024.png"
done
ico "$app/assets/dev/blueprint-windows.ico"
ico "$app/assets/nightly/nightly-windows.ico"
ico "$app/assets/prod/t3-black-windows.ico"
web "$app/assets/dev/blueprint-web"
web "$app/assets/nightly/nightly-web"
web "$app/assets/prod/t3-black-web"

# The web app serves its own copies.
public=$app/apps/web/public
square 16 16 "$public/favicon-16x16.png"
square 32 32 "$public/favicon-32x32.png"
square 180 180 "$public/apple-touch-icon.png"
square 192 192 "$public/icon-192x192.png"
square 512 512 "$public/icon-512x512.png"
ico "$public/favicon.ico"
echo "Icons written to $app. Run \`npm run export\` to save them."
