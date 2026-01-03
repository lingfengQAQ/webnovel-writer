# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)

一个基于 Claude Code 的长篇网文辅助创作工具，旨在解决 AI 写作中的“遗忘”、“幻觉”和“逻辑崩坏”问题，支持 200 万字量级的连载管理。

---

## 核心功能

### 1. 长篇连载支持 (Long-Form Support)
- **滑动窗口上下文 (Context Manager)**: 通过 `context_manager.py` 动态加载当前章节所需设定，Token 消耗减少约 90%。
- **结构化索引 (Structured Index)**: 使用 SQLite 存储章节元数据和伏笔，替代不可靠的向量检索，查询速度提升至毫秒级。
- **数据归档 (Auto Archiving)**: 自动归档长期未使用的角色和已回收伏笔，防止状态文件 (`state.json`) 膨胀。

### 2. 质量控制 (Quality Assurance)
- **防幻觉机制**:
  - **大纲校验**: 严格遵循预设大纲。
  - **设定一致性**: 实时比对角色状态（境界、持有物）。
  - **实体申报**: 新增设定必须标记 `[NEW_ENTITY]` 并入库。
- **5 维审查体系**: 内置 5 个专职 Agent（爽点、逻辑、节奏、人设、连贯性）进行并行审查。
- **黄金三章诊断**: 提供 `golden_three_checker.py` 脚本，量化分析开篇质量。

### 3. 工程化保障 (Engineering)
- **Git 原子备份**: 每章创作完成后自动提交 Git Commit，支持按章节回滚。
- **工作流恢复**: 记录每个步骤的执行状态，支持中断后断点续传。
- **安全合规**: 修复了路径遍历等 OWASP Top 10 安全风险。

---

## 快速开始

### 前置要求
- Python 3.8+
- Claude Code CLI
- Git

### 安装与初始化

1. **安装 Skill**:
   ```bash
   cd ~/.claude/skills/
   git clone https://github.com/lingfengQAQ/webnovel-writer.git
   ```

   安装后 Claude Code 会自动加载：
   - 📁 6 个 Agents (高潮点检查、连贯性检查等)
   - ⚡ 6 个 Commands (`/webnovel-init`, `/webnovel-write` 等)
   - 🔧 15+ 个 Python 脚本

2. **初始化项目**:
   ```bash
   /webnovel-init
   ```
   按提示选择题材（如修仙、都市），系统将自动生成目录结构和基础设定文件。

3. **规划大纲**:
   ```bash
   /webnovel-plan 1
   ```
   交互式生成第 1 卷的详细章节大纲。

4. **开始创作**:
   ```bash
   /webnovel-write 1
   ```
   自动加载上下文、生成正文、提取实体、更新状态并备份。

### 常用命令

| 命令 | 说明 |
|------|------|
| `/webnovel-init` | 初始化项目结构和设定集 |
| `/webnovel-plan [卷号]` | 生成卷级详细大纲 |
| `/webnovel-write [章号]` | 创作指定章节（含自动备份） |
| `/webnovel-review [范围]` | 执行质量审查（如 `1-10`） |
| `/webnovel-query [关键词]` | 检索设定集和状态库 |
| `/webnovel-resume` | 恢复意外中断的任务 |

---

## 项目结构

```text
~/.claude/skills/webnovel-writer/
├── agents/               # 5 个审查员 Agents
│   ├── high-point-checker.md
│   ├── consistency-checker.md
│   ├── ooc-checker.md
│   ├── pacing-checker.md
│   └── continuity-checker.md
├── commands/             # 6 个 Slash Commands
│   ├── webnovel-init.md
│   ├── webnovel-plan.md
│   ├── webnovel-write.md
│   ├── webnovel-review.md
│   ├── webnovel-query.md
│   └── webnovel-resume.md
├── scripts/              # 核心 Python 脚本
│   ├── security_utils.py
│   ├── context_manager.py
│   ├── extract_entities.py
│   ├── structured_index.py
│   └── ...
├── references/           # 写作指南与规范
└── templates/            # 题材与金手指模板
```

## 技术实现细节

- **状态管理**: 使用 `state.json` 追踪主角状态、人际关系和伏笔，配合 `update_state.py` 脚本进行原子更新。
- **实体提取**: `extract_entities.py` 通过正则和 NLP 混合模式提取正文中的新设定。
- **节奏控制**: 引入 "Strand Weave" 模式，在 `state.json` 中追踪剧情线（主线/感情/世界观）的分布，防止节奏单调。

---

## 贡献

欢迎提交 PR 改进脚本逻辑或补充新的题材模板。

## License

GNU General Public License v3.0

本项目采用 GPL v3 协议开源。任何基于本代码的衍生作品也必须采用 GPL v3 协议开源。

详见 [LICENSE](LICENSE) 文件。
