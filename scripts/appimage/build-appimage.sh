#!/usr/bin/env bash
set -euo pipefail

app_id=io.github.marcinjahn.commitnote
appimage_name=commitnote-x86_64.AppImage
zsync_name=$appimage_name.zsync
update_info="gh-releases-zsync|marcinjahn|commitnote|latest|$zsync_name"

appimagetool_version=1.9.1
appimagetool_sha256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
runtime_release=20251108
runtime_sha256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

usage() {
  echo "usage: $0 [--mode desktop|desktop-fake] [--version <semver>] [--date YYYY-MM-DD] [--out <dir>]" >&2
  exit 2
}

mode=desktop
version=
release_date=
out_dir=

while [ "$#" -gt 0 ]; do
  case "$1" in
  --mode)
    mode=${2:-}
    shift 2 || usage
    ;;
  --version)
    version=${2:-}
    shift 2 || usage
    ;;
  --date)
    release_date=${2:-}
    shift 2 || usage
    ;;
  --out)
    out_dir=${2:-}
    shift 2 || usage
    ;;
  -h | --help) usage ;;
  *)
    echo "unknown argument: $1" >&2
    usage
    ;;
  esac
done

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

case "$mode" in
desktop | desktop-fake) ;;
*)
  echo "invalid --mode: $mode" >&2
  usage
  ;;
esac

if [ -z "$version" ]; then
  version=$(node -p "require('./src-tauri/tauri.conf.json').version")
fi
if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  echo "invalid --version: $version" >&2
  exit 2
fi

release_date=${release_date:-$(date -u +%F)}
if ! [[ "$release_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || ! date -u -d "$release_date" >/dev/null 2>&1; then
  echo "invalid --date: $release_date" >&2
  exit 2
fi

out_dir=${out_dir:-dist-appimage/$mode}
mkdir -p "$out_dir"
out_dir=$(cd -- "$out_dir" && pwd)

desktop_file=src-tauri/linux/$app_id.desktop
metainfo_template=src-tauri/linux/$app_id.metainfo.xml
icon_512=src-tauri/icons/icon.png
icon_256=src-tauri/icons/128x128@2x.png

work_dir=$(mktemp -d)
cleanup() {
  if [ -n "${work_dir:-}" ] && [ -d "$work_dir" ]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT

metainfo=$work_dir/$app_id.metainfo.xml
grep -q '<!-- release -->' "$metainfo_template" || {
  echo "release marker missing in $metainfo_template" >&2
  exit 1
}
sed "s|<!-- release -->|<release version=\"$version\" date=\"$release_date\"/>|" "$metainfo_template" >"$metainfo"

echo "Validating desktop entry and metainfo"
desktop-file-validate "$desktop_file"
appstreamcli validate --no-net "$metainfo"

case "$mode" in
desktop)
  tauri_config=$(printf '{"version":"%s"}' "$version")
  ;;
desktop-fake)
  tauri_config=$(printf '{"version":"%s","build":{"beforeBuildCommand":"npm run build:desktop-fake","frontendDist":"../dist-desktop-fake"}}' "$version")
  ;;
esac

target_dir=${CARGO_TARGET_DIR:-src-tauri/target}
bundle_dir=$target_dir/release/bundle/appimage
build_marker=$work_dir/build-started
touch "$build_marker"

echo "Building Tauri AppImage ($mode, $version)"
APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --bundles appimage --config "$tauri_config"

mapfile -t tauri_appimages < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -newer "$build_marker")
if [ "${#tauri_appimages[@]}" -ne 1 ]; then
  echo "expected exactly one freshly built AppImage in $bundle_dir, found ${#tauri_appimages[@]}" >&2
  exit 1
fi
tauri_appimage=$(cd -- "$(dirname -- "${tauri_appimages[0]}")" && pwd)/$(basename -- "${tauri_appimages[0]}")
echo "Repacking $tauri_appimage"

extract_dir=$work_dir/extract
mkdir "$extract_dir"
(cd "$extract_dir" && APPIMAGE_EXTRACT_AND_RUN=1 "$tauri_appimage" --appimage-extract >/dev/null)
appdir=$extract_dir/squashfs-root
[ -d "$appdir" ] || {
  echo "extraction did not produce $appdir" >&2
  exit 1
}

