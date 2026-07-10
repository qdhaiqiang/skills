#!/usr/bin/env python3
"""
将 Markdown 周报转换为蓝白主题 HTML 网页。

用法：
  python3 generate_html.py --input 周报.md --title "青岛红创 第 24 周工作展示汇报" --output 报告.html

依赖：
  pip install markdown
"""

import argparse
import re
import markdown
from pathlib import Path


# ============================================================
# 蓝白主题 CSS（embedded, 无外部依赖）
# ============================================================

CSS_STYLE = """
:root {
  --blue-50: #eff6ff;
  --blue-100: #dbeafe;
  --blue-200: #bfdbfe;
  --blue-300: #93c5fd;
  --blue-400: #60a5fa;
  --blue-500: #3b82f6;
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;
  --blue-800: #1e40af;
  --blue-900: #1e3a8a;
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-400: #9ca3af;
  --gray-500: #6b7280;
  --gray-600: #4b5563;
  --gray-700: #374151;
  --gray-800: #1f2937;
  --gray-900: #111827;
  --green-100: #d1fae5;
  --green-600: #059669;
  --green-700: #047857;
  --yellow-100: #fef3c7;
  --yellow-600: #d97706;
  --yellow-700: #b45309;
  --red-100: #fee2e2;
  --red-600: #dc2626;
  --red-700: #b91c1c;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue",
               Helvetica, Arial, sans-serif;
  background: linear-gradient(135deg, var(--blue-50) 0%, var(--blue-100) 100%);
  color: var(--gray-800);
  line-height: 1.7;
  min-height: 100vh;
}

/* ========== 封面 ========== */
.cover {
  background: linear-gradient(135deg, var(--blue-700) 0%, var(--blue-900) 100%);
  color: #fff;
  padding: 80px 24px 60px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.cover::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle at 30% 40%, rgba(255,255,255,0.06) 0%, transparent 50%);
  pointer-events: none;
}
.cover h1 {
  font-size: 2.2em;
  font-weight: 700;
  margin-bottom: 16px;
  letter-spacing: 2px;
  position: relative;
}
.cover .meta {
  font-size: 1em;
  opacity: 0.85;
  position: relative;
  line-height: 2;
}
.cover .meta span {
  display: inline-block;
  margin: 0 12px;
}

/* ========== 内容容器 ========== */
.container {
  max-width: 1200px;
  margin: -40px auto 40px;
  padding: 0 20px;
  position: relative;
}

/* ========== 卡片 ========== */
.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  padding: 36px 40px;
  margin-bottom: 24px;
  transition: box-shadow 0.2s;
}
.card:hover {
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
}

/* ========== 标题层级 ========== */
h2 {
  font-size: 1.5em;
  color: var(--blue-800);
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 3px solid var(--blue-200);
  position: relative;
}
h2::after {
  content: '';
  position: absolute;
  bottom: -3px;
  left: 0;
  width: 60px;
  height: 3px;
  background: var(--blue-500);
  border-radius: 2px;
}
h3 {
  font-size: 1.15em;
  color: var(--blue-700);
  margin: 20px 0 12px;
}
h4 {
  font-size: 1em;
  color: var(--gray-700);
  margin: 16px 0 8px;
}

/* ========== 段落与列表 ========== */
p {
  margin-bottom: 12px;
  color: var(--gray-700);
}
ul, ol {
  margin: 8px 0 16px 24px;
}
li {
  margin-bottom: 6px;
  color: var(--gray-700);
}
li > ul, li > ol {
  margin-bottom: 0;
}

/* ========== 表格 ========== */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 0.92em;
}
thead {
  background: linear-gradient(135deg, var(--blue-600), var(--blue-700));
  color: #fff;
}
th {
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}
td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--gray-200);
  color: var(--gray-700);
}
tbody tr:hover {
  background: var(--blue-50);
  transition: background 0.15s;
}
tbody tr:nth-child(even) {
  background: var(--gray-50);
}
tbody tr:nth-child(even):hover {
  background: var(--blue-50);
}

/* ========== 状态徽章 ========== */
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.82em;
  font-weight: 600;
  white-space: nowrap;
}
.badge-green {
  background: var(--green-100);
  color: var(--green-700);
}
.badge-yellow {
  background: var(--yellow-100);
  color: var(--yellow-700);
}
.badge-red {
  background: var(--red-100);
  color: var(--red-700);
}

/* ========== 代码/内联标记 ========== */
code {
  background: var(--gray-100);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.88em;
  color: var(--gray-800);
}
pre {
  background: var(--gray-900);
  color: #e5e7eb;
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.88em;
  margin: 12px 0;
}

/* ========== 复选框列表 ========== */
.checklist {
  list-style: none;
  margin-left: 0 !important;
}
.checklist li::before {
  content: '☐ ';
  color: var(--blue-500);
  font-weight: bold;
}
.checklist li.checked::before {
  content: '☑ ';
  color: var(--green-600);
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .cover { padding: 48px 16px 40px; }
  .cover h1 { font-size: 1.6em; }
  .card { padding: 24px 16px; }
  table { font-size: 0.82em; }
  th, td { padding: 8px 10px; }
  .container { margin-top: -24px; }
}

/* ========== 打印 ========== */
@media print {
  body { background: #fff; }
  .cover { padding: 40px 24px; break-after: avoid; }
  .card { box-shadow: none; border: 1px solid var(--gray-200); break-inside: avoid; }
  .container { margin-top: 0; }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}

/* ========== 分割线 ========== */
hr {
  border: none;
  border-top: 1px solid var(--gray-200);
  margin: 24px 0;
}

/* ========== 引用 ========== */
blockquote {
  border-left: 4px solid var(--blue-400);
  background: var(--blue-50);
  padding: 12px 20px;
  margin: 12px 0;
  border-radius: 0 8px 8px 0;
  color: var(--gray-700);
}
"""


