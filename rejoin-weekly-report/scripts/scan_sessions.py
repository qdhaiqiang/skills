#!/usr/bin/env python3
"""
扫描 rejoin 的 SQLite 数据库，提取所有 Agent 会话，按项目归类。
直接读取 rejoin 的 index.db，不依赖 HTTP API。
"""

import argparse
import json
import sqlite3
import re
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict


def get_week_start() -> str:
    """返回本周一的日期字符串"""
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    return monday.strftime("%Y-%m-%d")


def normalize_project(cwd: str) -> str:
    """将 cwd 路径归类为项目名"""
    if not cwd:
        return "unknown"

    mapping = [
        ("customplatform", "customplatform"),
        ("chutian-scada", "chutian-scada"),
        ("chutian-batch", "chutian-batch"),
        ("zhongshi_main", "zhongshi_main"),
        ("zhongshi", "zhongshi"),
        ("hc_lims", "hc_lims"),
        ("hcweb", "hc_lims"),
        ("ai_lifeguide", "ai_lifeguide"),
        ("front_backend_template", "front_backend_template"),
        ("skills", "skills"),
        ("Pixelle-Video", "Pixelle-Video"),
        ("zuoruan", "zuoruan"),
        ("gastown", "gastown"),
        ("Codex/", "codex_sessions"),
    ]

    for keyword, name in mapping:
        if keyword in cwd:
            return name

    # Shorten home path
    home = str(Path.home())
    if cwd.startswith(home):
        cwd = "~" + cwd[len(home):]

    return cwd


def scan_sessions(db_path: str, exclude: list[str], since: str) -> list[dict]:
    """从 rejoin 数据库中读取会话列表"""
    if not Path(db_path).exists():
        raise FileNotFoundError(f"rejoin 数据库不存在: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    query = """
        SELECT s.id, s.tool, s.cwd, s.started_at, s.last_activity,
               s.message_count, s.tool_call_count, s.model,
               s.first_prompt, s.last_prompt, s.codex_summary,
               t.title as ai_title
        FROM sessions s
        LEFT JOIN titles t ON t.session_id = s.id
        WHERE s.last_activity >= :since
        ORDER BY s.last_activity DESC
    """

    rows = conn.execute(query, {"since": since}).fetchall()
    conn.close()

    sessions = []
    for r in rows:
        d = dict(r)
        cwd = d.get("cwd") or ""
        project = normalize_project(cwd)

        # 检查是否需要排除
        excluded = False
        for exc in exclude:
            if exc.lower() in cwd.lower() or exc.lower() in project.lower():
                excluded = True
                break
        if excluded:
            continue

        # 提取摘要
        title = d.get("ai_title") or ""
        first_prompt = d.get("first_prompt") or ""
        last_prompt = d.get("last_prompt") or ""

        # 用 first_prompt 的前 300 字符作为摘要
        summary = first_prompt[:300] if first_prompt else (last_prompt[:300] if last_prompt else title[:300])

        sessions.append({
            "id": d["id"],
            "tool": d["tool"],
            "project": project,
            "cwd": cwd,
            "started_at": d.get("started_at"),
            "last_activity": d.get("last_activity"),
            "message_count": d.get("message_count", 0),
            "tool_call_count": d.get("tool_call_count", 0),
            "model": d.get("model"),
            "title": title,
            "summary": summary,
        })

    return sessions


def main():
    default_db = str(Path.home() / ".local" / "share" / "rejoin" / "index.db")

    parser = argparse.ArgumentParser(description="扫描 rejoin Agent 会话")
    parser.add_argument("--output", required=True, help="输出 JSON 文件路径")
    parser.add_argument("--db", default=default_db, help="rejoin 数据库路径")
    parser.add_argument("--exclude", action="append", default=[],
                        help="要排除的项目关键字（可多次指定）")
    parser.add_argument("--since", default=get_week_start(),
                        help="起始日期 YYYY-MM-DD（默认本周一）")
    args = parser.parse_args()

    print(f"扫描 rejoin 数据库: {args.db}")
    print(f"时间范围: {args.since} ~ 今天")
    print(f"排除项目: {args.exclude}")

    sessions = scan_sessions(args.db, args.exclude, args.since)

    # 按项目分组统计
    by_project = defaultdict(list)
    for s in sessions:
        by_project[s["project"]].append(s)

    project_stats = {}
    for proj, items in sorted(by_project.items(), key=lambda x: -len(x[1])):
        project_stats[proj] = {
            "count": len(items),
            "total_messages": sum(s["message_count"] for s in items),
            "tools_used": list(set(s["tool"] for s in items)),
            "top_sessions": [
                {"id": s["id"], "title": s["title"], "summary": s["summary"]}
                for s in items[:5]
            ],
        }

    result = {
        "scan_time": datetime.now().isoformat(),
        "since": args.since,
        "total_sessions": len(sessions),
        "excluded_projects": args.exclude,
        "projects": project_stats,
        "sessions": sessions,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n共 {len(sessions)} 个会话，分布在 {len(project_stats)} 个项目:")
    for proj, stats in sorted(project_stats.items(), key=lambda x: -x[1]["count"]):
        print(f"  {proj}: {stats['count']} sessions")
    print(f"\n结果已保存到: {args.output}")


if __name__ == "__main__":
    main()
