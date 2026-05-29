---
name: rejoin-weekly-report
description: 从本地 rejoin 工具扫描多个 Agent（pi、codex、claude）在多个项目上的开发会话日志，自动汇总生成个人周报（Markdown + HTML）。使用场景：周末/周初需要快速生成周报，或需要从 Agent 开发日志中提取本周工作摘要时。
---

# Rejoin 周报生成器

从 rejoin 的 SQLite 数据库中直接查询所有 Agent 会话，按项目归类汇总，生成符合公司周报模板的 Markdown 文档和蓝白主题 HTML 网页。

## 工作流程

1. 运行扫描脚本，从 rejoin 数据库中提取会话数据
2. 过滤掉指定项目（默认排除 `chuangke_platform`）
3. 按项目分组、分析会话标题和内容
4. 生成 Markdown 周报，再转换为 HTML

## 使用方式

### 步骤 1：扫描并生成原始数据

```bash
python3 scripts/scan_sessions.py \
  --output /tmp/rejoin_weekly.json \
  --exclude chuangke_platform
```

参数：
- `--output`：输出 JSON 文件路径（必填）
- `--exclude`：要排除的项目名关键字，可多次指定（可选，默认排除 `chuangke_platform`）
- `--since`：起始日期 `YYYY-MM-DD`（可选，默认本周一）
- `--db`：rejoin 数据库路径（可选，默认 `~/.local/share/rejoin/index.db`）

### 步骤 2：生成 Markdown 周报

```bash
python3 scripts/generate_report.py \
  --input /tmp/rejoin_weekly.json \
  --output /path/to/周报.md \
  --reporter "马海强 / 全栈开发工程师" \
  --week 22
```

参数：
- `--input`：步骤 1 输出的 JSON 文件（必填）
- `--output`：输出的 Markdown 文件路径（必填）
- `--reporter`：汇报人姓名/角色（必填）
- `--week`：周数（可选，默认计算当前是第几周）
- `--title`：汇报标题（可选，默认"定制平台开发组 第 N 周工作展示汇报"）
- `--template`：自定义模板文件（可选，默认使用内置模板）

### 步骤 3：生成 HTML（在 Agent 中）

报告生成后，请 Agent 将 Markdown 转换为蓝白主题 HTML：

```
请将 {output}.md 的内容转换为蓝白主题的 HTML 网页，保存为 {output}.html
```

## 周报模板结构

生成的报告包含 8 个标准模块：
1. 目标与背景
2. 完成情况（表格）
3. 过程证据
4. AI 协作
5. 价值与指标
6. 风险与问题
7. 下周计划
8. 复盘与自检

## 注意事项

- 脚本只做数据提取和初步归类，不会自动填充所有模板字段
- 目标、风险、下周计划等需要人工判断的内容，由 Agent 根据扫描结果推断填充
- rejoin 服务需要在运行时保持数据库更新（正常启动即可，脚本直读 SQLite 不依赖 API）
