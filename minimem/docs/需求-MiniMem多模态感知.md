# MiniMem 多模态感知 需求单

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-005 |
| **标题** | 多模态感知层：支持图片/URL/文件输入，文本化沉淀为认知记忆 |
| **优先级** | P1（增量能力，不影响核心管线稳定性） |
| **提出日期** | 2026-04-29 |
| **最后更新** | 2026-04-29 |
| **需求类型** | 感知层扩展 |
| **影响范围** | REST API / MCP Server / Perception 层 / LLM Client / 配置系统 |
| **前置需求** | 无硬性前置，当前核心管线已稳定 |

---

## 1. 设计哲学

### 核心原则：多模态输入，纯文本存储

MiniMem 的核心价值是 **认知记忆的语义编译与演化**（Dream → Compile → Knowledge），不是多模态知识库。因此：

- ✅ 支持多模态 **输入**（图片、URL、文件）
- ✅ 在感知层将多模态内容 **转换为高质量文本**
- ✅ 转换后的文本进入现有 `ingestMemory()` 14 步流水线，**零侵入核心管线**
- ❌ 不做原生多模态存储（不存图片 embedding、不存原始二进制）
- ❌ 不做 CLIP 向量空间（与文本 embedding 空间不统一，复杂度暴增）

### 类比

```
人类感知：
  眼睛看到图片 → 视觉皮层转为概念/语义 → 海马体存储语义记忆 → 睡眠中整理

MiniMem：
  Preprocessor 接收图片 → Vision LLM 转为文本描述 → ingestMemory() 存储 → Dream 中编译
```

---

## 2. 架构设计

### 2.1 Perception Preprocessor（感知前置转换器）

在现有 `ingestMemory()` 之前插入一个可扩展的前置转换层：

```
[多模态输入]
       │
       ▼
┌─────────────────────────────────────────────┐
│         Perception Preprocessor              │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ InputRouter  │──│ ImagePreprocessor    │  │
│  │             │  │ (Vision LLM → 文本)   │  │
│  │ 根据输入类型 │  ├──────────────────────┤  │
│  │ 路由到对应  │──│ UrlPreprocessor      │  │
│  │ Preprocessor│  │ (fetch + 正文提取)    │  │
│  │             │  ├──────────────────────┤  │
│  │             │──│ FilePreprocessor     │  │
│  │             │  │ (PDF/MD/TXT → 文本)   │  │
│  └─────────────┘  └──────────────────────┘  │
└──────────────────────┬──────────────────────┘
                       │ 输出：纯文本 content
                       ▼
          ┌─────────────────────────┐
          │  ingestMemory() 14步流水线│
          │  (完全不变)              │
          └─────────────────────────┘
```

### 2.2 三种 Preprocessor

| Preprocessor | 输入 | 处理方式 | 输出 |
|--------------|------|----------|------|
| **ImagePreprocessor** | Base64 图片 / 图片 URL | Vision LLM 生成详细描述 | 结构化文本描述 |
| **UrlPreprocessor** | HTTP/HTTPS URL | fetch → Readability 提取正文 → 清洗 | 文章正文文本 |
| **FilePreprocessor** | 文件路径（PDF/MD/TXT/DOCX） | 解析器提取文本 → 分块（如超长） | 纯文本内容 |

### 2.3 数据流详解

#### 图片输入

```
用户: add_memory(image: "base64...", context: "团队白板讨论")
       │
       ▼
ImagePreprocessor:
  1. 调用 Vision LLM (如 qwen-vl-plus)
  2. Prompt: "详细描述这张图片的内容，包括文字、图表、关系..."
  3. 拼接: "[图片描述] {LLM输出}\n[上下文] {context}"
       │
       ▼
ingestMemory(content=拼接文本, content_type='image_import', metadata={original_type:'image'})
       │
       ▼
正常 14 步流水线 → L1 → Dream → L2 Facts → Compile → Knowledge Page
```

#### URL 输入

```
用户: add_memory(url: "https://example.com/k8s-networking.html")
       │
       ▼
UrlPreprocessor:
  1. fetch URL (带 timeout + UA + 重定向跟随)
  2. Readability 算法提取正文（去导航、广告、侧边栏）
  3. HTML → Markdown/纯文本
  4. 截断保护：超过 max_url_content_length 时智能截断
  5. 拼接: "[来源] {url}\n[标题] {title}\n[正文] {body}"
       │
       ▼
ingestMemory(content=拼接文本, content_type='url_import', metadata={source_url, title, fetched_at})
       │
       ▼
正常 14 步流水线 → L1 → Dream → L2 Facts → Compile → Knowledge Page
```

