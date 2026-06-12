/**
 * 外部感知 Pipeline 种子数据
 * 创建一条 Demo Pipeline：RSS 抓取 → LLM 分析 → 写入记忆
 * 
 * 使用方式：
 *   npx tsx server/seeds/seed-perception-pipeline.ts
 */

const CONSOLE_API = 'http://127.0.0.1:3080';

const demoPipeline = {
  name: '外部感知 · Hacker News 洞察',
  description: '每 2 小时抓取 Hacker News 前沿内容，LLM 提取技术洞察，写入记忆作为灵感来源',
  tags: ['外部感知', 'RSS', '技术前沿'],
  schedule_type: 'cron',
  schedule_cron: '0 */2 * * *',  // 每 2 小时一次
  variables: {},
  default_llm: {
    model: 'qwen-plus',
    temperature: 0.7,
    max_tokens: 4096,
  },
  nodes: [
    {
      id: 'rss-source',
      type: 'rss-fetch',
      label: 'Hacker News RSS',
      position: { x: 100, y: 200 },
      config: {
        url: 'https://hnrss.org/best?count=15',
        limit: 10,
        since_hours: 4,  // 只取最近 4 小时
        include_content: false,
      },
    },
    {
      id: 'analyze',
      type: 'llm-chat',
      label: 'LLM 分析洞察',
      position: { x: 400, y: 200 },
      config: {
        system_prompt: `你是一位技术趋势分析师。你的任务是从 Hacker News 热门文章中提取与以下领域相关的技术洞察：
- AI/LLM/Agent 架构
- 开发者工具
- 系统设计 / SRE
- 创业/产品思考

要求：
1. 只关注真正有价值的内容，忽略水文
2. 用中文输出
3. 每篇有价值的文章提取一条洞察（一句话概述 + 为什么值得关注）
4. 如果没有值得关注的内容，直接输出 "无显著洞察"
5. 最终输出格式：
---
## 技术前沿扫描 ({{now}})

{{逐条洞察}}

---
来源: Hacker News Best`,
        user_prompt: `以下是最新 Hacker News 热门文章：

{{#each input}}
- **{{this.title}}** ({{this.link}})
  摘要: {{this.summary}}
{{/each}}

请分析以上内容，提取技术洞察。`,
      },
    },
    {
      id: 'check-value',
      type: 'llm-judge',
      label: '判断是否有价值',
      position: { x: 700, y: 200 },
      config: {
        question: '以下内容是否包含有价值的技术洞察？（如果只是"无显著洞察"则判定为 false）',
        threshold: 0.6,
      },
    },
    {
      id: 'write-memory',
      type: 'output-minimem',
      label: '写入记忆',
      position: { x: 1000, y: 150 },
      config: {
        source: 'perception:hacker-news',
        content_type: 'insight',
        importance: 0.6,
        tags: '外部感知,技术前沿,HackerNews',
      },
    },
    {
      id: 'log-skip',
      type: 'output-console',
      label: '记录跳过',
      position: { x: 1000, y: 300 },
      config: {
        message: '本次扫描未发现显著洞察，跳过写入。',
      },
    },
  ],
  edges: [
    {
      id: 'e1',
      source_node: 'rss-source',
      source_port: 'out',
      target_node: 'analyze',
      target_port: 'in',
    },
    {
      id: 'e2',
      source_node: 'analyze',
      source_port: 'out',
      target_node: 'check-value',
      target_port: 'in',
    },
    {
      id: 'e3',
      source_node: 'check-value',
      source_port: 'yes',
      target_node: 'write-memory',
      target_port: 'in',
    },
    {
      id: 'e4',
      source_node: 'check-value',
      source_port: 'no',
      target_node: 'log-skip',
      target_port: 'in',
    },
  ],
};

async function main() {
  console.log('🔭 创建外部感知 Demo Pipeline ...\n');

  const resp = await fetch(`${CONSOLE_API}/api/pipelines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demoPipeline),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    console.error('❌ 创建失败:', err);
    process.exit(1);
  }

  const pipeline = await resp.json();
  console.log('✅ Pipeline 创建成功!');
  console.log(`   ID: ${pipeline.id}`);
  console.log(`   名称: ${pipeline.name}`);
  console.log(`   调度: ${pipeline.schedule_cron} (${pipeline.schedule_type})`);
  console.log('');
  console.log('📋 节点:');
  for (const node of pipeline.nodes) {
    console.log(`   - [${node.type}] ${node.label}`);
  }
  console.log('');
  console.log(`🚀 手动触发运行: curl -X POST ${CONSOLE_API}/api/pipelines/${pipeline.id}/run`);
  console.log('');

  // 询问是否立即运行
  console.log('⏳ 立即触发一次运行 ...\n');

  const runResp = await fetch(`${CONSOLE_API}/api/pipelines/${pipeline.id}/run`, {
    method: 'POST',
  });

  if (!runResp.ok) {
    const err = await runResp.json().catch(() => ({ error: runResp.statusText }));
    console.error('❌ 运行失败:', err);
    process.exit(1);
  }

  const result = await runResp.json();
  console.log(`✅ 运行完成!`);
  console.log(`   状态: ${result.status}`);
  console.log(`   耗时: ${result.durationMs}ms`);
  console.log('');
  console.log('📊 节点执行结果:');
  for (const nr of result.nodeResults) {
    const icon = nr.status === 'success' ? '✅' : nr.status === 'skipped' ? '⏭️' : '❌';
    console.log(`   ${icon} [${nr.nodeType}] ${nr.nodeLabel} — ${nr.status} (${nr.durationMs || 0}ms)`);
    if (nr.error) {
      console.log(`      错误: ${nr.error}`);
    }
    if (nr.llmUsage) {
      console.log(`      LLM: ${nr.llmUsage.model} (${nr.llmUsage.prompt_tokens}+${nr.llmUsage.completion_tokens} tokens)`);
    }
  }
}

main().catch(console.error);
