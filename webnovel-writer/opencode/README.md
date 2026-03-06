# OpenCode 兼容层

本文件夹包含 webnovel-writer 的 OpenCode 兼容版本 skills 和 agents。

## 安装配置

### 方式一：复制到 OpenCode skills 目录

```bash
# Linux/macOS
cp -r webnovel-writer/opencode/skills/* ~/.config/opencode/skills/

# 或使用软链接
ln -s "$(pwd)/webnovel-writer/opencode/skills/"* ~/.config/opencode/skills/
```

### 方式二：设置环境变量

在 shell 配置文件（`~/.bashrc` 或 `~/.zshrc`）中添加：

```bash
export OPENCODE_PLUGIN_ROOT="/path/to/webnovel-writer/webnovel-writer/opencode"
```

## Claude Code 与 OpenCode 差异对照

| 项目 | Claude Code | OpenCode |
|------|-------------|----------|
| 插件根目录变量 | `${CLAUDE_PLUGIN_ROOT}` | `${OPENCODE_PLUGIN_ROOT}` |
| 项目目录变量 | `${CLAUDE_PROJECT_DIR}` | `${OPENCODE_PROJECT_DIR:-$PWD}` |
| Skills 位置 | `.claude/skills/` | `.opencode/skills/` 或 `~/.config/opencode/skills/` |
| Agents 位置 | `agents/*.md` | `agents/*.md`（相同） |

## 已转换内容

- `skills/` — 全部 8 个 slash commands，路径变量已更新
- `agents/` — 全部 8 个 checker agents，路径变量已更新

## Python 脚本（共享）

Python CLI（`scripts/webnovel.py`）无需修改 — 使用 `--project-root` 参数而非环境变量。

```bash
# Claude Code 和 OpenCode 使用方式相同
python "${OPENCODE_PLUGIN_ROOT}/scripts/webnovel.py" --project-root ./my-novel where
```

## 使用说明

安装完成后，在 OpenCode 中可以使用以下命令：

```bash
/webnovel-init      # 初始化小说项目
/webnovel-plan      # 规划大纲
/webnovel-write     # 写作章节
/webnovel-review    # 审查章节
/webnovel-query     # 查询项目数据
/webnovel-resume    # 恢复写作进度
/webnovel-learn     # 学习写作风格
/webnovel-dashboard # 启动可视化面板
```