#### 文件输入

```
用户: add_memory(file_path: "/docs/architecture.pdf")
       │
       ▼
FilePreprocessor:
  1. 检测文件类型（PDF/MD/TXT/DOCX）
  2. 调用对应解析器提取文本
  3. 超长内容分块策略:
     - 单块 ≤ max_chunk_size (默认 50KB)
     - 按章节/段落边界分块
     - 每块独立 ingest，共享 batch_id
  4. 拼接: "[文件] {filename}\n[内容] {text}"
       │
       ▼
ingestMemory(content=拼接文本, content_type='file_import', metadata={filename, file_type, chunk_index, batch_id})
       │                    （超长文件 → 多次调用，每块一条 L1）
       ▼
正常 14 步流水线 → L1 → Dream → L2 Facts → Compile → Knowledge Page
                                                         ↑
                                    多个同源 chunks 的 facts 会在 Compile 时
                                    被 topic 聚类合并到同一个 Knowledge Page
```

---

## 3. 接口设计

### 3.1 REST API 扩展

#### `POST /api/v1/memory` 扩展

当前仅接受 `{ content: string }`，扩展为支持多种输入模式：

```typescript
// 模式 1：纯文本（向后兼容，不变）
{ content: string, content_type?: string, metadata?: object }

// 模式 2：URL 输入
{ url: string, context?: string, metadata?: object }

// 模式 3：图片输入（multipart/form-data）
FormData: { image: File, context?: string, metadata?: object }

// 模式 4：图片 URL 输入
{ image_url: string, context?: string, metadata?: object }

// 模式 5：文件输入（multipart/form-data）
FormData: { file: File, context?: string, metadata?: object }
```

#### 新增 `POST /api/v1/memory/import-url`

独立端点，语义更清晰：

```typescript
Request:
{
  url: string;           // 必填：要抓取的 URL
  context?: string;      // 可选：用户补充的上下文
  extract_mode?: 'readability' | 'full' | 'summary';  // 提取模式
}

Response:
{
  success: true;
  experience_id: string;   // 写入的 L1 ID
  title: string;           // 提取的标题
  content_length: number;  // 提取的内容长度
  preview: string;         // 前 200 字预览
}
```

### 3.2 MCP Server Tool 扩展

#### `add_memory` tool 扩展

```typescript
{
  name: 'add_memory',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '文本内容（与 url/image_url 三选一）' },
      url: { type: 'string', description: '知识文章 URL（与 content/image_url 三选一）' },
      image_url: { type: 'string', description: '图片 URL（与 content/url 三选一）' },
      context: { type: 'string', description: '用户补充的上下文说明' },
      content_type: { type: 'string', enum: [...] },
    },
    oneOf: [
      { required: ['content'] },
      { required: ['url'] },
      { required: ['image_url'] },
    ]
  }
}
```

#### 新增 `import_knowledge` tool

专门用于知识导入场景，语义更清晰：

```typescript
{
  name: 'import_knowledge',
  description: '导入外部知识到 MiniMem（支持 URL、文件路径）。内容将通过 Dream 管线自动沉淀为 Knowledge Pages。',
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'URL 或本地文件路径' },
      source_type: { type: 'string', enum: ['url', 'file'], description: '来源类型' },
      context: { type: 'string', description: '为什么要导入这个知识？相关上下文' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签，辅助后续编译归类' },
    },
    required: ['source', 'source_type']
  }
}
```

---

## 4. content_type 枚举扩展

当前值：`conversation | event | reflection | decision | note | import`

扩展为：

| content_type | 来源 | 说明 |
|--------------|------|------|
| `conversation` | Agent 对话 | 不变 |
| `event` | 事件记录 | 不变 |
| `reflection` | 反思 | 不变 |
| `decision` | 决策 | 不变 |
| `note` | 笔记 | 不变 |
| `import` | 通用导入 | 不变（向后兼容） |
| **`url_import`** | URL 抓取 | 新增：从 URL 提取的文章 |
| **`image_import`** | 图片描述 | 新增：Vision LLM 对图片的描述 |
| **`file_import`** | 文件解析 | 新增：从文件提取的文本 |

---

## 5. LLM 配置扩展

### 5.1 新增 Vision Model 配置

