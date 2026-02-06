# 未跟踪文件归类建议（本地工作区）

更新时间：2026-02-06

## 目标

避免将开发无关目录、临时分析产物、外部仓库误提交到主仓库。

## 分类结果

### A. 本地忽略（local-ignore）

以下目录/文件已加入 `.gitignore`，默认不进入版本控制：

- 外部或并行项目目录：
  - `.sisyphus/`
  - `De-AI-Prompt/`
  - `MuMuAINovel/`
  - `hapi-tool/`
  - `ai-writing-knowledge/`
  - `novel/`
  - `novel-refined/`
- 本地分析与临时产物：
  - `PROJECT_MINDMAP*.md`
  - `webnovel-writer-v5*-architecture.svg`
  - `_v52_*.json`
  - `_v52_*.txt`
  - `claude_inventory.csv`
  - `*_utf8_sample.txt`

### B. 当前保留（current）

- `docs/` 目录下文档（含 lifecycle 与 archive）
- `README.md`、`CLAUDE.md`、`.claude/references/*.md`

### C. 后续可选动作（需人工确认）

- 若 `hapi-tool/`、`MuMuAINovel/` 等目录未来需要纳入本仓库，建议改为 Git Submodule。
- 若 `PROJECT_MINDMAP*.md` 需团队共享，建议迁入 `docs/archive/notes/` 后再手动 track。

## 执行原则

- 默认“宁可忽略，不误提交”。
- 只有明确作为本仓库产出的文件才加入版本控制。
