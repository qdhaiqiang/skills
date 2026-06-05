#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const PKG_ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(PKG_ROOT, "skills");
const TARGET_DIR = path.join(os.homedir(), ".agents", "skills");

function usage() {
  console.log(`qdhaiqiang/skills — Agent Skills 安装器

用法:
  npx @qdhaiqiang/skills add <skill-name>    安装指定 skill 到 ~/.agents/skills/
  npx @qdhaiqiang/skills list                 列出所有可用 skill
  npx @qdhaiqiang/skills                      显示此帮助`);
}

function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error("错误：未找到 skills 目录");
    process.exit(1);
  }
  const skills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, "SKILL.md")))
    .map(d => d.name);

  if (skills.length === 0) {
    console.log("暂无可用 skill");
  } else {
    console.log("可用 skill:");
    skills.forEach(s => console.log(`  - ${s}`));
  }
}

function installSkill(name) {
  const src = path.join(SKILLS_DIR, name);
  if (!fs.existsSync(src)) {
    console.error(`错误：skill "${name}" 不存在`);
    console.error("运行 list 查看可用 skill");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    console.error(`错误："${name}" 不是有效的 skill（缺少 SKILL.md）`);
    process.exit(1);
  }

  const dest = path.join(TARGET_DIR, name);
  if (fs.existsSync(dest)) {
    console.log(`skill "${name}" 已存在，覆盖安装...`);
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`✅ skill "${name}" 已安装到 ${dest}`);
}

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "add":
  case "install":
    if (!arg) {
      console.error("错误：请指定 skill 名称");
      usage();
      process.exit(1);
    }
    installSkill(arg);
    break;
  case "list":
  case "ls":
    listSkills();
    break;
  case undefined:
  case "help":
  case "-h":
  case "--help":
    usage();
    break;
  default:
    console.error(`错误：未知命令 "${cmd}"`);
    usage();
    process.exit(1);
}
