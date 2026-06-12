#!/bin/bash
sqlite3 /root/.minimem-console/console.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null
cd /root/minimem/minimem-console
# 清除 tsx 缓存
rm -rf /tmp/tsx-*
exec npx tsx server/index.ts
