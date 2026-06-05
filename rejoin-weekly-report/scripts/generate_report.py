#!/usr/bin/env python3
"""
根据扫描结果生成 Markdown 周报。
"""

import argparse
import json
import socket
from datetime import datetime
from pathlib import Path


def get_hostname() -> str:
    """获取当前计算机名（去掉 .local 等后缀）"""
    return socket.gethostname().split(".")[0]


WEEKLY_REPORT_TEMPLATE = """# {title}

**汇报人**：{reporter}

**汇报日期**：{date}

**适用对象**：团队周会

**数据来源**：rejoin 工具扫描本地多个 Agent（pi、codex、claude）在多个项目上的开发会话日志（共计 {total_sessions} 个有效会话）

---

## 一、目标与背景

### 本周目标与背景

> 这周为什么做这些事（客户痛点 / 内部目标 / 项目节点），不要只写"做了 X 功能"。

{project_summary}

### 本周最重要的目标

1. **[目标一]**
2. **[目标二]**
3. **[目标三]**

### 判断完成的标准

> 怎么叫完成？由谁确认？看什么结果？

---

## 二、完成情况

### 已完成与未完成工作

> ✅完成 / 🔄部分完成 / ❌未开始  |  "已完成"必须带证据；"未完成"必须写原因和后续动作。

| 工作项 | 状态 | 证据 / 结果 | 备注 |
|--------|------|-------------|------|
{work_items}

---

## 三、过程证据

### 本周证据类型清单

{evidence_types}

> 最少覆盖 2 类不同证据，不要只有一张页面图。推荐组合：页面 + PR、日志 + 会议纪要。

### 证据截图区

> 每张图下面补一句"它证明了什么"。

**证据图 1**（页面效果 / 系统截图）

*[贴图位置]*

> 证明了：

**证据图 2**（PR / 测试 / 构建日志）

*[贴图位置]*

> 证明了：

**证据图 3**（会议纪要 / 客户反馈）

*[贴图位置]*

> 证明了：

---

## 四、AI 协作

### AI 协作总览

| 任务类型 | 使用场景 / 为什么用 AI | 最终结论 |
|----------|------------------------|----------|
{tool_stats}

### 人工审查说明

> 不要只写"用了 AI"。写清楚：输入 → 输出 → 审查 → 采纳 / 拒绝。

### 本次 AI 协作最值得讲的 2 件事

1. **[最关键的一次使用]**
2. **[最能体现人工审查的一次使用]**

---

## 五、价值与指标

| 指标项 | 上周/基准 | 本周结果 | 下周目标 | 说明 |
|--------|-----------|----------|----------|------|
| [指标 1] | [基准值] | [结果值] | [目标值] | [为什么重要] |
| [指标 2] | [基准值] | [结果值] | [目标值] | [为什么重要] |
| [指标 3] | [基准值] | [结果值] | [目标值] | [为什么重要] |

> 尽量写变化而非静态数字。无法量化时用"数量 + 状态"组合。

---

## 六、风险与问题

| 风险 / 问题 | 状态 | 影响 | 缓解动作 | 责任人 / 截止时间 |
|-------------|------|------|----------|-------------------|
| [问题 1] | 🔴打开 | [会影响什么] | [已做什么] | [谁 / 日期] |
| [问题 2] | 🟡缓解中 | [会影响什么] | [已做什么] | [谁 / 日期] |
| [问题 3] | 🟢关闭 | [会影响什么] | [已做什么] | [谁 / 日期] |

> 不要只写"有风险"。必须有状态、影响、动作、责任人。已关闭的问题也可保留 1 条证明闭环。

---

## 七、下周计划

### 下周任务（按天）

| 日期 | 工作内容 | 验收标准 | 负责人 |
|------|----------|----------|--------|
| 周一 | [工作内容] | [怎么叫完成] | [姓名] |
| 周二 | [工作内容] | [怎么叫完成] | [姓名] |
| 周三 | [工作内容] | [怎么叫完成] | [姓名] |
| 周四 | [工作内容] | [怎么叫完成] | [姓名] |
| 周五 | [工作内容] | [怎么叫完成] | [姓名] |

### 需要谁支持

> 数据 owner / 业务 owner / QA / 研发同学

### 需要什么决策

> 需要团队确认的事项

---

## 八、复盘与自检

### 这周做得好的

1. [继续保持的 2-3 点]
2. ...
3. ...

### 这周做得不好的

1. [需要修正的 2-3 点]
2. ...
3. ...

### 下周要改变什么

> 把复盘转成动作：问题 → 原因 → 改进 → 验证

### 提交前自检

- [ ] 目标和背景写清楚了（别人能看懂这周为什么做）
- [ ] 已完成 / 未完成都写了（未完成项有原因和后续动作）
- [ ] 至少包含 2 类不同证据（不要只有一张页面图）
- [ ] AI 协作页写了人工审查过程（输入 → 输出 → 审查 → 采纳/拒绝）
- [ ] 风险标了状态、影响、动作、责任人
- [ ] 下周计划按天列出工作内容、验收标准和负责人
"""


