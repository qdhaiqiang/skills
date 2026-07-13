---
name: rejoin-weekly-report
description: 从本地 rejoin 工具扫描本机所有 Agent（pi、codex、claude）在所有项目上的开发会话日志，自动汇总生成个人周报（Markdown + HTML），支持按天输出工作计划（含工作内容和验收标准）。使用场景：周末/周初需要快速生成周报，或需要从 Agent 开发日志中提取本周工作摘要时。
---

# Rejoin 周报生成器（AI 内容分析版）

从 rejoin 的 SQLite 数据库中直接查询**本机所有 Agent（pi、codex、claude 等）在所有项目上的会话**，按项目归类汇总，**读取每个会话的完整对话内容，由 AI（LLM）提取其中解决的多个问题**，跨会话合并同类主题，生成符合公司周报模板的 Markdown 文档和蓝白主题 HTML 网页。

## 核心能力

与纯启发式方案的区别：

| 旧方案（启发式） | 新方案（AI 分析） |
|---|---|
| 只读标题、first/last prompt | **读取会话完整对话内容** |
| 按标点简单切分"话题" | **AI 理解上下文，提取真实完成的工作** |
| 每个会话只看 1 个摘要 | **一个会话解决多个不相干问题也能全部识别** |
| 不跨会话关联 | **AI 合并跨会话的同类主题** |
| 容易把环境噪音当成工作内容 | **AI 能识别哪些是系统指令、哪些是真实任务** |

## 核心规则（必须遵守）

1. **只运行本 skill 自带的脚本**，不得自行编写新的 Python 脚本、不得遍历 Git 仓库、不得读取 `git log` / commit / PR、不得用其他方式收集数据
2. **数据来源只有 rejoin 的 SQLite 数据库**（默认 `~/.local/share/rejoin/index.db`）+ 关联的会话 JSONL 文件
3. **扫描覆盖本机全部项目和全部 Agent 工具**，不受当前工作目录影响
4. 脚本路径相对于本 SKILL.md 所在目录，即 `{SKILL_DIR}/scripts/`
5. **生成内容必须保守**：只能陈述 rejoin 会话能直接支持的事实，不能把推测内容、git 提交记录、他人工作结果写成当前汇报人的周报结论

## 数据流架构

```
rejoin SQLite DB ──→ Step 1: scan_sessions.py ──→ rejoin_weekly.json
                            │                        （含原始对话内容）
                            ▼
                    Step 1.5: Agent (LLM) 逐会话分析
                            │  读取每个会话的 conversation
                            │  提取多个不相干子话题
                            │  写入 ai_topics、ai_analysis
                            ▼
                    Step 1.6: Agent (LLM) 跨会话合并
                            │  同一项目内合并同类主题
                            │  写入 ai_merged_topics
                            ▼
                    Step 2: generate_report.py ──→ 周报.md
                            │
                            ▼
                    Step 3: Agent 填充模板 ──→ 最终周报.md
                            │
                            ▼
                    Step 4: HTML 生成 ──→ 周报.html
```

## 执行流程（严格按顺序执行）

### 步骤 0：确保 rejoin 在运行

执行以下命令，检查并启动 rejoin：

```bash
# 检查 rejoin 是否在运行，没有则启动
pgrep -f rejoin || rejoin &
```

### 步骤 1：运行扫描脚本（提取 rejoin 数据库中的会话数据 + 原始对话内容）

执行以下命令，将 `{SKILL_DIR}` 替换为 SKILL.md 所在目录的实际路径：

```bash
python3 {SKILL_DIR}/scripts/scan_sessions.py --output rejoin_weekly.json
```

如果用户指定了要排除的项目，加上 `--exclude` 参数：

```bash
python3 {SKILL_DIR}/scripts/scan_sessions.py --output rejoin_weekly.json --exclude 项目名
```

