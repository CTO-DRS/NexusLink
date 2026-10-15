#!/usr/bin/env bash
# مراقبة شارة release.yml على main — تسجيل كل انتقال حالة مع الطابع الزمني
URL="https://github.com/CTO-DRS/NexusLink/actions/workflows/release.yml/badge.svg?branch=main"
LOG=/tmp/badge.log
LAST=""
while true; do
  T=$(curl -s --max-time 20 "$URL" | grep -o '<title>[^<]*</title>' | sed 's/<[^>]*>//g')
  if [ "$T" != "$LAST" ]; then
    echo "$(date -u '+%H:%M:%S') | $T" >> "$LOG"
    LAST="$T"
  fi
  sleep 60
done
