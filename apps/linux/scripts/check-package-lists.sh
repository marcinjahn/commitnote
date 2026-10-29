#!/bin/sh
set -eu

case "$0" in
*/*) script_path=${0%/*} ;;
*) script_path=. ;;
esac
linux_dir=$(CDPATH= cd -- "$script_path/.." && pwd)
readme=$linux_dir/README.md

failed=0

fail() {
  echo "$1" >&2
  failed=1
}

readme_block() {
  sed -n '
/^<!-- packages: '"$1"' -->$/ {
  :skip
  n
  /^$/b skip
  /^```sh$/!q
  :collect
  n
  /^```$/ {
    s/.*/@@end/
    p
    q
  }
  p
  b collect
}
' "$readme"
}

for marker in build+run run test; do
  files=
  expected=
  for part in $(printf '%s' "$marker" | tr '+' ' '); do
    list=$linux_dir/ci/$part-packages.txt
    if [ ! -f "$list" ]; then
      fail "missing ci/$part-packages.txt for README package list '$marker'"
      continue 2
    fi
    files="${files:+$files + }ci/$part-packages.txt"
    expected="$expected
$(cat "$list")"
  done
  expected=$(printf '%s\n' "$expected" | grep -v '^$' | LC_ALL=C sort -u)

  block=$(readme_block "$marker")
  if ! printf '%s\n' "$block" | grep -q -x '@@end'; then
    fail "README package list '$marker' has no marker followed by an sh block"
    continue
  fi
  block=$(printf '%s\n' "$block" | sed '$d')

  if [ "$(printf '%s\n' "$block" | sed -n '1p')" != 'sudo dnf install \' ]; then
    fail "README package list '$marker' must start with 'sudo dnf install \\'"
    continue
  fi
  body=$(printf '%s\n' "$block" | sed '1d')
  if printf '%s\n' "$body" | grep -q -v -E '^  [A-Za-z0-9._+-]+( \\)?$'; then
    fail "README package list '$marker' has a line that is not '  <package> \\' or the last '  <package>'"
    continue
  fi
  if printf '%s\n' "$body" | sed '$d' | grep -q -v -E ' \\$' ||
    printf '%s\n' "$body" | sed -n '$p' | grep -q -E ' \\$'; then
    fail "README package list '$marker' must end every line but the last with ' \\'"
    continue
  fi

  actual=$(printf '%s\n' "$body" | sed -e 's/^  //' -e 's/ \\$//' | LC_ALL=C sort)

  missing=
  for name in $expected; do
    if ! printf '%s\n' "$actual" | grep -q -F -x -- "$name"; then
      missing="$missing $name"
    fi
  done
  extra=
  for name in $actual; do
    if ! printf '%s\n' "$expected" | grep -q -F -x -- "$name"; then
      extra="$extra $name"
    fi
  done

  if [ -n "$missing$extra" ]; then
    fail "README package list '$marker' differs from $files
  missing from the README:${missing:- none}
  not in the package lists:${extra:- none}"
  fi
done

exit "$failed"
