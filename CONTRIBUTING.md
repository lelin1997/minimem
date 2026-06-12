# 贡献指南

感谢你对 MiniMem 的关注！欢迎提交 Issue、PR 或参与讨论。

## 开发环境

```bash
# 核心引擎
cd minimem
pnpm install
cp .env.example .env  # 编辑填入 LLM API Key

# 控制台
cd ../minimem-console
pnpm install
cp .env.example .env
```

## 代码规范

- TypeScript strict mode
- 使用 `pnpm lint` 检查代码规范
- 使用 `pnpm typecheck` 检查类型
- 提交前运行 `pnpm test`

## PR 流程

1. Fork 本仓库
2. 创建 feature 分支
3. 编写代码 + 测试
4. 确保所有测试通过
5. 提交 PR 并描述变更内容

## 项目结构

见 [README.md](./README.md#项目结构)
