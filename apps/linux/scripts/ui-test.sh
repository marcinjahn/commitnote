#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

COMMITNOTE_UI_FILTER=${1:-}
export COMMITNOTE_UI_FILTER

exec "$script_dir/container.sh" ci/steps/ui-test.sh
