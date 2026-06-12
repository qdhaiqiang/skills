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

{project_summary}

### 本周最重要的目标

{top_goals}

### 判断完成的标准

{completion_criteria}

---

## 二、完成情况

### 已完成与未完成工作

| 工作项 | 状态 | 证据 / 结果 | 备注 |
|--------|------|-------------|------|
{work_items}

---

## 三、过程证据

### 本周证据类型清单

{evidence_types}

---

## 四、AI 协作

### AI 协作总览

| 任务类型 | 使用场景 / 为什么用 AI | 最终结论 |
|----------|------------------------|----------|
{tool_stats}

### 人工审查说明

{manual_review}

### 本次 AI 协作最值得讲的 2 件事

{notable_ai_cases}

---

## 五、价值与指标

| 指标项 | 上周/基准 | 本周结果 | 下周目标 | 说明 |
|--------|-----------|----------|----------|------|
{value_metrics}

---

## 六、风险与问题

| 风险 / 问题 | 状态 | 影响 | 缓解动作 | 责任人 / 截止时间 |
|-------------|------|------|----------|-------------------|
{risk_items}

---

## 七、下周计划

### 下周任务（按天）

| 日期 | 工作内容 | 验收标准 | 负责人 |
|------|----------|----------|--------|
{next_week_plan}

### 需要谁支持

{support_needed}

### 需要什么决策

{decisions_needed}

---

## 八、复盘与自检

### 这周做得好的

{good_points}

### 这周做得不好的

{bad_points}

### 下周要改变什么

{changes_next_week}

### 提交前自检

