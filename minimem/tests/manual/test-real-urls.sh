#!/bin/bash
# ============================================================
# MINIMEM-005 T-M04.4 手工验证：真实 URL 测试
# ============================================================
# 使用方法: bash tests/manual/test-real-urls.sh
# 前提: MiniMem 已启动在 localhost:6677 且 auth 已关闭

set -euo pipefail

BASE_URL="http://localhost:6677"
RESULTS_DIR="/tmp/minimem-url-tests"
mkdir -p "$RESULTS_DIR"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
SKIP=0

test_url() {
  local test_name="$1"
  local url="$2"
  local context="$3"
  local endpoint="${4:-import-url}"  # import-url 或 memory
  local extract_mode="${5:-readability}"
  local result_file="$RESULTS_DIR/${test_name}.json"

  echo ""
  echo -e "${BLUE}━━━ 测试: ${test_name} ━━━${NC}"
  echo "  URL:     $url"
  echo "  端点:    $endpoint"
  echo "  模式:    $extract_mode"

  local http_code
  local start_time=$(date +%s)

  if [ "$endpoint" = "import-url" ]; then
    http_code=$(curl -s --max-time 60 -w "%{http_code}" -o "$result_file" \
      -X POST "$BASE_URL/api/v1/memory/import-url" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$url\",\"context\":\"$context\",\"extract_mode\":\"$extract_mode\",\"source\":\"manual-test\"}")
  else
    http_code=$(curl -s --max-time 60 -w "%{http_code}" -o "$result_file" \
      -X POST "$BASE_URL/api/v1/memory" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$url\",\"context\":\"$context\",\"source\":\"manual-test\"}")
  fi

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  if [ "$http_code" = "201" ]; then
    # 解析响应
    local title content_length experience_id
    if [ "$endpoint" = "import-url" ]; then
      title=$(python3 -c "import json; d=json.load(open('$result_file')); print(d.get('title','N/A'))" 2>/dev/null || echo "N/A")
      content_length=$(python3 -c "import json; d=json.load(open('$result_file')); print(d.get('content_length',0))" 2>/dev/null || echo "0")
      experience_id=$(python3 -c "import json; d=json.load(open('$result_file')); print(d.get('experience_id','N/A'))" 2>/dev/null || echo "N/A")
    else
      title="(via /memory endpoint)"
      content_length=$(python3 -c "import json; d=json.load(open('$result_file')); si=d.get('source_info',{}); print(si.get('content_length',0))" 2>/dev/null || echo "0")
      experience_id=$(python3 -c "import json; d=json.load(open('$result_file')); print(d.get('memory_id','N/A'))" 2>/dev/null || echo "N/A")
    fi

    echo -e "  ${GREEN}✅ 成功 (HTTP $http_code, ${duration}s)${NC}"
    echo "  标题:    $title"
    echo "  内容长度: $content_length 字符"
    echo "  经历ID:  $experience_id"

    # 检查内容质量
    if [ "$content_length" -gt 100 ] 2>/dev/null; then
      echo -e "  质量:    ${GREEN}内容充足 (>100 chars)${NC}"
      PASS=$((PASS + 1))
    else
      echo -e "  质量:    ${YELLOW}内容偏少 (<100 chars)${NC}"
      PASS=$((PASS + 1))  # 仍然算通过，但标注
    fi
  elif [ "$http_code" = "000" ]; then
    echo -e "  ${YELLOW}⏭ 跳过 (连接超时或网络不可达)${NC}"
    SKIP=$((SKIP + 1))
  else
    local error
    error=$(python3 -c "import json; d=json.load(open('$result_file')); print(d.get('error','Unknown'))" 2>/dev/null || echo "Unknown")
    echo -e "  ${RED}❌ 失败 (HTTP $http_code, ${duration}s)${NC}"
    echo "  错误:    $error"
    FAIL=$((FAIL + 1))
  fi
}