mapfile -t root_desktops < <(find "$appdir" -mindepth 1 -maxdepth 1 -name '*.desktop')
if [ "${#root_desktops[@]}" -ne 1 ]; then
  echo "expected exactly one top-level .desktop file in the AppDir, found ${#root_desktops[@]}" >&2
  exit 1
fi
tauri_desktop_name=$(basename -- "${root_desktops[0]}")
tauri_icon_name=$(sed -n 's/^Icon=//p' "${root_desktops[0]}" | head -n 1)
if [ -z "$tauri_icon_name" ]; then
  echo "no Icon= entry in $tauri_desktop_name" >&2
  exit 1
fi

rm -f -- "$appdir/$tauri_desktop_name" "$appdir/usr/share/applications/$tauri_desktop_name" "$appdir/.DirIcon"
for extension in png svg xpm; do
  rm -f -- "$appdir/$tauri_icon_name.$extension"
done

install -Dm644 "$desktop_file" "$appdir/$app_id.desktop"
install -Dm644 "$desktop_file" "$appdir/usr/share/applications/$app_id.desktop"
install -Dm644 "$metainfo" "$appdir/usr/share/metainfo/$app_id.metainfo.xml"
install -Dm644 "$icon_512" "$appdir/$app_id.png"
install -Dm644 "$icon_512" "$appdir/.DirIcon"
install -Dm644 "$icon_512" "$appdir/usr/share/icons/hicolor/512x512/apps/$app_id.png"
install -Dm644 "$icon_256" "$appdir/usr/share/icons/hicolor/256x256/apps/$app_id.png"

download_verified() {
  local url=$1 dest=$2 sha256=$3
  if [ -f "$dest" ] && echo "$sha256  $dest" | sha256sum -c --status -; then
    return 0
  fi
  local partial=$dest.partial
  curl -fsSL --retry 3 -o "$partial" "$url"
  if ! echo "$sha256  $partial" | sha256sum -c --status -; then
    echo "checksum mismatch for $url" >&2
    rm -f -- "$partial"
    exit 1
  fi
  mv -f -- "$partial" "$dest"
}

tools_dir=${XDG_CACHE_HOME:-$HOME/.cache}/commitnote-appimage-tools
mkdir -p "$tools_dir"
appimagetool=$tools_dir/appimagetool-$appimagetool_version-x86_64.AppImage
runtime=$tools_dir/type2-runtime-$runtime_release-x86_64
download_verified \
  "https://github.com/AppImage/appimagetool/releases/download/$appimagetool_version/appimagetool-x86_64.AppImage" \
  "$appimagetool" "$appimagetool_sha256"
download_verified \
  "https://github.com/AppImage/type2-runtime/releases/download/$runtime_release/runtime-x86_64" \
  "$runtime" "$runtime_sha256"
chmod +x "$appimagetool"

rm -f -- "$out_dir/$appimage_name" "$out_dir/$zsync_name" "$out_dir/SHA256SUMS"
(
  cd "$out_dir"
  ARCH=x86_64 "$appimagetool" --appimage-extract-and-run \
    --runtime-file "$runtime" \
    -u "$update_info" \
    "$appdir" "$out_dir/$appimage_name"
)

[ -f "$out_dir/$appimage_name" ] || {
  echo "appimagetool did not produce $out_dir/$appimage_name" >&2
  exit 1
}
[ -f "$out_dir/$zsync_name" ] || {
  echo "appimagetool did not produce $out_dir/$zsync_name (is zsyncmake installed?)" >&2
  exit 1
}

(cd "$out_dir" && sha256sum "$appimage_name" "$zsync_name" >SHA256SUMS)

embedded_update_info=$(env -u APPIMAGE_EXTRACT_AND_RUN "$out_dir/$appimage_name" --appimage-updateinformation)
if [ "$embedded_update_info" != "$update_info" ]; then
  echo "unexpected embedded update information: $embedded_update_info" >&2
  exit 1
fi

echo
echo "AppImage:    $out_dir/$appimage_name"
echo "zsync:       $out_dir/$zsync_name"
echo "Checksums:   $out_dir/SHA256SUMS"
echo "Update info: $embedded_update_info"