```toml
[llm.models]
heavy = "..."     # 不变
medium = "..."    # 不变  
light = "..."     # 不变
vision = "qwen-vl-plus"  # 新增：Vision 模型（仅 ImagePreprocessor 使用）

[llm.vision]
enabled = true
max_image_size_mb = 10       # 单张图片最大 10MB
supported_formats = ["jpg", "jpeg", "png", "gif", "webp"]
description_max_tokens = 2000  # 图片描述最大 token 数
```

### 5.2 LLM Client 扩展

`ChatMessage` 接口需要支持 Vision 调用时的 content parts 格式：

```typescript
// 现有（不变）
interface ChatMessage {
  role: string;
  content: string;
}

// 新增：Vision 专用消息类型
interface VisionChatMessage {
  role: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
}

// LLMClient 新增方法
class LLMClient {
  // 现有方法不变
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  
  // 新增：Vision 调用
  async visionChat(messages: VisionChatMessage[], options?: ChatOptions): Promise<string>;
}
```

---

## 6. URL 抓取模块设计

### 6.1 技术选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| `@mozilla/readability` + `jsdom` | 业界标准、效果好 | 依赖较重 | ✅ 主选 |
| 正则/cheerio 手写 | 轻量 | 效果差、维护难 | ❌ |
| Jina Reader API | 无需维护 | 外部依赖、延迟 | 备选 |

### 6.2 抓取策略

```typescript
interface UrlFetchOptions {
  timeout: number;            // 默认 30s
  maxContentLength: number;   // 默认 5MB HTML
  maxOutputLength: number;    // 提取后最大 100KB 文本
  followRedirects: number;    // 最多跟随 3 次重定向
  userAgent: string;          // 标准 UA
  extractMode: 'readability' | 'full' | 'summary';
}
```

### 6.3 异常处理

| 场景 | 处理方式 |
|------|----------|
| URL 无法访问（4xx/5xx） | 返回错误，不写入 L1 |
| 抓取超时 | 返回错误，不写入 L1 |
| 内容为空（JS 渲染页面） | 返回警告，提示 URL 可能需要浏览器渲染 |
| 内容超长 | 智能截断到 max_output_length，保留开头和结尾 |
| 非文本内容（PDF URL） | 检测 Content-Type，走 FilePreprocessor |

---

## 7. 文件解析模块设计

### 7.1 支持的文件格式

| 格式 | 解析方案 | 优先级 |
|------|----------|--------|
| `.md` / `.txt` | 直接读取 | P0（最简单） |
| `.pdf` | `pdf-parse` 或 `pdfjs-dist` | P1 |
| `.docx` | `mammoth` | P2 |
| `.html` | `@mozilla/readability` 复用 | P1 |

### 7.2 分块策略

当文件内容超过 `max_chunk_size`（默认 50KB / ~12000 tokens）时：

1. **优先按结构分块**：Markdown 按 `##` 标题分块，PDF 按页/章节分块
2. **次选按段落分块**：以双换行为分界
3. **保底按 token 数分块**：硬切到 max_chunk_size，保留 200 token 重叠

每个 chunk 写入一条 L1 Experience，共享同一个 `batch_id`。Dream 编译时，同 batch_id 的 facts 天然会被 topic 聚类到一起。

---

## 8. 配置扩展

```toml
# config.default.toml 新增部分

[perception.multimodal]
enabled = true    # 总开关

[perception.multimodal.image]
enabled = true
max_size_mb = 10
supported_formats = ["jpg", "jpeg", "png", "gif", "webp"]
vision_model = "qwen-vl-plus"         # 可覆盖 llm.models.vision
description_prompt = "default"         # 或自定义 prompt 模板名

[perception.multimodal.url]
enabled = true
timeout_seconds = 30
max_html_size_mb = 5
max_output_length = 100000            # 提取后最大字符数
extract_mode = "readability"           # readability | full | summary
user_agent = "MiniMem/1.0 (Knowledge Import)"
follow_redirects = 3

[perception.multimodal.file]
enabled = true
max_file_size_mb = 50
supported_formats = ["md", "txt", "pdf", "docx", "html"]
max_chunk_size = 50000                 # 单块最大字符数
chunk_overlap = 200                    # 块间重叠 token 数
```

---

## 9. 安全与边界

### 9.1 输入验证

