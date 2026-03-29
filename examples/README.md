# 示例项目

本目录包含 Webnovel Writer 的示例小说项目，可直接用于体验完整写作流程。

## demo-novel（修仙/Cultivation）

一个预设的修仙题材小说项目，包含：

- 完整的 `.webnovel/` 状态（`state.json`、索引等）
- 大纲结构（`大纲/`）：总纲、爽点规划
- 设定文档（`设定集/`）：世界观、力量体系、角色卡等
- 空白正文目录（`正文/`）

### 快速体验

```bash
# 1. 将 demo-novel 复制到工作目录
cp -r examples/demo-novel /path/to/my-novel

# 2. 启动写作会话（加载修仙 profile）
python -X utf8 webnovel-writer/scripts/webnovel.py codex session start \
  --profile xianxia \
  --project-root /path/to/my-novel

# 3. 查看索引状态
python -X utf8 webnovel-writer/scripts/webnovel.py codex index status \
  --project-root /path/to/my-novel

# 4. 启动文件监听（可选，自动索引新章节）
python -X utf8 webnovel-writer/scripts/webnovel.py codex index watch \
  --project-root /path/to/my-novel

# 5. 停止会话
python -X utf8 webnovel-writer/scripts/webnovel.py codex session stop \
  --session-id <步骤2返回的session_id>
```

### 可用的 Skill Profiles

| Profile | 题材 | 适用场景 |
|---------|------|----------|
| `battle` | 通用 | 战斗场景、动作描写 |
| `description` | 通用 | 环境描写、人物刻画 |
| `consistency` | 通用 | 一致性检查、设定维护 |
| `xianxia` | 修仙/玄幻 | 境界突破、功法修炼 |
| `urban` | 都市异能 | 身份隐藏、现实交织 |
| `mystery` | 悬疑推理 | 伏笔铺设、线索管理 |
| `apocalypse` | 末世 | 生存压力、资源管理 |
| `romance` | 言情/甜宠 | 感情线推进、心动场景 |

### 注意事项

- demo-novel 目录已加入 `.gitignore`，本地修改不会被 git 追踪
- 请确保已安装所有依赖：`pip install -r webnovel-writer/scripts/requirements.txt`
- Windows 用户请在命令中添加 `-X utf8` 标志
