#!/usr/bin/env bash
#
# Builds dist/KD_Viz.app from the local Electron runtime.
# Done by hand (rather than electron-packager) because extract-zip mis-extracts
# the Electron app bundle in some sandboxes; copying the already-good runtime
# with `ditto` is reliable. This is the same shape electron-packager produces.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="KD_Viz"
BUNDLE_ID="io.kdviz.app"
SRC_ELECTRON="node_modules/electron/dist/Electron.app"
APP="dist/${APP_NAME}.app"
PB=/usr/libexec/PlistBuddy

if [ ! -d "$SRC_ELECTRON/Contents/Frameworks/Electron Framework.framework" ]; then
  echo "ERROR: Electron runtime incomplete at $SRC_ELECTRON" >&2
  echo "Fix:  rm -rf node_modules/electron && npm install" >&2
  exit 1
fi

echo "Copying Electron runtime…"
rm -rf "$APP"
mkdir -p dist
ditto "$SRC_ELECTRON" "$APP"

# Rename the main executable to the product name.
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"

# App icon.
cp build/icon.icns "$APP/Contents/Resources/app.icns"

# Info.plist.
PLIST="$APP/Contents/Info.plist"
$PB -c "Set :CFBundleExecutable $APP_NAME" "$PLIST"
$PB -c "Set :CFBundleName $APP_NAME" "$PLIST"
$PB -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST" 2>/dev/null || $PB -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
$PB -c "Set :CFBundleIconFile app.icns" "$PLIST"
$PB -c "Set :CFBundleShortVersionString $(node -p "require('./package.json').version")" "$PLIST" 2>/dev/null || true
$PB -c "Add :LSApplicationCategoryType string public.app-category.utilities" "$PLIST" 2>/dev/null || true
# Background-friendly: no Dock icon churn on launch is fine; keep it a normal app.

# Drop Electron's default app and install ours.
APPDIR="$APP/Contents/Resources/app"
rm -f "$APP/Contents/Resources/default_app.asar"
mkdir -p "$APPDIR/node_modules"
# Build the native temp helper (no-op if swiftc is missing) and bundle bin/.
bash "$ROOT/scripts/build-helper.sh" || true

cp package.json "$APPDIR/"
ditto src "$APPDIR/src"
ditto config "$APPDIR/config"
[ -d bin ] && ditto bin "$APPDIR/bin"
ditto node_modules/systeminformation "$APPDIR/node_modules/systeminformation"

# Ad-hoc codesign so macOS will launch it locally (Gatekeeper-friendly enough
# for a self-run app; not notarized).
echo "Ad-hoc signing…"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  (codesign skipped/failed — app still runs locally)"

SIZE=$(du -sh "$APP" | cut -f1)
echo "Built: $APP  ($SIZE)"