- `--output`：输出 JSON 文件路径（必填）
- `--exclude`：要排除的项目关键字，可多次指定（可选）
- `--since`：起始日期 `YYYY-MM-DD`（可选，默认本周一）
- `--no-messages`：不包含对话内容（仅元数据，可选）
- 脚本直读 `~/.local/share/rejoin/index.db`，无需额外配置
- **脚本会自动读取每个会话的 JSONL 文件**，提取用户消息和助手回复，存入 `conversation` 字段
- pi 会话文件从 `~/.pi/agent/sessions/` 查找，codex 会话从 `~/.codex/sessions/` 读取

输出 JSON 文件结构：

```json
{
  "scan_time": "...",
  "since": "2026-07-06",
  "total_sessions": 42,
  "projects": { ... },
  "sessions": [
    {
      "id": "...",
      "tool": "pi|codex",
      "project": "项目名",
      "title": "会话标题（来自数据库）",
      "summary": "简短摘要（fallback）",
      "session_file_path": "/实际/文件/路径.jsonl",
      "conversation": [
        {"role": "user", "text": "用户提问..."},
        {"role": "assistant", "text": "助手回复..."},
        ...
      ],
      "ai_topics": [],         // ← 将在步骤 1.5 中由 AI 填充
      "ai_analysis": ""         // ← 将在步骤 1.5 中由 AI 填充
    }
  ],
  "ai_merged_topics": []       // ← 将在步骤 1.6 中由 AI 填充
}
```

### 步骤 1.5：AI 逐会话分析（核心——由 Agent 作为 LLM 完成）

**这一步是核心增强**。Agent（你）需要读取 `rejoin_weekly.json` 中每个会话的 `conversation` 字段（包含完整的用户提问和助手回复），**用自己的 LLM 理解能力**分析每个会话中真正完成的工作。

**不要用启发式规则（分句、切标点）来分析**——那正是旧方案的缺点。你应该：

1. 读取 `rejoin_weekly.json`，遍历所有 `sessions`
2. 对于 **`conversation` 不为空**的会话，阅读对话内容，理解上下文
3. 提取该会话中解决的**一个或多个不相干子问题/子任务**
   - 例如：标题是"修改登录页样式"，但对话中同时修复了"数据库连接超时"和"新增导出按钮"
   - 应该提取出 3 个独立子任务
4. 将结果填充到该会话的 `ai_topics` 数组中：
   ```json
   "ai_topics": [
     {"topic": "修改登录页样式——按钮颜色和布局调整", "summary": "将登录按钮改为蓝色，调整表单居中对齐"},
     {"topic": "修复数据库连接超时问题", "summary": "排查连接池配置，将 timeout 从 5s 改为 30s"},
     {"topic": "新增 Excel 导出按钮", "summary": "在列表页顶部添加导出按钮，调用 /api/export 接口"}
   ]
   ```
5. 同时填写 `ai_analysis` 字段，对会话做整体总结
6. 对于 **`conversation` 为空**（无法读取会话文件）的会话，保留原有的 `title` 和 `summary` 作为 fallback，`ai_topics` 保持空数组

**执行方式**：直接在 `rejoin_weekly.json` 中修改对应字段（使用 `edit` 工具或 `write` 覆盖），将分析结果写入。或者输出到新的 JSON 文件 `rejoin_analyzed.json`。

**完成检查标准**：所有 `conversation` 不为空的会话，其 `ai_topics` 都已填充。每个 `ai_topics` 条目应包含 `topic`（标题）和 `summary`（详细说明）。

### 步骤 1.6：AI 跨会话合并同类主题（核心——由 Agent 作为 LLM 完成）

多个会话可能解决同一个问题。Agent（你）需要：

1. 读取步骤 1.5 的输出（所有会话的 `ai_topics` 已填充）
2. **在同一项目内**，检查不同会话的 `ai_topics`，识别指向同一工作的主题
   - 例如：会话 A 的 ai_topics 包含"修复登录页按钮颜色"，会话 B 的 ai_topics 包含"调整登录页 CSS"
   - 它们都指向"登录页样式调整"，应合并为一个主题
