# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)

基于 Claude Code 的长篇网文辅助创作工具，解决 AI 写作中的"遗忘"和"幻觉"问题，支持 200 万字量级连载。

## 核心特性

| 特性 | 说明 |
|------|------|
| **防幻觉三定律** | 大纲即法律 / 设定即物理 / 发明需申报 |
| **滑动窗口上下文** | Token 消耗减少 90%，支持超长连载 |
| **5 维并行审查** | 爽点、一致性、节奏、人设、连贯性 |
| **Strand Weave 节奏控制** | Quest/Fire/Constellation 三线平衡 |
| **实体层级分类** | 核心/支线/装饰 三级权重管理 |
| **Git 原子备份** | 每章自动提交，支持按章回滚 |

## 快速开始

```bash
# 1. 安装
cd your-project && git clone https://github.com/lingfengQAQ/webnovel-writer.git .claude/skills/webnovel-writer

# 2. 初始化项目
/webnovel-init

# 3. 规划大纲
/webnovel-plan 1

# 4. 开始创作
/webnovel-write 1
```

## 命令速查

| 命令 | 说明 |
|------|------|
| `/webnovel-init` | 初始化项目结构 |
| `/webnovel-plan [卷号]` | 生成详细大纲 |
| `/webnovel-write [章号]` | 创作章节 |
| `/webnovel-review [范围]` | 质量审查 |
| `/webnovel-query [关键词]` | 检索设定 |
| `/webnovel-resume` | 恢复中断任务 |

## 标签格式

```xml
<!-- 实体标签 -->
<entity type="角色" name="陆辰" desc="主角" tier="核心"/>

<!-- 技能标签 -->
<skill name="时间回溯" level="1" desc="回到10秒前" cooldown="24小时"/>

<!-- 伏笔标签 -->
<foreshadow content="玉佩发光" tier="支线" target="50"/>
```

详见 `references/tag-specification.md`

## 项目结构

```
.claude/skills/webnovel-writer/
├── agents/       # 5 个审查员
├── commands/     # 6 个命令
├── scripts/      # Python 脚本
├── references/   # 写作指南
└── templates/    # 题材模板
```

## License

GPL v3 - 详见 [LICENSE](LICENSE)

## 致谢

本项目使用 **Claude Code + Gemini CLI + Codex** 配合 Vibe Coding 方式开发。

灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)