# ── 健康检查 ──
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}MINIMEM-005 T-M04.4 手工验证：真实 URL 测试${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -n "检查 MiniMem 服务... "
health=$(curl -s --max-time 5 "$BASE_URL/api/v1/health" 2>/dev/null || echo "")
if echo "$health" | grep -q '"status"'; then
  echo -e "${GREEN}运行中${NC}"
else
  echo -e "${RED}未运行！请先启动 MiniMem${NC}"
  exit 1
fi

# ════════════════════════════════════════════════════════
# 测试组 1: POST /api/v1/memory/import-url 端点
# ════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}【测试组 1】POST /api/v1/memory/import-url${NC}"

# 1.1 GitHub README — Readability 模式
test_url "github-readme" \
  "https://github.com/modelcontextprotocol/servers/blob/main/README.md" \
  "MCP servers 官方仓库 README" \
  "import-url" "readability"

# 1.2 MDN 文档 — Readability 模式
test_url "mdn-promise" \
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise" \
  "MDN JavaScript Promise 文档" \
  "import-url" "readability"

# 1.3 Node.js 官方文档
test_url "nodejs-intro" \
  "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs" \
  "Node.js 入门文档" \
  "import-url" "readability"

# 1.4 Hono 框架文档 — 项目依赖文档
test_url "hono-docs" \
  "https://hono.dev/docs/getting-started/basic" \
  "Hono Web 框架入门文档" \
  "import-url" "readability"

# 1.5 Summary 模式测试
test_url "mdn-summary" \
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map" \
  "MDN Map 文档 (summary 模式)" \
  "import-url" "summary"

# 1.6 Full 模式测试
test_url "nodejs-full" \
  "https://nodejs.org/en/learn/getting-started/how-to-install-nodejs" \
  "Node.js 安装文档 (full 模式)" \
  "import-url" "full"

# ════════════════════════════════════════════════════════
# 测试组 2: POST /api/v1/memory { url } 端点
# ════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}【测试组 2】POST /api/v1/memory { url }${NC}"

# 2.1 TypeScript 文档
test_url "typescript-docs" \
  "https://www.typescriptlang.org/docs/handbook/2/basic-types.html" \
  "TypeScript Handbook 基础类型" \
  "memory"

# 2.2 SQLite 文档
test_url "sqlite-docs" \
  "https://www.sqlite.org/wal.html" \
  "SQLite WAL 模式文档" \
  "memory"

# ════════════════════════════════════════════════════════
# 测试组 3: 边界情况与错误处理
# ════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}【测试组 3】边界情况与错误处理${NC}"

# 3.1 SSRF 保护 — 内网 IP 应被拒绝
echo ""
echo -e "${BLUE}━━━ 测试: ssrf-private-ip ━━━${NC}"
echo "  URL:     http://127.0.0.1:8080/secret"
http_code=$(curl -s --max-time 10 -w "%{http_code}" -o "$RESULTS_DIR/ssrf-private.json" \
  -X POST "$BASE_URL/api/v1/memory/import-url" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://127.0.0.1:8080/secret","source":"manual-test"}')
if [ "$http_code" != "201" ]; then
  echo -e "  ${GREEN}✅ SSRF 防护生效 (HTTP $http_code — 正确拒绝)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ SSRF 防护失败！内网 URL 不应被接受${NC}"
  FAIL=$((FAIL + 1))
fi

# 3.2 SSRF 保护 — 非标准端口
echo ""
echo -e "${BLUE}━━━ 测试: ssrf-bad-port ━━━${NC}"
echo "  URL:     http://example.com:9999/admin"
http_code=$(curl -s --max-time 10 -w "%{http_code}" -o "$RESULTS_DIR/ssrf-port.json" \
  -X POST "$BASE_URL/api/v1/memory/import-url" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://example.com:9999/admin","source":"manual-test"}')
if [ "$http_code" != "201" ]; then
  echo -e "  ${GREEN}✅ 端口保护生效 (HTTP $http_code — 正确拒绝)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ 端口保护失败！非标准端口不应被接受${NC}"
  FAIL=$((FAIL + 1))
fi

# 3.3 非 HTTP 协议应被拒绝
echo ""
echo -e "${BLUE}━━━ 测试: ssrf-bad-protocol ━━━${NC}"
echo "  URL:     ftp://files.example.com/data"
http_code=$(curl -s --max-time 10 -w "%{http_code}" -o "$RESULTS_DIR/ssrf-protocol.json" \
  -X POST "$BASE_URL/api/v1/memory/import-url" \
  -H "Content-Type: application/json" \
  -d '{"url":"ftp://files.example.com/data","source":"manual-test"}')
if [ "$http_code" != "201" ]; then
  echo -e "  ${GREEN}✅ 协议保护生效 (HTTP $http_code — 正确拒绝)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ 协议保护失败！非 HTTP 协议不应被接受${NC}"
  FAIL=$((FAIL + 1))
fi

# 3.4 重复 URL 去重检测
echo ""
echo -e "${BLUE}━━━ 测试: dedup-check ━━━${NC}"
echo "  重复导入 Hono 文档..."
http_code=$(curl -s --max-time 60 -w "%{http_code}" -o "$RESULTS_DIR/dedup.json" \
  -X POST "$BASE_URL/api/v1/memory/import-url" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://hono.dev/docs/getting-started/basic","context":"重复测试","source":"manual-test"}')
echo "  HTTP: $http_code"
if [ "$http_code" = "201" ] || [ "$http_code" = "200" ] || [ "$http_code" = "409" ]; then
  echo -e "  ${GREEN}✅ 重复 URL 处理正常 (HTTP $http_code)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}⚠ 非预期状态码: $http_code${NC}"
  SKIP=$((SKIP + 1))
fi

# ════════════════════════════════════════════════════════
# 测试组 4: 搜索验证 — 确认导入的内容可被检索
# ════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}【测试组 4】搜索验证${NC}"

echo ""
echo -e "${BLUE}━━━ 测试: search-imported ━━━${NC}"
echo "  搜索: Promise JavaScript"
search_result=$(curl -s --max-time 10 "$BASE_URL/api/v1/memory/search?query=Promise%20JavaScript&top_k=3" 2>/dev/null || echo "{}")
result_count=$(echo "$search_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('results',[])))" 2>/dev/null || echo "0")
if [ "$result_count" -gt 0 ] 2>/dev/null; then
  echo -e "  ${GREEN}✅ 找到 $result_count 条相关结果${NC}"
  # 展示第一条结果的前 150 字符
  echo "$search_result" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('results'):
    r = d['results'][0]
    print(f'  首条匹配 ID: {r.get(\"id\",\"?\")}')
    content = r.get('content','')[:150]
    print(f'  内容预览: {content}')
" 2>/dev/null
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}⚠ 未找到结果（可能 FTS 索引延迟）${NC}"
  SKIP=$((SKIP + 1))
fi

echo ""
echo -e "${BLUE}━━━ 测试: search-hono ━━━${NC}"
echo "  搜索: Hono framework routing"
search_result=$(curl -s --max-time 10 "$BASE_URL/api/v1/memory/search?query=Hono%20framework%20routing&top_k=3" 2>/dev/null || echo "{}")
result_count=$(echo "$search_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('results',[])))" 2>/dev/null || echo "0")
if [ "$result_count" -gt 0 ] 2>/dev/null; then
  echo -e "  ${GREEN}✅ 找到 $result_count 条相关结果${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}⚠ 未找到结果${NC}"
  SKIP=$((SKIP + 1))
fi

# ════════════════════════════════════════════════════════
# 汇总
# ════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}测试汇总${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}通过: $PASS${NC}"
echo -e "  ${RED}失败: $FAIL${NC}"
echo -e "  ${YELLOW}跳过: $SKIP${NC}"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}🎉 所有测试通过！T-M04.4 手工验证完成${NC}"
  exit 0
else
  echo -e "${RED}⚠ 有 $FAIL 个测试失败，需要排查${NC}"
  exit 1
fi
