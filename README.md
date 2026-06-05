# Skills

Agent Skills 集合，适用于 pi、Claude Code、Codex 等 AI 编码助手。

## 安装

### npx 一键安装（推荐，所有 Agent 通用）

```bash
# 安装所有 skill
npx skills@latest add qdhaiqiang/skills

# 单独安装某个 skill
npx skills@latest add qdhaiqiang/skills --skill rejoin-weekly-report
```

这会将 skill 安装到 `~/.agents/skills/`，pi、Claude Code、Codex 启动时自动发现并加载。

### pi 用户

```bash
pi install git:github.com/qdhaiqiang/skills
```

## 可用 Skills

### rejoin-weekly-report

从本地 [rejoin](https://github.com/badlogic/rejoin) 工具扫描多个 Agent（pi、codex、claude）在多个项目上的开发会话日志，自动汇总生成个人周报（Markdown + HTML）。

```bash
npx skills@latest add qdhaiqiang/skills --skill rejoin-weekly-report
```

**使用方式**：

1. 确保 rejoin 已安装并在运行
2. 对 Agent 说：**"生成本周周报"** 或 **"帮我汇总这周的开发工作"**
3. Agent 自动调用本 skill，扫描 rejoin 数据库，生成周报

**特性**：
- 直读 rejoin SQLite 数据库，无需 HTTP API
- 自动排除指定项目（默认排除 `chuangke_platform`）
- 按项目归类汇总，生成 8 模块标准周报
- 输出 Markdown + 蓝白主题 HTML

## 目录结构

每个 skill 是一个独立目录，包含 `SKILL.md` 入口文件和配套脚本：

```
├── package.json              # pi 包清单
├── rejoin-weekly-report/
│   ├── SKILL.md              # skill 入口（名称、描述、使用说明）
│   ├── scripts/              # 辅助脚本
│   │   ├── scan_sessions.py
│   │   └── generate_report.py
│   └── references/           # 参考文档
│       └── template.md
└── README.md
```

## 贡献

欢迎提交 PR 添加新的 skill。每个 skill 需遵循以下规范：

1. 目录名与 `SKILL.md` frontmatter 中的 `name` 字段一致（小写，连字符分隔）
2. `SKILL.md` 必须包含 `name` 和 `description` 字段
3. 脚本使用相对路径引用 skill 目录内的资源

## License

MIT
