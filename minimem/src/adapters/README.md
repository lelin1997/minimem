# src/adapters/ — 适配层

P3 架构重构（TODO-035、TODO-038）创建的目录。

## 职责边界

存放**外部接口适配器**：HTTP API、MCP Server、第三方连接器。
将外部请求转换为 domain 层调用，将 domain 层返回转换为外部协议格式。

### 将迁入的模块（TODO-038）

| 来源 | 迁入位置 | 内容 |
|------|----------|------|
| `src/gateway/` | `src/adapters/rest/` | Hono REST API |
| `src/gateway/` | `src/adapters/mcp/` | MCP Server (stdio + HTTP) |
| `src/gateway/` | `src/adapters/auth/` | 认证中间件、限流 |
| `src/connectors/` | `src/adapters/connectors/` | 第三方集成（腾讯文档等） |

### 依赖规则

- ✅ 可依赖：`src/common/`、`src/config/`、`src/domain/`
- ❌ 不可直接依赖：`src/infra/`（通过 domain 的接口间接调用）

## 当前状态

- [x] 目录创建（TODO-035）
- [ ] 代码迁移（TODO-038，待 C3 阶段）
