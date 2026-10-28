#!/bin/bash
set -u

if [ "$#" -ne 1 ]; then
  echo "usage: sample-host.sh <log>" >&2
  exit 2
fi
log=$1
mkdir -p "$(dirname "$log")"

# A UI test job can stall for minutes with every simulator operation slow at once. These samples
# show whether the runner was short of CPU or memory then, and which processes held it.
echo "memsize=$(sysctl -n hw.memsize) ncpu=$(sysctl -n hw.ncpu)" >>"$log"
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
    ps -Ao rss=,comm= | awk '{ total += $1; count++ } /CoreSimulator/ { sim += $1; simcount++ }
      END { printf "processes=%d rss=%dM simulator processes=%d rss=%dM\n", count, total / 1024, simcount, sim / 1024 }'
    echo "by cpu:"
    ps -Ao pcpu=,rss=,comm= -r | awk 'NR <= 5' | sed -E 's#^( *[0-9.]+ +[0-9]+ +).*/#\1#'
    echo "by memory:"
    ps -Ao pcpu=,rss=,comm= -m | awk 'NR <= 8' | sed -E 's#^( *[0-9.]+ +[0-9]+ +).*/#\1#'
  } >>"$log" 2>&1
  sleep 15
done
