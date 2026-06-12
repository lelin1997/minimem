# MiniMem 文档目录

## 📋 项目管理

| 文件 | 说明 |
|------|------|
| [TODO.md](./TODO.md) | 待办事项和开发计划 |

## 🏗️ 架构设计 (`architecture/`)

| 文件 | 说明 |
|------|------|
| [DESIGN.md](./architecture/DESIGN.md) | 系统整体设计文档（核心） |
| [ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | 架构概览和模块关系 |
| [CROSS-REFERENCE.md](./architecture/CROSS-REFERENCE.md) | 模块间交叉引用和依赖关系 |

## 🔄 流程与管线 (`pipelines/`)

| 文件 | 说明 |
|------|------|
| [FLOWS.md](./pipelines/FLOWS.md) | 核心数据流和业务流程 |
| [INGEST-PIPELINE.md](./pipelines/INGEST-PIPELINE.md) | 数据摄入管线详解 |
| [RETRIEVAL-PIPELINE.md](./pipelines/RETRIEVAL-PIPELINE.md) | 记忆检索管线详解 |
| [SCHEDULER-DEEP-DIVE.md](./pipelines/SCHEDULER-DEEP-DIVE.md) | 调度器深度解析 |
| [MODULES-DEEP-DIVE.md](./pipelines/MODULES-DEEP-DIVE.md) | 各业务模块深度解析 |

## 🔧 修复记录 (`repairs/`)

| 文件 | 说明 |
|------|------|
| [REPAIR.md](./repairs/REPAIR.md) | 修复批次 1 — 初始问题修复 |
| [REPAIR-2.md](./repairs/REPAIR-2.md) | 修复批次 2 — 后续问题修复 |
| [REPAIR-3.md](./repairs/REPAIR-3.md) | 修复批次 3 — Surface Sync 机制修复 |

## 📌 根目录保留文件

| 文件 | 说明 |
|------|------|
| `SKILL.md` | Skill 定义文件（扫描器需要从根目录读取，不可移动） |
