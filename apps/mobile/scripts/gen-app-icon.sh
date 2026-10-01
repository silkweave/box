#!/usr/bin/env bash
# Regenerate the iOS + Android launcher icons from icon/app-icon-1024.png, and the Android
# notification icon from icon/notification.svg.
#
#   scripts/gen-app-icon.sh [source.png]
#
# The source is icon/app-icon-1024.png: the Box logo on the app's dark background
# (#0A0A0F), a full-bleed 1024x1024 square. iOS app icons must carry NO alpha channel
# (App Store Connect and ad-hoc validation reject them), so every output is flattened onto the
# icon's own background colour and written without alpha. The system applies its own mask on both
# platforms. This project has no adaptive icon (no mipmap-anydpi-v26), so Android gets the legacy
# square ic_launcher at each density.
#
# Needs: ImageMagick (brew install imagemagick).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-icon/app-icon-1024.png}"
BG="#0A0A0F"          # the source icon's background, sampled from its corners
IOS_SET="ios/Runner/Assets.xcassets/AppIcon.appiconset"

command -v magick >/dev/null || { echo "missing magick (brew install imagemagick)" >&2; exit 1; }
[ -f "$SRC" ] || { echo "no source icon at $SRC" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Master at 1024, flattened and opaque.
magick "$SRC" -resize 1024x1024 -background "$BG" -alpha remove -alpha off "$tmp/icon-1024.png"

# iOS: every size the appiconset declares, all flattened (no alpha allowed).
declare -a IOS_SIZES=(
  "20x20@1x:20"    "20x20@2x:40"    "20x20@3x:60"
  "29x29@1x:29"    "29x29@2x:58"    "29x29@3x:87"
  "40x40@1x:40"    "40x40@2x:80"    "40x40@3x:120"
  "60x60@2x:120"   "60x60@3x:180"
  "76x76@1x:76"    "76x76@2x:152"
  "83.5x83.5@2x:167"
  "1024x1024@1x:1024"
)
for entry in "${IOS_SIZES[@]}"; do
  name="${entry%%:*}"; px="${entry##*:}"
  magick "$tmp/icon-1024.png" -filter Lanczos -resize "${px}x${px}" -alpha off \
    "PNG24:$IOS_SET/Icon-App-${name}.png"
done
echo "==> wrote ${#IOS_SIZES[@]} iOS icons to $IOS_SET"

# Android: legacy launcher icon per density.
declare -a AND_SIZES=("mdpi:48" "hdpi:72" "xhdpi:96" "xxhdpi:144" "xxxhdpi:192")
for entry in "${AND_SIZES[@]}"; do
  d="${entry%%:*}"; px="${entry##*:}"
  out="android/app/src/main/res/mipmap-${d}/ic_launcher.png"
  mkdir -p "$(dirname "$out")"
  magick "$tmp/icon-1024.png" -filter Lanczos -resize "${px}x${px}" -alpha off "PNG24:$out"
done
echo "==> wrote ${#AND_SIZES[@]} Android launcher icons"

# Android notification small icon from icon/notification.svg. Android paints it in one colour and
# uses only its alpha, so a full-colour icon shows as a blank square. The SVG is drawn in white
# (kept) and black (cut out); luminance becomes alpha. Needs rsvg-convert (brew install librsvg).
if command -v rsvg-convert >/dev/null && [ -f icon/notification.svg ]; then
  rsvg-convert -w 768 -h 768 icon/notification.svg -o "$tmp/notification.png"
  declare -a NOTE_SIZES=("mdpi:24" "hdpi:36" "xhdpi:48" "xxhdpi:72" "xxxhdpi:96")
  for entry in "${NOTE_SIZES[@]}"; do
    d="${entry%%:*}"; px="${entry##*:}"; inner=$((px * 22 / 24))
    out="android/app/src/main/res/drawable-${d}/ic_notification.png"
    mkdir -p "$(dirname "$out")"
    magick "$tmp/notification.png" -channel A -fx "a*luminance" +channel -fill white -colorize 100 \
      -resize "${inner}x${inner}" -gravity center -background none -extent "${px}x${px}" "$out"
  done
  echo "==> wrote ${#NOTE_SIZES[@]} Android notification icons"
else
  echo "==> skipped the notification icon (needs rsvg-convert and icon/notification.svg)"
fi
