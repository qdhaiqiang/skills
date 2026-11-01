#!/usr/bin/env python3
"""
扫描 rejoin 的 SQLite 数据库，提取所有 Agent 会话，按项目归类。
直接读取 rejoin 的 index.db，不依赖 HTTP API。

输出内容：
- 会话元数据（工具、项目、消息数等）
- 会话原始对话内容（用户消息 + 助手关键输出），供后续 AI 分析使用
- 不做启发式话题拆分——话题提取由 Agent（LLM）在后续步骤完成
"""

import argparse
import json
import sqlite3
import re
import os
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from glob import glob
from typing import Optional


def get_week_start() -> str:
    """返回本周一的日期字符串"""
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    return monday.strftime("%Y-%m-%d")


def find_rejoin_db() -> str:
    """跨平台查找 rejoin 数据库路径（macOS / Linux / Windows）"""
    home = Path.home()
    candidates = [
        home / ".local" / "share" / "rejoin" / "index.db",          # macOS / Linux
        home / "AppData" / "Local" / "rejoin" / "index.db",         # Windows (LOCALAPPDATA)
        home / "AppData" / "Roaming" / "rejoin" / "index.db",       # Windows (APPDATA)
    ]
    env = os.environ.get("REJOIN_DB")
    if env:
        candidates.insert(0, Path(env))
    for c in candidates:
        if c.exists():
            return str(c)
    return str(candidates[0])  # 返回默认路径，让上层报出明确的 FileNotFoundError


def find_qoder_db() -> Optional[str]:
    """跨平台查找 Qoder 主数据库路径（macOS / Windows）"""
    home = Path.home()
    candidates = [
        home / "Library" / "Application Support" / "com.qoder.app.stable" / "main.sqlite",  # macOS
        home / "AppData" / "Roaming" / "com.qoder.app.stable" / "main.sqlite",              # Windows
        home / "AppData" / "Local" / "com.qoder.app.stable" / "main.sqlite",                # Windows 备选
    ]
    env = os.environ.get("QODER_DB")
    if env:
        candidates.insert(0, Path(env))
    for c in candidates:
        if c.exists():
            return str(c)
    return None


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


NOISE_PATTERNS = [
    r"^<[^>]+>$",
    r"^#+\s*",
    r"^(cwd|shell|current_date|timezone|filesystem|environment_context)\b",
    r"^(user|assistant|system|developer)\b",
    r"^(你是|you are)\b",
    r"^(工作目录|当前日期|时区|文件系统)\b",
]


def clean_text(text: str) -> str:
    """清理提示词中的标签、代码块和多余空白。"""
    if not text:
        return ""

    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r", "\n")
    text = re.sub(r"\u200b", "", text)
    return text


def is_noise_line(line: str) -> bool:
    """过滤环境信息、角色提示和结构噪音。"""
    if len(line) < 6:
        return True

    for pattern in NOISE_PATTERNS:
        if re.match(pattern, line, flags=re.I):
            return True

    return False


def build_summary(*candidates: str, limit: int = 140) -> str:
    """从多个候选文本中提取更自然的会话摘要（fallback）。"""
    sentences = []

    for candidate in candidates:
        if not candidate:
            continue

        cleaned = clean_text(candidate)
        for raw_line in cleaned.split("\n"):
            line = re.sub(r"\s+", " ", raw_line).strip(" -*\t")
            if not line or is_noise_line(line):
                continue

            parts = re.split(r"(?<=[。！？!?；;])\s+|[。！？!?；;]\s*", line)
            for part in parts:
                part = re.sub(r"\s+", " ", part).strip(" ,.:;，。；：")
                if len(part) < 8 or is_noise_line(part):
                    continue
                sentences.append(part)

        if sentences:
            break

    if not sentences:
        fallback = next((clean_text(c) for c in candidates if c), "")
        fallback = re.sub(r"\s+", " ", fallback).strip()
        return fallback[:limit]

    summary = ""
    for sentence in sentences:
        next_summary = f"{summary}；{sentence}" if summary else sentence
        if len(next_summary) > limit:
            break
        summary = next_summary
        if len(summary) >= 60:
            break

    return summary[:limit]


