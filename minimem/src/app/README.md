# src/app/ — 应用编排层

P3 架构重构（TODO-035）创建的目录。

## 职责边界

**应用入口与编排**：组装各层依赖、启动服务、生命周期管理。
不含业务逻辑，只做"把正确的实现注入正确的接口"。

### 将迁入的内容

| 来源 | 迁入位置 | 内容 |
|------|----------|------|
| `src/index.ts` | `src/app/main.ts` | 主入口、启动流程 |
| `src/cli/` | `src/app/cli/` | CLI 命令（init、db 管理） |
| 新增 | `src/app/composition/` | 依赖注入容器、接口绑定 |

### 编排职责

1. 加载配置（config）
2. 初始化基础设施（infra）：DB、向量存储、LLM 客户端、调度器
3. 组装领域服务（domain）：注入 infra 实现到 domain 接口
4. 启动适配器（adapters）：REST API、MCP Server
5. 优雅关闭：反序释放资源

### 依赖规则

- ✅ 可依赖：所有层（`common`、`config`、`domain`、`infra`、`adapters`）
- ❌ 不可被任何层依赖（顶层，无下游）

## 当前状态

- [x] 目录创建（TODO-035）
- [ ] 入口迁移（C3 阶段完成后）