# ============================================================
# HTML 生成
# ============================================================


def extract_title_from_markdown(md_text: str) -> str:
    """从 Markdown 第一行 # 标题提取标题"""
    for line in md_text.split('\n'):
        line = line.strip()
        if line.startswith('# ') and not line.startswith('## '):
            return line[2:].strip()
    return "工作展示汇报"


def extract_meta_from_markdown(md_text: str) -> dict:
    """提取汇报人和汇报日期"""
    meta = {"reporter": "", "date": ""}
    for line in md_text.split('\n'):
        line = line.strip()
        if '汇报人' in line and '**' in line:
            m = re.search(r'\*\*(.+?)\*\*', line)
            if m:
                meta['reporter'] = m.group(1)
        elif '汇报日期' in line and '**' in line:
            m = re.search(r'\*\*(.+?)\*\*', line)
            if m:
                meta['date'] = m.group(1)
    return meta


def process_badges(html: str) -> str:
    """
    在生成的 HTML 中查找状态标记并替换为带样式的徽章。
    支持 ✅ 🔄 ❌ 🔴 🟡 🟢
    """
    badge_map = {
        '✅': ('badge badge-green', '✅'),
        '🔄': ('badge badge-yellow', '🔄'),
        '❌': ('badge badge-red', '❌'),
        '🔴': ('badge badge-red', '🔴'),
        '🟡': ('badge badge-yellow', '🟡'),
        '🟢': ('badge badge-green', '🟢'),
    }
    for emoji, (cls, label) in badge_map.items():
        html = html.replace(
            f'<td>{emoji}',
            f'<td><span class="{cls}">{label}</span>'
        )
        # Also handle emoji anywhere in text
        html = re.sub(
            re.escape(emoji) + r'(?!(?:[^<]*>|[^>]*<\/a>))',
            f'<span class="{cls}">{label}</span>',
            html
        )
    return html


def process_checkboxes(html: str) -> str:
    """将 - [ ] / - [x] 转换为样式化复选框"""
    html = html.replace('<li>[ ] ', '<li class="checklist">☐ ')
    html = html.replace('<li>[x] ', '<li class="checklist checked">☑ ')
    html = html.replace('<li>☐ ', '<li class="checklist">☐ ')
    html = html.replace('<li>☑ ', '<li class="checklist checked">☑ ')
    return html


def markdown_to_html(md_text: str) -> str:
    """将 Markdown 转换为 HTML"""
    extensions = [
        'markdown.extensions.extra',
        'markdown.extensions.tables',
        'markdown.extensions.fenced_code',
        'markdown.extensions.codehilite',
        'markdown.extensions.nl2br',
        'markdown.extensions.sane_lists',
    ]
    html = markdown.markdown(md_text, extensions=extensions)
    html = process_badges(html)
    html = process_checkboxes(html)
    return html


def generate_html(md_text: str, title: str = None) -> str:
    """生成完整的 HTML 页面"""
    if not title:
        title = extract_title_from_markdown(md_text)

    meta = extract_meta_from_markdown(md_text)

    # 提取封面信息
    reporter = meta.get('reporter', '')
    date = meta.get('date', '')

    # 转换为 HTML 正文
    content_html = markdown_to_html(md_text)

    # 去掉正文中原始的 # 标题（封面已展示）
    # 保留 h2+ 标题
    content_html = re.sub(
        r'<h1>.*?</h1>', '', content_html, count=1
    )

    # 将正文中的 h2 包裹在 card 中
    # Split by h2 sections
    parts = re.split(r'(<h2>.*?</h2>)', content_html)

    card_content = ""
    current_section = ""

    for part in parts:
        if part.startswith('<h2>'):
            # 如果上一个 section 非空，关闭 card
            if current_section.strip():
                card_content += f'<div class="card">{current_section.strip()}</div>\n'
            # 开始新的 section
            current_section = part
        else:
            current_section += part

    # 最后一个 section
    if current_section.strip():
        card_content += f'<div class="card">{current_section.strip()}</div>\n'

    # 如果上面拆分没命中（无 h2），整体包一个 card
    if not card_content.strip():
        card_content = f'<div class="card">{content_html}</div>\n'

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>{CSS_STYLE}</style>
</head>
<body>

<div class="cover">
  <h1>{title}</h1>
  <div class="meta">
    <span>📅 {date}</span>
    <span>👤 {reporter}</span>
  </div>
</div>

<div class="container">
{card_content}
</div>

</body>
</html>"""

    return html


def main():
    parser = argparse.ArgumentParser(description="将 Markdown 周报转换为蓝白主题 HTML")
    parser.add_argument("--input", "-i", required=True, help="输入的 Markdown 文件路径")
    parser.add_argument("--title", "-t", help="HTML 标题（默认从 Markdown 第一行提取）")
    parser.add_argument("--output", "-o", required=True, help="输出的 HTML 文件路径")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        md_text = f.read()

    html = generate_html(md_text, args.title)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    # 提取实际用的标题
    actual_title = args.title or extract_title_from_markdown(md_text)
    print(f"HTML 已生成: {args.output}")
    print(f"标题: {actual_title}")
    print(f"大小: {len(html)} bytes")


if __name__ == "__main__":
    main()
