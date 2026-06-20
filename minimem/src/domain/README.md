# src/domain/ — 领域逻辑层

P3 架构重构（TODO-035~036）创建的目录。

## 职责边界

存放 minimem 的**核心业务逻辑**，与具体技术实现（数据库、LLM API、HTTP 框架）解耦。

### 将迁入的模块（TODO-036）

| 来源 | 迁入位置 | 内容 |
|------|----------|------|
| `src/core/` | `src/domain/perception/` | 记忆摄入、质量门控、注入检测 |
| `src/core/` | `src/domain/consolidation/` | L1→L2 提炼、L2→L3 归纳、L3→L4 提议 |
| `src/core/` | `src/domain/feedback/` | 反馈传播、修正 |
| `src/recall/` | `src/domain/recall/` | 召回引擎、提示生成 |
| `src/retrieval/` | `src/domain/retrieval/` | 检索策略（FTS + 向量混合） |
| `src/surface/` | `src/domain/surface/` | Surface Files 注入、编辑、同步 |
| `src/modules/dream/` | `src/domain/dream/` | Dream Engine、Compiler、Quality Score |
| `src/lifecycle/` | `src/domain/lifecycle/` | 温度衰减、遗忘、GC |
| `src/version/` | `src/domain/version/` | 快照、分支、差异 |
| `src/owner/` | `src/domain/owner/` | Owner profile、Person profiles |

### 依赖规则

- ✅ 可依赖：`src/common/`、`src/config/`、`src/domain/` 内部
- ❌ 不可依赖：`src/infra/`、`src/adapters/`、`src/app/`
- 通过接口（定义在 `src/domain/ports/`）反向依赖 infra，由 infra 实现

## 当前状态

- [x] 目录创建（TODO-035）
- [ ] 代码迁移（TODO-036，待 C3 阶段）