3. 将合并结果写入根级 `ai_merged_topics` 数组：
   ```json
   "ai_merged_topics": [
     {
       "project": "customplatform",
       "topic": "登录页 UI 调整",
       "summary": "调整了登录页按钮颜色、表单布局和 CSS 样式，涉及 2 个独立会话",
       "session_ids": ["会话A的ID", "会话B的ID"],
       "source_topics": ["修复登录页按钮颜色", "调整登录页 CSS"]
     },
     {
       "project": "customplatform",
       "topic": "Excel 导出功能",
       "summary": "在列表页新增导出按钮，对接 /api/export 接口",
       "session_ids": ["会话A的ID"],
       "source_topics": ["新增 Excel 导出按钮"]
     }
   ]
   ```
4. 未跨会话的主题也保留（`session_ids` 中只有 1 个 ID）
5. **跨会话合并的标准**：
   - 必须在同一项目内（`project` 相同）
   - 主题的语义高度相关（不仅仅是关键词匹配）
   - 合并时保留最准确的主题描述

**执行方式**：直接在 JSON 文件中修改 `ai_merged_topics` 字段。

**完成检查标准**：`ai_merged_topics` 包含了所有项目的所有识别主题，跨会话主题已正确合并。

### 步骤 2：生成 Markdown 周报

执行以下命令：

```bash
python3 {SKILL_DIR}/scripts/generate_report.py --input rejoin_weekly.json --output 周报.md
```

如果用户指定了汇报人，加上 `--reporter`：

```bash
python3 {SKILL_DIR}/scripts/generate_report.py --input rejoin_weekly.json --output 周报.md --reporter "张三"
```

- `--reporter`：汇报人（可选，默认 `xxx`，未指定时输出文件名中的汇报人部分用 `xxx` 代替）
- `--week`：周数（可选，默认当前周）
- `--title`：汇报标题（可选，默认"青岛红创 第 N 周工作展示汇报"）

**注意**：该脚本会读取 `ai_merged_topics` 数组来生成工作项表格。如果 `ai_merged_topics` 为空，则会退回到使用会话级别的 `title` / `summary`。

### 步骤 3：读取扫描结果并填充报告

1. 读取步骤 1 生成的 `rejoin_weekly.json` 了解所有项目的会话数据 + AI 分析结果
2. 读取步骤 2 生成的 `周报.md` 模板
3. **AI 分析结果已自动体现在报告中**（工作项表格使用 `ai_merged_topics`，项目摘要使用跨会话合并主题）
4. 将填充后的最终报告写入与标题一致的文件名（标题中的空格替换为短线 `-`），文件名末尾附加汇报人名称。
   - 格式：`{标题}-{汇报人}.md`
   - 例如：汇报人是 `张三`，标题是 `青岛红创 第 24 周工作展示汇报`，则写入 `青岛红创-第-24-周工作展示汇报-张三.md`
   - 如果用户未指定汇报人，`generate_report.py` 会默认使用 `xxx`，则写入 `青岛红创-第-24-周工作展示汇报-xxx.md`

填充要点：

**必须覆盖扫描结果中的所有项目**，不要只关注当前所在目录对应的项目。每个项目的关键工作都要体现在报告各模块中。

**摘要必须基于 AI 分析**：步骤 1.5 中 AI 已经提取了每个会话中的子任务，步骤 1.6 已跨会话合并同类主题。这些分析结果应直接用于填充报告。不要在报告中使用原始 prompt 开头几十个字或环境信息。

**内容必须保守且可追溯**：可以在 AI 分析结果基础上做归纳，但所有结论都必须能回指到具体 rejoin 会话；不能凭空补"已完成""负责人是谁""谁支持了什么""价值提升了多少"，更不能把代码库里的 git commit、PR、他人提交记录算进当前汇报人周报。

