# minimem 通用集成指南

> 任何 AI 编码助手或 Agent 框架，只要能注入 system prompt，就能接入 minimem 记忆系统。本文给出通用配置 prompt 和三类环境的落地方式。

## 核心原理

minimem 通过 MCP 协议暴露工具，AI 助手通过以下闭环与 minimem 交互：

```
读：get_relevant_context → Surface Files + 深层记忆 → 注入到 system prompt 或上下文
写：add_memory → 工作摘要写入 minimem → Dream 提炼 → 更新 Surface Files → 下轮读取
```

**接入条件只有一个**：AI 助手能调用 MCP 工具（minimem-local 连接器），且能通过某种方式把"调用 minimem"的指令注入到 system prompt 或每轮上下文中。

## 通用注入 Prompt

以下 prompt 适用于任何支持 system prompt 自定义的环境。根据你的工具找到对应的注入点，把这段 prompt 粘进去即可。

```markdown
# minimem 记忆系统集成

## 读取（会话开始时）

每个新会话开始时，你必须先调用 `mcp__minimem-local__get_relevant_context` 获取当前 Surface Files 和深层记忆检索结果，然后再处理用户请求。

调用参数：
- current_topic: 设为用户消息的主题或意图
- agent_type: 设为 "codebuddy"（或当前工具标识）
- include_hints: true

返回内容包含 me.md（用户画像）、context.md（工作上下文）、work.md（工作笔记）、agent.md（Agent 指南）等 Surface Files，以及记忆线索 hints。这些是你的长期记忆，请基于它们理解用户背景和历史工作。

如果 minimem-local 连接器未激活或调用失败，静默跳过，不影响正常对话。

## 写入（任务完成后）

完成任何实质性工作后，调用 `mcp__minimem-local__add_memory` 将工作摘要写入 minimem：

- content: 压缩后的工作摘要（5-15 行，含：改了什么、为什么、关键决策、发现）
- source: 当前工具标识（如 "workbuddy" / "codebuddy" / "my-agent"）
- content_type: 按工作类型选择
  - event: 完成了某个操作
  - decision: 做了技术决策
  - reflection: 总结了经验教训
  - note: 记录了信息
- importance: 0.6-0.9（routine=0.6, design=0.8, architecture=0.9）
- tags: ["project:<项目名>", "memory-sync"]
- context: "daily log for <项目名>"

## 检索（需要历史信息时）

当用户问及历史工作、之前的技术决策、或需要跨会话上下文时，调用：
- `mcp__minimem-local__search_memory`：语义+关键词+图遍历+时间 四路混合搜索
- `mcp__minimem-local__list_memories`：分页浏览记忆

## 优先级

此集成指令的优先级低于用户的直接指令。如果用户说"不用查记忆"或"先不要记录"，则跳过。
```

---

## 三类环境的落地方式

### 类型 1：有 Rules / 自定义指令机制的工具

适用：CodeBuddy Code (CLI)、CodeBuddy IDE、Cursor（.cursorrules）、Windsurf（.windsurfrules）、Claude Code（CLAUDE.md）等。

**注入点**：Rules 文件 / 自定义指令文件，设为 `alwaysApply: true` 或等效的"每次加载"。

**配置方法**：把上方"通用注入 Prompt"内容写入对应的 rules 文件。

| 工具 | 文件位置 | 格式 |
|------|----------|------|
| CodeBuddy Code / IDE | `~/.codebuddy/rules/minimem-integration.mdc` | `.mdc` 带 frontmatter |
| Cursor | `<项目>/.cursor/rules/minimem.md` | `.md` |
| Windsurf | `<项目>/.windsurfrules` | 纯文本 |
| Claude Code | `<项目>/CLAUDE.md` 或 `~/.claude/CLAUDE.md` | `.md` |

### 类型 2：有 Hook 机制的工具（进阶，支持动态注入）

适用：CodeBuddy Code (CLI)、Claude Code 等。

**注入点**：`UserPromptSubmit` Hook 脚本，每轮调 LLM 前执行，返回值通过 `additionalContext` 注入。

**优势**：不依赖 LLM 自觉调用，系统级保证每轮注入最新 Surface Files。

**配置方法**：

1. 在 settings.json 配 Hook：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [{
          "type": "command",
          "command": "python3 ~/.codebuddy/hooks/minimem-inject.py",
          "timeout": 10
        }]
      }
    ]
  }
}
```

2. Hook 脚本调 minimem `get_relevant_context`，返回 Surface Files：

```python
#!/usr/bin/env python3
"""UserPromptSubmit Hook: 调 minimem get_relevant_context，返回 Surface Files 注入上下文"""
import json, sys, urllib.request

