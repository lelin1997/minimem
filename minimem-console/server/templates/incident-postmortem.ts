/**
 * 内置模板：故障复盘助手（SRE 专属）
 * 从记忆中提取故障和 oncall 事件，生成结构化复盘报告
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-incident-postmortem';

export function initIncidentPostmortemTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 故障复盘助手');

  createTemplate({
    id: TEMPLATE_ID,
    name: '故障复盘助手',
    description: '从记忆中提取故障、告警、oncall 事件，按 SRE 最佳实践生成结构化的事后复盘报告（Postmortem），并提炼改进项。',
    tags: ['project', 'report', 'builtin'],
    schedule_type: 'manual',
    nodes: [
      {
        id: 'src_incidents',
        type: 'memory-search',
        label: '搜索故障记忆',
        position: { x: 100, y: 150 },
        config: {
          query: '故障 告警 报警 oncall 宕机 超时 异常 降级 回滚 紧急修复 P0 P1 incident',
          top_k: 50,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_decisions',
        type: 'memory-search',
        label: '搜索处理决策',
        position: { x: 100, y: 350 },
        config: {
          query: '修复方案 根因分析 临时方案 止血 改进措施 自动化',
          top_k: 30,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 250 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '故障', type: 'any' },
          { id: 'in_b', label: '决策', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_postmortem',
        type: 'llm-chat',
        label: 'LLM 生成复盘',
        position: { x: 700, y: 250 },
        config: {
          system_prompt: `你是一位资深 SRE 工程师，熟悉 Google SRE 文化和故障复盘最佳实践。

请基于提供的故障和处理记忆，生成一份标准的故障复盘报告。使用 Markdown 格式。

报告结构：
## 🚨 故障复盘报告

### 故障概览
| 项目 | 内容 |
|------|------|
| 故障标题 | [简洁描述] |
| 严重程度 | P0/P1/P2 |
| 影响范围 | [受影响的服务/用户] |
| 故障时长 | [从发现到恢复] |

### ⏱ 时间线（Timeline）
按时间顺序列出关键事件节点。

### 🔍 根因分析（Root Cause）
- **直接原因**：
- **根本原因**：
- **触发条件**：

### 🛠 处理过程
描述止血和修复的步骤。

### 📊 影响评估
- 业务影响
- 技术影响

### ✅ 改进项（Action Items）
| 优先级 | 改进项 | 类型 | 负责人 | 预期完成 |
|--------|--------|------|--------|----------|
| P0 | ... | 预防/检测/恢复 | TBD | ... |

### 🧠 经验教训
- 做得好的地方
- 需要改进的地方
- 非显而易见的教训

*注：这是无责复盘（Blameless Postmortem），重点是系统改进而非追责。*`,
          user_prompt: '以下是故障相关的记忆和处理决策：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 150 },
        config: {
          title_template: '{{$date}} 故障复盘报告',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1000, y: 350 },
        config: {
          path_template: 'postmortem/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_incidents', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_decisions', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_postmortem', target_port: 'in' },
      { id: 'e4', source_node: 'llm_postmortem', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e5', source_node: 'llm_postmortem', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
