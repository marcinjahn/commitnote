#!/bin/bash
set -u

if [ "$#" -ne 1 ]; then
  echo "usage: sample-host.sh <log>" >&2
  exit 2
fi
log=$1

# A UI test job can stall for minutes with every simulator operation slow at once. These samples
# show whether the runner was short of CPU or memory then, or still had app processes left over.
while :; do
  {
    printf '%s load=%s pressure=%s apps=%s runners=%s\n' \
      "$(date -u +%H:%M:%S)" \
      "$(sysctl -n vm.loadavg | tr -d '{}' | xargs)" \
      "$(sysctl -n kern.memorystatus_vm_pressure_level)" \
      "$(pgrep -f 'commitnote.app/commitnote' | wc -l | xargs)" \
      "$(pgrep -f 'CommitnoteUITests-Runner' | wc -l | xargs)"
    sysctl -n vm.swapusage
    vm_stat | grep -E 'Pages (free|occupied by compressor)|Swapouts'
    ps -Ao pcpu=,rss=,comm= -r | head -5
  } >>"$log" 2>&1
  sleep 15
done