| 检查项 | 规则 | 拒绝时行为 |
|--------|------|-----------|
| 图片大小 | ≤ max_size_mb | 400 Bad Request |
| 图片格式 | 在 supported_formats 中 | 400 Bad Request |
| URL 格式 | 合法 HTTP/HTTPS | 400 Bad Request |
| URL 域名 | 不在黑名单中（可配置） | 403 Forbidden |
| 文件大小 | ≤ max_file_size_mb | 400 Bad Request |
| 文件格式 | 在 supported_formats 中 | 400 Bad Request |
| 文件路径 | 不允许路径穿越（`..`） | 403 Forbidden |

### 9.2 SSRF 防护（URL 抓取）

```typescript
// URL 安全检查
function validateUrl(url: string): boolean {
  const parsed = new URL(url);
  // 禁止内网地址
  if (isPrivateIP(parsed.hostname)) return false;
  // 禁止非 HTTP(S) 协议
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  // 禁止已知危险端口
  if (DANGEROUS_PORTS.includes(parsed.port)) return false;
  // 域名黑名单检查
  if (BLOCKED_DOMAINS.includes(parsed.hostname)) return false;
  return true;
}
```

### 9.3 资源限制

| 资源 | 限制 | 理由 |
|------|------|------|
| Vision LLM 调用频率 | ≤ 10 次/分钟 | 避免 API 费用失控 |
| URL 抓取并发 | ≤ 3 个同时 | 避免被目标站封 IP |
| 文件解析内存 | 单文件 ≤ 200MB RSS | 防止 OOM |
| 单次 batch import | ≤ 20 个 chunks | 避免一次产生过多 L1 |

---

## 10. 不做什么（明确边界）

| 不做的事 | 理由 |
|----------|------|
| ❌ 存储原始图片/文件 | MiniMem 是记忆引擎，不是文件存储 |
| ❌ 图片 embedding（CLIP） | 与文本 embedding 空间不统一，复杂度暴增 |
| ❌ 实时网页监控 | 超出记忆引擎范畴，属于爬虫系统 |
| ❌ JavaScript 渲染 | 需要 headless browser，太重了 |
| ❌ 视频/音频转文本 | 优先级低，未来可扩展 |
| ❌ OCR（图片中的文字识别） | Vision LLM 自带 OCR 能力，不需要独立 OCR 模块 |

---

## 11. 实施策略

### 分期交付

| 期次 | 内容 | 优先级 | 预计工作量 |
|------|------|--------|-----------|
| **Phase 1** | URL 抓取 + UrlPreprocessor | P0 | 2-3 天 |
| **Phase 2** | 文件解析 + FilePreprocessor（MD/TXT） | P0 | 1-2 天 |
| **Phase 3** | 图片描述 + ImagePreprocessor + Vision LLM | P1 | 2-3 天 |
| **Phase 4** | PDF/DOCX 解析 + 分块策略 | P2 | 2-3 天 |
| **Phase 5** | MCP Tool 扩展 + import_knowledge | P1 | 1 天 |

### 为什么 URL 最优先？

1. **最高频场景**：Agent 使用中最常见的知识导入方式是"给一个 URL"
2. **最低改动成本**：不需要 multipart 中间件、不需要 Vision LLM
3. **立竿见影**：一个 URL 进来，夜间 Dream 后就能看到 Knowledge Page
4. **验证管线**：可以端到端验证 Preprocessor → ingestMemory → Dream → Knowledge 的完整路径

---

## 12. 验收标准

### Phase 1 验收（URL）

- [ ] `POST /api/v1/memory { url: "..." }` 返回成功，L1 写入正确
- [ ] Readability 提取效果：主流网站（GitHub、MDN、Medium）正文提取准确率 > 90%
- [ ] SSRF 防护：内网地址、非 HTTP 协议被拒绝
- [ ] 超时处理：30s 超时正确返回错误
- [ ] 超长内容：>100KB 的文章被正确截断

### Phase 3 验收（图片）

- [ ] `POST /api/v1/memory` (multipart, image) 返回成功
- [ ] Vision LLM 调用正确，图片描述质量可读
- [ ] 图片大小/格式限制正确执行
- [ ] 图片描述文本成功进入 14 步流水线

### 端到端验收

- [ ] URL 导入的文章，经过一次 Dream 后，产生了对应的 Knowledge Page
- [ ] 同一 batch 的多个 chunks，Compile 时被聚类到同一个 Knowledge Page
- [ ] `content_type` 过滤正确：`GET /memory/list?content_type=url_import` 只返回 URL 导入的记忆
