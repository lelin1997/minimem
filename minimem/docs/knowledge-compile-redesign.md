# Knowledge Compile 重新设计（精简版 v2）

> 上一版（v1）过度对标 Obsidian/Roam Research，列了 11 项 TODO。
> 本版砍掉"给人看的 UI"和"过度工程"，只保留"LLM 主动管理文档"的最小可行能力集。

## 背景：用户实测发现的问题

1. **生成毫不相干的文档** —— "MiniMem" 页面被描述为"多机迁移系统"（完全错误）
2. **内容发散非技术相关** —— 大量哲学化、比喻性、跨领域强行关联
3. **审计标记堆积** —— 同一问题被重复标记 3 次

## 根因诊断（实测 DB 数据）

| 根因 | 证据 |
|------|------|
| 源头污染 | compile_queue 里 241 条 `query_insight` 是 Inspiration Engine 的"灵感"文本，本身哲学化，不是事实 |
| 格式错配 | compiler 用 `split(' — ')` 解析三元组，但 query_insight 不是三元组格式，整段被当成 subject |
| 跨项目混杂 | L1 全部 domain=default，compile 取 30 条跨 4 个项目，LLM 强行建立关联 |
| lint 死循环 | 5349 条 `lint_finding` 被 filter 跳过但被 markCompiledBatch 标记已处理，审计标记无限堆积 |
| 温度过高 | temperature=0.6 让 LLM 自由发挥编织叙事 |

## 设计原则

**借鉴 Obsidian/Roam 的核心思路（3 个），砍掉给人看的能力（5 个）**：

### 借鉴的思路
1. **链接是关系而非装饰**（Obsidian）—— `[[slug]]` 解析落库，可查询，不做 UI
2. **增量编辑而非全量重写**（Roam append 语义）—— 段落级 keep/update/add，不做 block 级
3. **证据约束**（minimem 原创，超越 Obsidian）—— 每段标注 evidence_ids

### 砍掉的能力（明确不做）
- Block Reference `((uid))` —— block 颗粒度太细
- 内容嵌入 `![[page]]` —— 复用靠 SQL 查询
- 图谱可视化 —— 给人看的
- Dataview 查询语言 —— minimem 自己是 DB
- 悬空链接检测 / 页面重命名迁移 —— 等有链接数据再说

## 7 项 TODO

### P0：修根因（4 项）

#### KC00: 切断源头污染
- compile_queue 不再接收 `query_insight` 类型的入队
- 已有的 241 条 query_insight 标记为 skipped
- Inspiration Engine 的产出只进 inspirations 表，不进 compile_queue

#### KC0Y: 修复 lint_finding 死循环
- compiler 不再用 `filter(i => source_type !== 'embedding_backfill')` 跳过 lint_finding
- lint_finding 走专门的修复流程：读页面 → LLM 修复 → 清除旧审计标记 → 更新 lint_status
- 修复失败才保留标记

#### KC0X: subject 聚类编译
- compile_queue 按 subject 分组（同主题的记忆合并处理）
- 每个 subject 独立 LLM 调用，隔离跨项目混杂
- L1 domain 字段填充真实 domain（不再全部 default）

#### KC0Z: 编译参数收紧
- temperature 0.6 → 0.2（知识编译要精确不要创意）
- `split(' — ')` 解析失败的条目跳过，不喂给 LLM
- page_type 白名单：concept / topic / project / skill / product（拒绝"升级路径""方法论"这类哲学化标题）
- LLM 输出后校验：title 不能是问句、不能含"哲学""本质""灵魂"等词

### P1：能力建设（3 项）

#### KC01: 证据约束（精简版）
- knowledgePageCompilePrompt 改造：要求 LLM 输出 `{ sections: [{ content, evidence_ids: ["exp_xxx"] }] }`
- 编译后把 evidence_ids 写入 knowledge_page_evidence 表
- 无 evidence 的段落 confidence 降到 0.3 以下
- 不做 Console 可视化，只做数据层

#### KC02: 链接落库（精简版）
- compiler 后处理：正则提取 `[[slug]]` → 查找目标 page → INSERT knowledge_page_links
- 目标不存在时跳过（不做悬空检测）
- 不做反向链接 API、不做图谱 UI
- 仅保留 `getBacklinks(slug)` 数据层查询能力

#### KC04: 段落级增量编辑
- LLM 输出格式改为 `{ keep_sections: ["## 概述"...], update_sections: [{anchor, new_content}], add_sections: [{after_anchor, content}] }`
- 保留 keep 段落原样，只改 update/add
- 差异分析失败时 fallback 到全量重写
- 版本历史保留每次合并的快照

## 验证标准

1. 重新跑 dream 后，新页面不再出现"多机迁移系统"这种错误描述
2. 审计标记不堆积（同一问题只标一次）
3. knowledge_page_evidence 表有数据
4. knowledge_page_links 表有数据
5. 编译后的页面内容可追溯到原始 L1 记忆
