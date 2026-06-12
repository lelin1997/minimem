# 当前上下文

## 最新进展
- **MCP 连接**：MiniMem MCP Server 恢复正常，已清理僵尸进程（2026-04-29 09:20）
- **[MINIMEM-005] Phase 1–5 完成**  
  - **Phase 1**：手工验证完整链路（URL → SSRF 校验 → Readability 提取 → 清洗截断 → L1 写入 → FTS 可检索），覆盖 GitHub、MDN、Node.js、Hono、TypeScript 等真实 URL，SSRF 防护全面验证（2026-04-29 08:04）  
  - **Phase 2**：FilePreprocessor 实现（路径安全、文件读取、二进制检测、清洗、分块输出）+ chunker.ts（标题/段落分块、硬切+overlap、合并/拆分/限制），REST API AddMemory 可用（2026-04-29 08:22）  
  - **Phase 3**：ImagePreprocessor + Vision LLM（Base64/URL → Vision API → 文本描述），绕过 LLMClient.chat 字符串限制（2026-04-29 08:35）  
  - **Phase 4**：PDF（pdf-parse v2）、DOCX（mammoth 任意类型检测转 Markdown）、HTML 解析支持（2026-04-29 08:54）  
  - **Phase 5**：MCP 工具增强、批量 URL 导入、文档更新完成（2026-04-29 08:54）

## 近期修复与优化
- **Console PipelineList**：运行按钮加 toast 反馈（toast.promise + 成功后跳转运行历史），后端记录正常（2026-04-29 07:32）  
- **LLM 配置切换**：新增腾讯云 Coding Plan（glm-5），config.ts 支持 raw.llm.api_key fallback（2026-04-29 07:14）  
- **Dream 历史时间精度**：服务端支持完整 `YYYY-MM-DD HH:mm:ss`（三级 fallback），前端展示到分钟；修复 Persons.tsx 与 DreamHistory.tsx 缺失配置（2026-04-29 07:07）

## 手动测试收录来源
- SQLite WAL 文档  
- TypeScript Basic Types 手册  
- ModelContextProtocol Servers README  
- Vitest Getting Started 指南  
- Hono Getting Started  
- Node.js Introduction  
- MDN Promise 文档  

## 备注
- 所有阶段功能已闭环，解析、预处理、分块、MCP 调用及批量导入均可用。  
- SSRF 防护与 FTS 检索经多源验证可靠。  