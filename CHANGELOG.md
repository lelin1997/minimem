# Changelog

本文档记录 minimem 的版本变更历史。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] — 二次开发改造中

### Added
- 测试三层分离：unit / integration / e2e，各自独立 vitest 配置
- `minimem init` 交互式配置向导：5 步生成 ~/.minimem/config.toml + 创建数据目录 + 初始化 DB
- Docker 一键启动：`docker compose up` 即可运行 minimem + 持久化 volume
- CHANGELOG.md 版本治理
- `--force` 参数支持重新生成配置

### Changed
- CI 强制跑 unit + integration + typecheck + console build（不再因无 API key 跳过测试）
- console build 失败不再被 `|| echo` 软化，编译错误立即可见
- config.default.toml 精简为 5 项必填 + 注释模板（从 268 行 → ~80 行有效配置）
- DEFAULT_CONFIG 的 LLM 默认值从阿里云 qwen 改为 DeepSeek（更中性）
- e2e 测试作为独立 CI job，continue-on-error 不阻塞主流程

### Fixed
- migration v7 重复添加 `processed` 列导致 17 个测试文件 setup 失败（schema.ts 建表已含此列）
- LLM client 测试 mock 429 响应缺少 `headers` 属性导致 `response.headers.get()` 抛异常走 catch 路径，totalRetries 未记录
- 429 全局退避 30 秒污染后续测试，mock 响应加 `Retry-After: 0` 头避免阻塞

## [0.1.0] — 2026-06-12

### Added
- L1→L4 四层记忆金字塔（experiences / world_facts / observations / mental_models）
- Dream Engine 夜间流水线（Audit → Compile → Dream → Cleanup 四阶段）
- Knowledge Compile（LLM 驱动的知识页面编译）
- Surface Files 预编译 Markdown（me/soul/work/social/life/agent/context/index）
- Inspiration Engine 跨域记忆碰撞
- MCP 协议支持（stdio + Streamable HTTP，30 个 tools）
- REST API（Hono 框架，端口 6677）
- HNSW 向量索引 + FTS5 全文搜索
- Hint-Driven Recall（≤200ms 轻量记忆线索）
- 多模态感知（URL / File / Image 预处理）
- 版本控制（Snapshot / Branch / Merge）
- 遗忘曲线（linear / logarithmic / ebbinghaus 三种衰减模型）
- MiniMem Console（React + Vite + Tailwind）
- 异步摄入（add_memory 默认异步，MCP 响应 <0.5s）
- 注入检测守卫（正则规则 + LLM 两层防护）
- JWT 认证 + 客户端权限分级 + 域隔离
- better-sqlite3 + sqlcipher 加密支持
- 定时调度器（做梦 / GC / 备份 / 温度衰减）

[Unreleased]: https://github.com/lelin1997/minimem/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lelin1997/minimem/releases/tag/v0.1.0
