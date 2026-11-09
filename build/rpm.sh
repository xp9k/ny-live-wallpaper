#!/bin/sh
# Builds MOS 12 / MOS 13 RPMs from the source archive prepared by `npm run build`,
# then tests install, reinstall, verification and removal in a disposable
# RPM root and database. Run on Linux with rpmbuild (for example in a container).
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
target=${1:-all}
case "$target" in
    all) sh "$0" mos12; sh "$0" mos13; exit ;;
    mos12|mos13) ;;
    *) echo 'Usage: rpm.sh [mos12|mos13|all]' >&2; exit 2 ;;
esac
spec=packaging/ny-wallpaper.spec
native=.cache/release/native
shader=contents/shaders/scene.frag.qsb
if [ "$target" = mos12 ]; then
    spec=packaging/ny-wallpaper-mos12.spec
    native=.cache/release/mos12
    shader=contents/ui/ShaderSources.js
fi
id=org.ny.livewallpaper
top="$root/.cache/rpm/$target"
version=$(sed -n 's/^Version:[[:space:]]*//p' "$spec")
release=$(sed -n 's/^Release:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$spec")
test -s "$top/SOURCES/ny-wallpaper-$version.tar.gz" || { echo 'Run npm run build first.' >&2; exit 1; }

rm -rf "$top/BUILD" "$top/BUILDROOT" "$top/RPMS" "$top/SRPMS" "$top/SPECS"
mkdir -p "$top/BUILD" "$top/BUILDROOT" "$top/RPMS" "$top/SPECS" "$top/SRPMS"
rpmbuild --define "_topdir $top" --define "dist .$target" \
    --define '_buildhost localhost' --define '_binary_payload w6.gzdio' \
    -bb "$spec"
rpm_file="$top/RPMS/noarch/ny-wallpaper-$version-$release.$target.noarch.rpm"

rpm -K "$rpm_file"
rpm -qp --requires "$rpm_file" > "$top/requires.txt"
rpm -qpl "$rpm_file" > "$top/files.txt"
rpm -qp --scripts "$rpm_file" > "$top/scripts.txt"
test ! -s "$top/scripts.txt"
test "$(rpm -qp --queryformat '%{ARCH}' "$rpm_file")" = noarch
# Only the wallpaper, its docs and its license (with or without the version suffix).
awk -v a="/usr/share/plasma/wallpapers/$id" -v b="/usr/share/doc/ny-wallpaper-$version" -v c="/usr/share/licenses/ny-wallpaper" \
    '!($0 == a || index($0, a "/") == 1 || $0 == b || index($0, b "/") == 1 || index($0, c) == 1) { exit 1 }' "$top/files.txt"
grep -q '/LICENSE$' "$top/files.txt"
if [ "$target" = mos12 ]; then
    grep -Fx 'plasma5-workspace >= 5.27' "$top/requires.txt"
    grep -Fx 'qt5-qtdeclarative >= 5.15' "$top/requires.txt"
    grep -Fx 'lib64qt5-qtquick-qml >= 5.15' "$top/requires.txt"
    grep -Fx 'lib64qt5-qtquickcontrols2-qml >= 5.15' "$top/requires.txt"
else
    grep -Fx 'plasma6-workspace >= 6.0' "$top/requires.txt"
    grep -Fx 'qt6-qtdeclarative >= 6.4' "$top/requires.txt"
fi
grep -Fx 'qml(org.kde.taskmanager)' "$top/requires.txt"

# Real RPM transactions in a disposable filesystem and database only.
# Plasma is not present here, so dependency checks are skipped.
test_root=$(mktemp -d /tmp/ny-rpm-test.XXXXXX)
installed="$test_root/usr/share/plasma/wallpapers/$id"
mkdir -p "$test_root/var/lib/rpm"
rpm --root "$test_root" --initdb
rpm --root "$test_root" --nodeps -Uvh "$rpm_file"
rpm --root "$test_root" --nodeps -V ny-wallpaper
cmp "$native/$id/metadata.json" "$installed/metadata.json"
cmp "$native/$id/$shader" "$installed/$shader"
rpm --root "$test_root" --nodeps -Uvh --replacepkgs "$rpm_file"
rpm --root "$test_root" --nodeps -V ny-wallpaper
rpm --root "$test_root" -e ny-wallpaper
test ! -e "$installed"
rm -rf "$test_root"

mkdir -p dist
cp "$rpm_file" dist/
printf '%s\n' 'PASS: RPM digests, declared dependencies, noarch payload, install, reinstall, file verification and removal' | tee "$top/test-results.txt"