def main():
    input_data = json.load(sys.stdin)
    prompt = input_data.get("prompt", "")

    try:
        req = urllib.request.Request(
            "http://127.0.0.1:6678/mcp",
            data=json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "get_relevant_context",
                           "arguments": {"current_topic": prompt[:200], "agent_type": "codebuddy"}}
            }).encode(),
            headers={"Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode()
            for line in raw.split("\n"):
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    content = data.get("result", {}).get("content", [{}])[0].get("text", "")
                    result = json.loads(content)
                    surface = result.get("surface_injection", "")
                    if surface:
                        print(json.dumps({
                            "continue": True,
                            "hookSpecificOutput": {
                                "hookEventName": "UserPromptSubmit",
                                "additionalContext": f"<minimem_surface>\n{surface}\n</minimem_surface>"
                            }
                        }))
                        return
    except Exception:
        pass

    print(json.dumps({"continue": True}))

main()
```

**推荐**：Rules + Hook 同时配。Rules 做"写入"行为约定，Hook 做"读取"自动注入。

### 类型 3：自定义 Agent（自建 runtime）

适用：自建 Agent 框架、LangChain Agent、Letta/MemGPT 风格的有状态 Agent。

**注入点**：你的 Agent runtime 里组装 system prompt 的代码。

**配置方法**：在组装 system prompt 时，先调 minimem `get_relevant_context`，把返回的 Surface Files 拼到 system prompt 里。

```python
import requests

def build_system_prompt(user_message: str) -> str:
    base_prompt = "你是一个 AI 助手..."

    # 调 minimem 获取 Surface Files
    try:
        resp = requests.post("http://127.0.0.1:6678/mcp", json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "get_relevant_context",
                       "arguments": {"current_topic": user_message[:200], "agent_type": "general"}}
        }, headers={"Accept": "application/json, text/event-stream"}, timeout=8)

        # 解析 SSE 响应
        for line in resp.text.split("\n"):
            if line.startswith("data: "):
                data = json.loads(line[6:])
                content = data["result"]["content"][0]["text"]
                result = json.loads(content)
                surface = result.get("surface_injection", "")
                if surface:
                    return f"{base_prompt}\n\n<minimem_surface>\n{surface}\n</minimem_surface>"
    except Exception:
        pass

    return base_prompt
```

任务完成后写入：

```python
def sync_to_minimem(summary: str, project: str, work_type: str = "event"):
    requests.post("http://127.0.0.1:6678/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "add_memory",
                   "arguments": {
                       "content": summary,
                       "source": "my-agent",
                       "content_type": work_type,
                       "importance": 0.8,
                       "tags": [f"project:{project}", "memory-sync"],
                       "context": f"daily log for {project}"
                   }}
    }, headers={"Accept": "application/json, text/event-stream"}, timeout=10)
```

**优势**：完全可控，等效于 Letta 的 core_memory 每轮注入。

---

## 类型 4：WorkBuddy 桌面版（闭源 runtime，受限方案）

WorkBuddy 桌面版不开放 Rules 和 Hook，但提供「自定义指令」功能。

**注入点**：设置 → 个性化 → 自定义指令。

**配置方法**：把上方"通用注入 Prompt"内容粘贴进去。新会话生效（当前会话不生效）。

**局限**：静态文本注入，依赖 LLM 自觉调用 minimem，不是系统级保证。

---

## 前置条件

### minimem 服务部署

```bash
cd /path/to/minimem/minimem

# 1. 配置 LLM API Key
echo 'MINIMEM_LLM_API_KEY=sk-xxxx' > .env

# 2. 开启 MCP tools advanced 层（让 surface_append/replace 可用）
cat > ~/.minimem/config.toml << 'EOF'
[mcp.tools]
exposure_level = "advanced"
EOF

# 3. 启动 MCP HTTP 服务（端口 6678）
node node_modules/tsx/dist/cli.mjs src/index.ts --mcp-http --insecure
```

### MCP 连接器配置

在工具的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "minimem-local": {
      "url": "http://127.0.0.1:6678/mcp",
      "type": "streamable-http",
      "defer_loading": false
    }
  }
}
```

### 服务保活（macOS launchd）

创建 `~/Library/LaunchAgents/com.minimem.mcp.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.minimem.mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>{node_path}</string>
    <string>{minimem_dir}/node_modules/tsx/dist/cli.mjs</string>
    <string>src/index.ts</string>
    <string>--mcp-http</string>
    <string>--insecure</string>
  </array>
  <key>WorkingDirectory</key><string>{minimem_dir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/minimem-mcp-stdout.log</string>
  <key>StandardErrorPath</key><string>/tmp/minimem-mcp-stderr.log</string>
</dict>
</plist>
```

加载：`launchctl load ~/Library/LaunchAgents/com.minimem.mcp.plist`

---

## 方案对比总览

| 环境类型 | 注入机制 | 动态内容 | 自动化保证 | 配置难度 |
|----------|----------|----------|------------|----------|
| Rules / 自定义指令 | system prompt 静态文本 | ❌ | 依赖 LLM 自觉 | 低 |
| Hook（UserPromptSubmit） | 每轮脚本执行，返回值注入 | ✅ | 系统级保证 | 中 |
| 自定义 Agent runtime | 代码直接组装 system prompt | ✅ | 完全可控 | 高 |
| WorkBuddy 桌面版 | 自定义指令（静态） | ❌ | 依赖 LLM 自觉 | 低 |

## 验证清单

| 验证项 | 方法 |
|--------|------|
| MCP 连接 | 工具能列出 minimem 的 tools |
| Surface 注入 | 问 agent "我的技术栈是什么"（答案在 me.md） |
| 记忆写入 | 调 `add_memory` 返回 memory_id |
| 记忆检索 | `search_memory` 命中已处理记忆 |
| 记忆列表 | `list_memories` 返回 total > 0 |