def generate_report(data: dict, reporter: str, week: int, title: str) -> str:
    projects = data.get("projects", {})
    sessions = data.get("sessions", [])
    total = data.get("total_sessions", 0)

    # 项目摘要
    project_lines = []
    for proj, stats in sorted(projects.items(), key=lambda x: -x[1]["count"]):
        project_lines.append(f"- **{proj}**：{stats['count']} 个会话")

    project_summary = "\n".join(project_lines) if project_lines else "（无项目数据）"

    # 工作项提取（从 top sessions 中提取标题作为工作项）
    work_lines = []
    for proj, stats in sorted(projects.items(), key=lambda x: -x[1]["count"]):
        for s in stats.get("top_sessions", [])[:3]:
            title_text = s.get("title") or s.get("summary", "")[:80]
            if title_text and len(title_text) > 5:
                work_lines.append(f"| [{proj}] {title_text[:80]} | 待确认 | 待补充 | 待补充 |")

    if not work_lines:
        work_lines.append("| （请根据扫描数据手动填写） | 待确认 | 待补充 | 待补充 |")
    work_items = "\n".join(work_lines)

    # 证据类型
    evidence_lines = []
    for proj in sorted(projects.keys()):
        evidence_lines.append(f"1. **{proj}** — Agent 会话记录与代码修改历史")
    evidence_types = "\n".join(evidence_lines) if evidence_lines else "1. （请根据实际项目补充）"

    # 工具统计
    tool_stats_lines = []
    tool_counts = {}
    for s in sessions:
        t = s.get("tool", "unknown")
        tool_counts[t] = tool_counts.get(t, 0) + 1

    for tool_name, count in sorted(tool_counts.items(), key=lambda x: -x[1]):
        tool_stats_lines.append(f"| {tool_name} | {count} 个会话 | 待补充 |")
    if not tool_stats_lines:
        tool_stats_lines.append("| - | - | - |")
    tool_stats = "\n".join(tool_stats_lines)

    return WEEKLY_REPORT_TEMPLATE.format(
        title=title,
        reporter=reporter,
        date=datetime.now().strftime("%Y-%m-%d"),
        total_sessions=total,
        project_summary=project_summary,
        work_items=work_items,
        evidence_types=evidence_types,
        tool_stats=tool_stats,
    )


def main():
    parser = argparse.ArgumentParser(description="生成周报 Markdown")
    parser.add_argument("--input", required=True, help="扫描结果 JSON 文件")
    parser.add_argument("--output", required=True, help="输出 Markdown 文件路径")
    parser.add_argument("--reporter", help="汇报人（默认使用本机计算机名）")
    parser.add_argument("--week", type=int, help="周数（默认自动计算）")
    parser.add_argument("--title", help="汇报标题")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    if args.week is None:
        args.week = datetime.now().isocalendar()[1]

    if args.title is None:
        args.title = f"青岛红创 第 {args.week} 周工作展示汇报"

    if args.reporter is None:
        args.reporter = get_hostname()

    report = generate_report(data, args.reporter, args.week, args.title)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"周报已生成: {args.output}")


if __name__ == "__main__":
    main()