def build_title(ai_title: str, codex_summary: str, summary: str) -> str:
    """优先使用 AI 标题，否则从摘要中生成更自然的展示标题。"""
    for candidate in (ai_title, codex_summary, summary):
        title = re.sub(r"\s+", " ", clean_text(candidate)).strip(" -:：")
        if len(title) >= 6:
            return title[:80]
    return ""


# ============================================================
# 会话文件读取——提取原始对话内容供 AI 分析
# ============================================================

# 系统上下文前缀，需要跳过
SYSTEM_PREFIXES = [
    "<permissions", "<app-context", "<collaboration", "<apps_instructions",
    "<skills_instructions", "<plugins_instructions", "<recommended",
    "<environment_context", "# AGENTS.md", "# Environment Context",
    "cwd:", "current_date:", "<system",
    "@scripts/", "请使用中文",
    "AGENTS.md", "Filesystem sandboxing",
]


def is_system_context(text: str) -> bool:
    """判断是否为系统上下文（非用户真实提问）"""
    if not text:
        return True
    stripped = text.strip()
    if len(stripped) < 10:
        return True
    for prefix in SYSTEM_PREFIXES:
        if stripped.startswith(prefix):
            return True
    return False


def extract_conversation_codex(lines: list[dict]) -> list[dict]:
    """
    从 codex 会话 JSONL 中提取对话内容。
    返回 [{role: "user"|"assistant", text: str}, ...]
    """
    conversation = []

    for obj in lines:
        t = obj.get("type")

        # 方式1: event_msg 中的 user_message / agent_message
        if t == "event_msg":
            payload = obj.get("payload", {})
            ptype = payload.get("type", "")
            if ptype == "user_message":
                content = payload.get("content")
                if content and isinstance(content, str) and len(content.strip()) > 10:
                    conversation.append({"role": "user", "text": content.strip()})
            elif ptype == "agent_message":
                content = payload.get("content")
                if content and isinstance(content, str) and len(content.strip()) > 10:
                    conversation.append({"role": "assistant", "text": content.strip()})

        # 方式2: response_item 中的 message (input_text / output_text)
        if t == "response_item":
            payload = obj.get("payload", {})
            if payload.get("type") == "message":
                content = payload.get("content", [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            itype = item.get("type", "")
                            text = item.get("text", "")
                            if not text or len(text.strip()) < 10:
                                continue
                            if itype == "input_text" and not is_system_context(text):
                                conversation.append({"role": "user", "text": text.strip()})
                            elif itype == "output_text":
                                conversation.append({"role": "assistant", "text": text.strip()})

    return conversation


def extract_conversation_pi(lines: list[dict]) -> list[dict]:
    """
    从 pi 会话 JSONL 中提取对话内容。
    返回 [{role: "user"|"assistant", text: str}, ...]
    """
    conversation = []

    for obj in lines:
        if obj.get("type") != "message":
            continue
        msg = obj.get("message", {})
        role = msg.get("role", "")
        if role not in ("user", "assistant"):
            continue

        content = msg.get("content", "")
        text = ""

        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text", "")
                    break
                elif isinstance(item, str):
                    text = item
                    break

        if not text or len(text.strip()) < 10:
            continue
        if role == "user" and is_system_context(text):
            continue

        conversation.append({"role": role, "text": text.strip()})

    return conversation


def find_pi_session_file(session_id: str) -> Optional[str]:
    """在 pi 会话目录下搜索指定 ID 的会话文件"""
    pi_dir = Path.home() / ".pi" / "agent" / "sessions"
    if not pi_dir.exists():
        return None
    pattern = f"**/*{session_id}*.jsonl"
    matches = sorted(glob(str(pi_dir / pattern), recursive=True))
    return matches[0] if matches else None


def resolve_session_path(path: str, tool: str, session_id: str) -> Optional[str]:
    """
    解析会话文件的实际路径。
    codex: 直接使用 path
    pi: path 是 agent-sessions:// URI，需在 ~/.pi/agent/sessions/ 下查找
    """
    if not path:
        return None

    if path.startswith("agent-sessions://"):
        return find_pi_session_file(session_id)

    if os.path.exists(path):
        return path

    return None


def read_conversation(path: str, tool: str) -> list[dict]:
    """
    读取会话 JSONL 文件，提取对话内容。
    返回 [{role, text}, ...] 列表。
    """
    if not path or not os.path.exists(path):
        return []

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw_lines = f.readlines()
    except (OSError, IOError):
        return []

    # 解析 JSONL
    parsed = []
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not parsed:
        return []

    if tool == "pi":
        return extract_conversation_pi(parsed)
    elif tool == "codex":
        return extract_conversation_codex(parsed)
    else:
        conv = extract_conversation_pi(parsed)
        if not conv:
            conv = extract_conversation_codex(parsed)
        return conv


def truncate_conversation(conversation: list[dict], max_user_msgs: int = 10,
                          max_total_chars: int = 8000) -> list[dict]:
    """
    截断对话内容到合理大小：
    - 最多保留 max_user_msgs 条用户消息
    - 每条消息最多截断到合理长度
    - 总字符数不超过 max_total_chars
    """
    result = []
    user_count = 0
    total_chars = 0

    for msg in conversation:
        role = msg.get("role", "")
        text = msg.get("text", "")

        if role == "user":
            user_count += 1
            if user_count > max_user_msgs:
                continue

        # 截断过长消息
        if len(text) > 2000:
            text = text[:1000] + "\n\n[...] " + text[-500:]

        if total_chars + len(text) > max_total_chars:
            # 尝试截断当前消息
            remaining = max_total_chars - total_chars
            if remaining > 500:
                text = text[:remaining - 100] + "\n\n[... 截断]"
            else:
                result.append({
                    "role": "truncated",
                    "text": f"[会话过长，后续内容已截断，共 {len(conversation)} 条消息]"
                })
                break

        result.append({"role": role, "text": text})
        total_chars += len(text)

    return result


# ============================================================
# Qoder 会话读取——直接扫描 Qoder 本地 main.sqlite
# ============================================================

def extract_qoder_text(payload_json: str) -> str:
    """从 Qoder 消息的 payload_json 中提取纯文本（parts 中 type=text 的 text 字段）"""
    if not payload_json:
        return ""
    try:
        payload = json.loads(payload_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    parts = payload.get("parts") or []
    texts = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text":
            t = part.get("text", "")
            if t:
                texts.append(t)
    return "\n".join(texts).strip()


def scan_qoder_sessions(exclude: list[str], since: str,
                        include_messages: bool = True) -> list[dict]:
    """扫描 Qoder 本地 SQLite 数据库中的会话（不经 rejoin）"""
    db_path = find_qoder_db()
    if not db_path:
        print("Qoder 数据库未找到，跳过 Qoder 扫描")
        return []

    print(f"扫描 Qoder 数据库: {db_path}")
    since_ms = int(datetime.strptime(since, "%Y-%m-%d").timestamp() * 1000)

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT session_id, title, cwd, model, created_at, updated_at
            FROM chat_sessions
            WHERE updated_at >= :since AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            {"since": since_ms},
        ).fetchall()

        msg_counts = dict(conn.execute(
            "SELECT session_id, count(*) FROM chat_session_messages GROUP BY session_id"
        ).fetchall())

        conversations = {}
        if include_messages and rows:
            ids = [r["session_id"] for r in rows]
            placeholders = ",".join("?" for _ in ids)
            msgs = conn.execute(
                f"""
                SELECT session_id, role, payload_json
                FROM chat_session_messages
                WHERE session_id IN ({placeholders})
                ORDER BY session_id, sequence
                """,
                ids,
            ).fetchall()
            for m in msgs:
                role = m["role"] or ""
                if role not in ("user", "assistant"):
                    continue
                text = extract_qoder_text(m["payload_json"])
                if not text or len(text) < 10:
                    continue
                if role == "user" and is_system_context(text):
                    continue
                conversations.setdefault(m["session_id"], []).append(
                    {"role": role, "text": text})
        conn.close()
    except sqlite3.Error as e:
        print(f"Qoder 数据库读取失败: {e}，跳过 Qoder 扫描")
        return []

    sessions = []
    for r in rows:
        cwd = r["cwd"] or ""
        project = normalize_project(cwd)

        excluded = any(
            exc.lower() in cwd.lower() or exc.lower() in project.lower()
            for exc in exclude
        )
        if excluded:
            continue

        title = re.sub(r"\s+", " ", clean_text(r["title"] or "")).strip()
        summary = build_summary(title)
        conv = conversations.get(r["session_id"], [])

        sessions.append({
            "id": r["session_id"],
            "tool": "qoder",
            "project": project,
            "cwd": cwd,
            "session_file_path": db_path,
            "session_file_exists": True,
            "started_at": datetime.fromtimestamp(r["created_at"] / 1000).isoformat() if r["created_at"] else None,
            "last_activity": datetime.fromtimestamp(r["updated_at"] / 1000).strftime("%Y-%m-%d") if r["updated_at"] else None,
            "message_count": msg_counts.get(r["session_id"], 0),
            "tool_call_count": 0,
            "model": r["model"],
            "title": title[:80],
            "summary": summary,
            "raw_title": title,
            "codex_summary": "",
            "conversation": truncate_conversation(conv),
            "conversation_msg_count": len(conv),
            "ai_topics": [],
            "ai_analysis": "",
        })

    print(f"Qoder: {len(sessions)} 个会话")
    return sessions


# ============================================================
# 扫描逻辑
# ============================================================


def scan_sessions(db_path: str, exclude: list[str], since: str,
                  include_messages: bool = True) -> list[dict]:
    """从 rejoin 数据库中读取会话列表"""
    if not Path(db_path).exists():
        raise FileNotFoundError(f"rejoin 数据库不存在: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    query = """
        SELECT s.id, s.tool, s.cwd, s.path, s.started_at, s.last_activity,
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

        # 提取摘要（DB 层面的 fallback）
        ai_title = d.get("ai_title") or ""
        codex_summary = d.get("codex_summary") or ""
        first_prompt = d.get("first_prompt") or ""
        last_prompt = d.get("last_prompt") or ""
        summary = build_summary(codex_summary, ai_title, first_prompt, last_prompt)
        title = build_title(ai_title, codex_summary, summary)

        session_info = {
            "id": d["id"],
            "tool": d["tool"],
            "project": project,
            "cwd": cwd,
            "session_file_path": "",  # 解析后的实际文件路径
            "started_at": d.get("started_at"),
            "last_activity": d.get("last_activity"),
            "message_count": d.get("message_count", 0),
            "tool_call_count": d.get("tool_call_count", 0),
            "model": d.get("model"),
            "title": title,
            "summary": summary,
            "raw_title": ai_title,
            "codex_summary": codex_summary,
            # 以下字段在后续步骤由 AI 填充
            "ai_topics": [],       # [{topic: "...", summary: "..."}, ...]
            "ai_analysis": "",     # AI 对会话的整体分析
        }

        # 解析会话文件路径
        raw_path = d.get("path") or ""
        resolved = resolve_session_path(raw_path, d["tool"], d["id"])
        if resolved:
            session_info["session_file_path"] = resolved
            session_info["session_file_exists"] = True
        else:
            session_info["session_file_exists"] = False

        # 读取对话内容（供 AI 分析用）
        if include_messages and resolved:
            conversation = read_conversation(resolved, d["tool"])
            session_info["conversation"] = truncate_conversation(conversation)
            session_info["conversation_msg_count"] = len(conversation)
        else:
            session_info["conversation"] = []
            session_info["conversation_msg_count"] = 0

        sessions.append(session_info)

    return sessions


def main():
    default_db = find_rejoin_db()

    parser = argparse.ArgumentParser(
        description="扫描 rejoin Agent 会话（提取原始对话供 AI 分析），并补充 Qoder 本地会话"
    )
    parser.add_argument("--output", required=True, help="输出 JSON 文件路径")
    parser.add_argument("--db", default=default_db, help="rejoin 数据库路径")
    parser.add_argument("--no-qoder", action="store_true",
                        help="跳过 Qoder 会话扫描")
    parser.add_argument("--exclude", action="append", default=[],
                        help="要排除的项目关键字（可多次指定）")
    parser.add_argument("--since", default=get_week_start(),
                        help="起始日期 YYYY-MM-DD（默认本周一）")
    parser.add_argument("--no-messages", action="store_true",
                        help="不包含对话内容（仅元数据）")
    args = parser.parse_args()

    include_messages = not args.no_messages

    print(f"扫描 rejoin 数据库: {args.db}")
    print(f"时间范围: {args.since} ~ 今天")
    print(f"排除项目: {args.exclude}")
    print(f"包含对话内容: {'是' if include_messages else '否'}")

    sessions = scan_sessions(args.db, args.exclude, args.since,
                             include_messages=include_messages)

    if not args.no_qoder:
        sessions.extend(scan_qoder_sessions(args.exclude, args.since,
                                            include_messages=include_messages))

    # 按项目分组统计
    by_project = defaultdict(list)
    for s in sessions:
        by_project[s["project"]].append(s)

    project_stats = {}
    for proj, items in sorted(by_project.items(), key=lambda x: -len(x[1])):
        has_conversation = sum(1 for s in items if s.get("conversation_msg_count", 0) > 0)
        project_stats[proj] = {
            "count": len(items),
            "total_messages": sum(s["message_count"] for s in items),
            "tools_used": list(set(s["tool"] for s in items)),
            "sessions_with_conversation": has_conversation,
            "top_sessions": [
                {
                    "id": s["id"],
                    "tool": s["tool"],
                    "title": s["title"],
                    "summary": s["summary"],
                    "message_count": s["message_count"],
                    "tool_call_count": s["tool_call_count"],
                    "conversation_msg_count": s.get("conversation_msg_count", 0),
                    "session_file_exists": s.get("session_file_exists", False),
                    "last_activity": s["last_activity"],
                }
                for s in items[:5]
            ],
        }

    stats = {
        "sessions_with_conversation": sum(
            1 for s in sessions if s.get("conversation_msg_count", 0) > 0
        ),
        "total_conversation_messages": sum(
            s.get("conversation_msg_count", 0) for s in sessions
        ),
        "sessions_without_file": sum(
            1 for s in sessions if not s.get("session_file_exists", False)
        ),
    }

    result = {
        "scan_time": datetime.now().isoformat(),
        "since": args.since,
        "total_sessions": len(sessions),
        "excluded_projects": args.exclude,
        "stats": stats,
        "projects": project_stats,
        "sessions": sessions,
        # 以下字段在后续步骤由 AI 填充
        "ai_merged_topics": [],  # [{project, topic, summary, session_ids}, ...]
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n共 {len(sessions)} 个会话，分布在 {len(project_stats)} 个项目:")
    for proj, pstats in sorted(project_stats.items(), key=lambda x: -x[1]["count"]):
        conv_info = f"，{pstats['sessions_with_conversation']} 个含对话内容" if pstats['sessions_with_conversation'] else "（无对话文件）"
        print(f"  {proj}: {pstats['count']} 个会话{conv_info}")
    print(f"\n含对话内容的会话: {stats['sessions_with_conversation']}/{len(sessions)}")
    print(f"对话消息总数: {stats['total_conversation_messages']}")
    print(f"无会话文件的: {stats['sessions_without_file']}")
    print(f"\n结果已保存到: {args.output}")
    print(f"\n下一步：Agent 应读取该 JSON 中每个会话的 'conversation' 字段，")
    print(f"用 AI 分析每个会话解决的多个问题，然后合并跨会话的相同主题。")


if __name__ == "__main__":
    main()