**如果无法从 rejoin 直接证明**：
- 工作状态写"待确认"
- 完成标准写"需人工补充"
- 责任人、支持方、决策项、指标结果一律要求人工确认后再提交

"下周计划"按天输出，每天包含：
- 工作内容（要做什么、涉及哪些模块）
- 验收标准（怎么叫完成、可验证的结果）

示例格式：

```
| 日期 | 工作内容 | 验收标准 | 负责人 |
|------|----------|----------|--------|
| 周一 | 定制下单—面料列表接口对接 | 面料数据从后端加载，支持筛选搜索 | 张三 |
| 周二 | 购物车—CRUD 接口对接 | 增删改查、批量提交均正常 | 张三 |
| 周三 | 管理中心—门店信息接口对接 | 门店资料可查看和编辑 | 李四 |
| ... | ... | ... | ... |
```

### 步骤 4：生成 HTML

使用本 skill 自带的 HTML 生成脚本，将最终 Markdown 转换为蓝白主题 HTML：

```bash
python3 {SKILL_DIR}/scripts/generate_html.py \
  --input 最终周报.md \
  --output 青岛红创-第-24-周工作展示汇报.html
```

如果 Markdown 文件第一行是 `# 标题`，`--title` 参数可省略。如需自定义标题：

```bash
python3 {SKILL_DIR}/scripts/generate_html.py \
  --input 最终周报.md \
  --title "青岛红创 第 24 周工作展示汇报" \
  --output 青岛红创-第-24-周工作展示汇报.html
```

**命名规则**：输出文件名必须与报告标题完全一致（标题中的空格替换为短线 `-`），例如标题是 `青岛红创 第 24 周工作展示汇报`，则输出 `青岛红创-第-24-周工作展示汇报.html`。

脚本内置要求：
- 页面内容区域最大宽度 1200px，居中对齐
- 蓝白主题（blue-50 ~ blue-900），白色卡片式布局，蓝色渐变封面
- 表格：蓝灰色表头，悬停高亮
- 状态徽章（✅ 🔄 ❌ 🔴 🟡 🟢 自动转换为彩色徽章）
- 响应式 + 打印友好
- HTML `<title>`、封面主标题、输出文件名三者完全一致

## 周报模板（8 个模块，填充时参考）

生成的报告包含 8 个标准模块：
1. 目标与背景
2. 完成情况（表格）
3. 过程证据
4. AI 协作
5. 价值与指标
6. 风险与问题
7. 下周计划（按天输出，含工作内容和验收标准）
8. 复盘与自检

## 注意事项

- 脚本只做数据提取和初步归类，**不**做 AI 内容分析。**AI 分析（步骤 1.5 和 1.6）由 Agent（你）作为 LLM 完成**
- 目标、风险、下周计划（按天）等需要人工判断的内容，Agent 只能给出基于 rejoin 的候选草稿；**不能把推断内容直接写成最终事实**
- **下周计划必须按天列出**，未排满 5 天时说明剩余天数安排
- rejoin 服务需要在运行时保持数据库更新（正常启动即可，脚本直读 SQLite 不依赖 API）。**Agent 生成周报时必须先检查 rejoin 是否在运行，未运行则执行 `rejoin` 启动。**
- **扫描脚本直读全局 SQLite 数据库，返回本机所有 Agent 在所有项目上的全部会话。Agent 填充报告时必须覆盖所有项目，不受当前工作目录影响。**
- **严禁把 git 仓库中的 commit、PR、代码修改历史当成周报数据源。** 本 skill 的唯一数据源是本地 rejoin SQLite + 会话 JSONL 文件。
- rejoin 对 AI 最友好，rejoin-tui 是交互式 TUI 界面不适合 AI 调用。扫描脚本直接用 SQLite 读取是最佳方式。
- **AI 分析的技巧**：读取 `conversation` 时，重点关注用户消息（`role: "user"`）中的提问/需求，以及助手回复（`role: "assistant"`）中的最终结论和交付物描述，跳过推理过程和工具调用细节。