- [ ] 目标和背景写清楚了
- [ ] 已完成 / 未完成都写了
- [ ] 至少包含 2 类不同证据
- [ ] AI 协作页写了人工审查过程
- [ ] 风险标了状态、影响、动作、责任人
- [ ] 下周计划按天列出工作内容、验收标准和负责人
"""


def short_text(text: str, limit: int = 48) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def pick_session_label(session: dict, limit: int = 64) -> str:
    return short_text(session.get("title") or session.get("summary") or "未命名会话", limit)


def format_project_summary(projects: dict) -> str:
    lines = []
    for proj, stats in sorted(projects.items(), key=lambda x: -x[1]["count"]):
        tools = " / ".join(sorted(stats.get("tools_used", []))) or "unknown"
        examples = [
            short_text(s.get("summary") or s.get("title", ""), 28)
            for s in stats.get("top_sessions", [])[:2]
            if s.get("summary") or s.get("title")
        ]
        example_text = f"；重点主题：{'；'.join(examples)}" if examples else ""
        lines.append(
            f"- **{proj}**：rejoin 记录到 {stats['count']} 个会话、约 {stats.get('total_messages', 0)} 条消息，涉及工具 {tools}{example_text}"
        )
    return "\n".join(lines) if lines else "（无项目数据）"


def format_top_goals(projects: dict) -> str:
    goals = []
    for proj, stats in sorted(projects.items(), key=lambda x: -x[1]["count"])[:3]:
        top_session = stats.get("top_sessions", [{}])[0]
        goal = pick_session_label(top_session, 72)
        goals.append(f"1. **{proj}**：会话记录主要围绕“{goal}”，是否属于本周核心目标需人工确认。")
    if not goals:
        goals.append("1. **待补充**：根据本周扫描到的核心项目补充目标。")
    return "\n".join(goals)


def format_completion_criteria(projects: dict) -> str:
    lines = []
    lines.append("- rejoin 只能证明“有过哪些会话、讨论了什么主题”，不能单独证明业务完成、代码交付或谁最终确认。")
    for proj, _stats in sorted(projects.items(), key=lambda x: -x[1]["count"])[:3]:
        lines.append(f"- **{proj}**：完成标准请结合真实交付物、验收结果或项目负责人反馈人工补充。")
    if len(lines) == 1:
        lines.append("- 至少需要补充 1 条可验证的结果说明，再作为正式周报提交。")
    return "\n".join(lines)


def format_work_items(projects: dict) -> str:
    lines = []
    seen = set()
    for proj, stats in sorted(projects.items(), key=lambda x: -x[1]["count"]):
        for session in stats.get("top_sessions", [])[:4]:
            label = pick_session_label(session, 64)
            key = (proj, label)
            if key in seen:
                continue
            seen.add(key)
            evidence = f"rejoin 会话：{session.get('message_count', 0)} 条消息 / {session.get('tool_call_count', 0)} 次调用 / {session.get('tool', '-')}"
            remark = short_text(session.get("summary") or session.get("title") or "-", 72)
            lines.append(f"| [{proj}] {label} | 待确认 | {evidence} | {remark} |")
    if not lines:
        lines.append("| （请根据扫描数据手动填写） | 待确认 | 待补充 | 待补充 |")
    return "\n".join(lines)


def format_evidence_types(projects: dict) -> str:
    lines = []
    for index, (proj, stats) in enumerate(sorted(projects.items(), key=lambda x: -x[1]["count"]), start=1):
        tools = " / ".join(sorted(stats.get("tools_used", []))) or "unknown"
        sample = pick_session_label(stats.get("top_sessions", [{}])[0], 56)
        lines.append(
            f"{index}. **{proj}** — rejoin 会话记录 {stats['count']} 个、{stats.get('total_messages', 0)} 条消息，工具覆盖 {tools}；代表性主题：{sample}"
        )
    return "\n".join(lines) if lines else "1. （请根据实际项目补充）"


def format_tool_stats(projects: dict, sessions: list[dict]) -> str:
    lines = []
    tool_counts = {}
    tool_projects = {}
    for session in sessions:
        tool = session.get("tool", "unknown")
        tool_counts[tool] = tool_counts.get(tool, 0) + 1
        tool_projects.setdefault(tool, {})
        project = session.get("project", "unknown")
        tool_projects[tool][project] = tool_projects[tool].get(project, 0) + 1

    for tool_name, count in sorted(tool_counts.items(), key=lambda x: -x[1]):
        project_name = max(tool_projects[tool_name].items(), key=lambda x: x[1])[0]
        conclusion = f"rejoin 显示该工具的会话主要集中在 {project_name}，具体产出需人工复核。"
        lines.append(f"| {tool_name} | {count} 个会话，核心集中在 {project_name} | {conclusion} |")
    if not lines:
        lines.append("| - | - | - |")
    return "\n".join(lines)


def format_manual_review(projects: dict) -> str:
    project_count = len(projects)
    return (
        f"- 已按项目对 {project_count} 个项目的 rejoin 会话做归类，优先采用 AI 标题或整理后的摘要，而不是直接截取原始 prompt 开头。\n"
        "- 本报告只根据本地 rejoin 会话生成，不读取 git commit、PR、代码变更历史；凡是无法从会话直接证明的结论都需要人工复核。"
    )


def format_notable_ai_cases(projects: dict) -> str:
    cases = []
    for index, (proj, stats) in enumerate(sorted(projects.items(), key=lambda x: -x[1]["count"])[:2], start=1):
        session = stats.get("top_sessions", [{}])[0]
        cases.append(
            f"{index}. **{proj}**：{pick_session_label(session, 70)}，这是 rejoin 中可直接看到的一条代表性 AI 会话。"
        )
    if not cases:
        cases.append("1. **待补充**：根据最关键的 AI 协作案例补充说明。")
    return "\n".join(cases)


def format_value_metrics(projects: dict, sessions: list[dict]) -> str:
    project_count = len(projects)
    tool_count = len(set(s.get("tool", "unknown") for s in sessions))
    total_messages = sum(s.get("message_count", 0) for s in sessions)
    return "\n".join([
        f"| 覆盖项目数 | 无固定基准 | {project_count} 个 | 待人工筛选本周应汇报项目 | 这里只统计 rejoin 中出现过的项目数量 |",
        f"| Agent 会话数 | 无固定基准 | {len(sessions)} 个 | 待人工确认哪些属于本周汇报范围 | 这里只统计 rejoin 中扫描到的有效会话数 |",
        f"| 会话消息量 | 无固定基准 | {total_messages} 条 | 继续提升摘要可读性 | 用于衡量会话记录密度，不代表业务产出多少 |",
        f"| 使用工具数 | 无固定基准 | {tool_count} 种 | 保持工具使用可追溯 | 体现本地 rejoin 中记录到的 Agent 覆盖情况 |",
    ])


def format_risk_items(projects: dict, sessions: list[dict], reporter: str) -> str:
    untitled = sum(1 for s in sessions if not s.get("raw_title") and not s.get("title"))
    risks = [
        f"| 仅凭 rejoin 会话难以证明最终交付状态 | 🟡缓解中 | 容易把讨论中的事项误写成已完成工作 | 正式提交前逐条补充结果证据或改成待确认 | {reporter} / 提交前 |",
        f"| 可能混入不属于本次周报范围的项目或会话 | 🟡缓解中 | 会把别人的工作或无关事项写进当前周报 | 提交前按项目和会话主题做人工筛选，只保留本人本周需要汇报的内容 | {reporter} / 提交前 |",
    ]
    if untitled:
        risks.append(
            f"| 仍有 {untitled} 个会话缺少原始标题 | 🔴打开 | 代表性主题可能不够准确 | 后续在会话结束时补写标题或摘要，减少回溯整理成本 | {reporter} / 下周持续 |"
        )
    else:
        risks.append(
            f"| 本周会话标题完整性较好 | 🟢关闭 | 当前无明显标题缺失阻塞 | 继续保持标题与摘要同步整理 | {reporter} / 持续 |"
        )
    return "\n".join(risks)


def format_next_week_plan(projects: dict, reporter: str) -> str:
    weekdays = ["周一", "周二", "周三", "周四", "周五"]
    items = []
    project_entries = sorted(projects.items(), key=lambda x: -x[1]["count"])
    for index, day in enumerate(weekdays):
        if index < len(project_entries):
            proj, stats = project_entries[index]
            session = stats.get("top_sessions", [{}])[0]
            work = pick_session_label(session, 40)
            acceptance = "请按真实排期补充完成标准；rejoin 会话本身无法推断下周承诺"
            items.append(f"| {day} | 候选事项：{proj} / {work} | {acceptance} | {reporter} |")
        else:
            items.append(f"| {day} | 待根据实际排期补充 | 请补充明确任务、负责人和完成标准 | {reporter} |")
    return "\n".join(items)


def format_support_needed(projects: dict) -> str:
    return "- rejoin 不包含团队支持关系，请根据真实协作对象人工补充。"


def format_decisions_needed(projects: dict) -> str:
    return "- rejoin 不包含业务决策结论，请根据本周需要团队确认的事项人工补充。"


def format_good_points(projects: dict) -> str:
    points = [
        "1. rejoin 会话已经按项目聚合，便于从零散记录里回看本周讨论主题。",
        "2. 会话摘要优先采用去噪后的自然语句，可读性比直接截断 prompt 更好。",
        "3. 当前报告只保留会话能直接支撑的内容，降低把无关工作写进周报的风险。",
    ]
    if not projects:
        points[0] = "1. 已完成周报生成链路搭建，后续只需补充真实项目数据。"
    return "\n".join(points)


def format_bad_points() -> str:
    return "\n".join([
        "1. 仅靠 rejoin 会话还不足以证明哪些事项已经真正交付或验收。",
        "2. 部分会话标题质量依赖工具侧生成，仍可能出现信息密度不足的情况。",
        "3. 下周计划、责任人和业务指标不能从会话中自动得出，仍需人工确认。",
    ])


def format_changes_next_week() -> str:
    return (
        "- 继续提升会话标题与摘要质量；正式周报提交前，先从 rejoin 候选事项里做人工筛选，"
        "再补充真实结果、责任人和计划，避免把讨论内容直接当成最终周报结论。"
    )


def generate_report(data: dict, reporter: str, week: int, title: str) -> str:
    projects = data.get("projects", {})
    sessions = data.get("sessions", [])
    total = data.get("total_sessions", 0)

    return WEEKLY_REPORT_TEMPLATE.format(
        title=title,
        reporter=reporter,
        date=datetime.now().strftime("%Y-%m-%d"),
        total_sessions=total,
        project_summary=format_project_summary(projects),
        top_goals=format_top_goals(projects),
        completion_criteria=format_completion_criteria(projects),
        work_items=format_work_items(projects),
        evidence_types=format_evidence_types(projects),
        tool_stats=format_tool_stats(projects, sessions),
        manual_review=format_manual_review(projects),
        notable_ai_cases=format_notable_ai_cases(projects),
        value_metrics=format_value_metrics(projects, sessions),
        risk_items=format_risk_items(projects, sessions, reporter),
        support_needed=format_support_needed(projects),
        decisions_needed=format_decisions_needed(projects),
        good_points=format_good_points(projects),
        bad_points=format_bad_points(),
        changes_next_week=format_changes_next_week(),
        next_week_plan=format_next_week_plan(projects, reporter),
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
