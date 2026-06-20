# src/infra/ — 基础设施层

P3 架构重构（TODO-035、TODO-037）创建的目录。

## 职责边界

存放**技术实现细节**：数据库访问、外部 API 调用、调度器、文件系统操作。
实现 `src/domain/ports/` 定义的接口，被 domain 层通过接口调用。

### 将迁入的模块（TODO-037）

| 来源 | 迁入位置 | 内容 |
|------|----------|------|
| `src/store/` | `src/infra/persistence/` | SQLite、迁移、向量存储、FTS 索引 |
| `src/llm/` | `src/infra/llm/` | LLM 客户端、Prompt 模板、缓存 |
| `src/scheduler/` | `src/infra/scheduler/` | node-cron 调度、启动补偿 |
| `src/security/` | `src/infra/security/` | JWT、Keychain、加密 |
| `src/observability/` | `src/infra/observability/` | Metrics、health |

### 抽象接口（在 `src/domain/ports/` 定义，infra 实现）

- `LLMClient` — chat / chatJson / embed / embedBatch
- `VectorStore` — add / search / saveToDisk / loadFromDisk
- `MemoryRepository` — CRUD 四层记忆表
- `Scheduler` — register / start / stop

### 依赖规则

- ✅ 可依赖：`src/common/`、`src/config/`、`src/domain/ports/`（实现接口）
- ❌ 不可依赖：`src/domain/`（除 ports 接口）、`src/adapters/`、`src/app/`

## 当前状态

- [x] 目录创建（TODO-035）
- [ ] 代码迁移 + 接口抽象（TODO-037，待 C3 阶段）
