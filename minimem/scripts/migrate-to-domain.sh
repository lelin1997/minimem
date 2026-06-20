#!/bin/bash
# P3 迁移脚本: 将一个模块从 src/X/ 迁移到 src/domain/X/
# 用法: ./migrate-to-domain.sh <module_name>
# 例: ./migrate-to-domain.sh retrieval

set -e

MODULE=$1
SRC_DIR="/Users/lelin/WorkBuddy/2026-06-19-23-53-44/minimem/minimem/src/$MODULE"
DST_DIR="/Users/lelin/WorkBuddy/2026-06-19-23-53-44/minimem/minimem/src/domain/$MODULE"

if [ -z "$MODULE" ]; then
  echo "Usage: $0 <module_name>"
  exit 1
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "Source dir $SRC_DIR does not exist"
  exit 1
fi

echo "=== 1. 移动 $MODULE → domain/$MODULE ==="
mkdir -p "$DST_DIR"
cp -r "$SRC_DIR"/* "$DST_DIR"/
rm -rf "$SRC_DIR"

echo "=== 2. 修复 src/ 下的外部引用 ==="
# 找所有引用 ../MODULE/ 或 ../../MODULE/ 的 src/ 文件
# 替换为 ../domain/MODULE/ 或 ../../domain/MODULE/
cd /Users/lelin/WorkBuddy/2026-06-19-23-53-44/minimem/minimem

# src/ 下一级目录文件引用 ../MODULE/ → ../domain/MODULE/
find src -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '\.\./$MODULE/|from '../domain/$MODULE/|g" {} + 2>/dev/null
# src/ 下二级目录文件引用 ../MODULE/ → ../domain/MODULE/
find src -maxdepth 2 -name "*.ts" -exec sed -i '' "s|from '\.\./$MODULE/|from '../domain/$MODULE/|g" {} + 2>/dev/null
# src/ 下三级目录文件引用 ../../MODULE/ → ../../domain/MODULE/
find src -maxdepth 3 -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./$MODULE/|from '../../domain/$MODULE/|g" {} + 2>/dev/null
# 动态 import 也要改
find src -name "*.ts" -exec sed -i '' "s|import('\.\./$MODULE/|import('../domain/$MODULE/|g" {} + 2>/dev/null
find src -name "*.ts" -exec sed -i '' "s|import('\.\./\.\./$MODULE/|import('../../domain/$MODULE/|g" {} + 2>/dev/null

echo "=== 3. 修复 tests/ 下的引用 ==="
find tests -name "*.ts" -exec sed -i '' "s|'../../src/$MODULE/|'../../src/domain/$MODULE/|g" {} + 2>/dev/null
find tests -name "*.ts" -exec sed -i '' "s|'../../../src/$MODULE/|'../../../src/domain/$MODULE/|g" {} + 2>/dev/null

echo "=== 4. 修复 domain/$MODULE/ 内部引用深度 ==="
# domain/MODULE/*.ts 引用 ../xxx → ../../xxx (但不改 ./xxx)
for ext in common store config llm retrieval surface lifecycle version owner core; do
  find "$DST_DIR" -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '\.\./$ext/|from '../../$ext/|g" {} + 2>/dev/null
done
# domain/MODULE/sub/ 下的文件引用 ../../xxx → ../../../xxx
for ext in common store config llm retrieval surface lifecycle version owner core; do
  find "$DST_DIR" -mindepth 2 -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./$ext/|from '../../../$ext/|g" {} + 2>/dev/null
done

echo "=== 5. 检查残留 ==="
RESIDUAL=$(grep -rnE "from '.*(/src/$MODULE/|/\.\./$MODULE/)" src/ tests/ --include="*.ts" 2>/dev/null | grep -v "domain/$MODULE" | head -5)
if [ -z "$RESIDUAL" ]; then
  echo "✓ 无残留"
else
  echo "⚠ 残留引用:"
  echo "$RESIDUAL"
fi

echo "=== 6. typecheck ==="
cd /Users/lelin/WorkBuddy/2026-06-19-23-53-44/minimem/minimem
pnpm typecheck 2>&1 | tail -5
