#!/bin/sh
set -eu

# Runs as root: the test user owns /out while the command runs, then everything in it goes back to
# whoever owns the mounted directory, which is the invoking host user.
out_owner=$(stat -c %u:%g /out)
restore_out_owner() {
  chown -R "$out_owner" /out
}
trap restore_out_owner EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

chown tester:tester /out
setpriv --reuid=tester --regid=tester --init-groups --reset-env "$@"
