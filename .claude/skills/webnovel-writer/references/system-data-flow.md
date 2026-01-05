# Webnovel Studio 数据链与组件地图

本文件用于快速确认：**每个组件负责什么、读写哪些数据、以及推荐的调用顺序**（避免“文档说法/历史数据/脚本实现”互相打架）。

---

## 1. 目录约定（项目根目录）

- `正文/`：章节文件（支持 `正文/第0001章.md` 或 `正文/第1卷/第001章-标题.md`）
- `大纲/`：卷纲/章纲/场景纲
- `设定集/`：世界观/力量体系/角色卡/物品卡等设定库
- `.webnovel/state.json`：唯一权威状态（角色/伏笔/进度/主角状态/关系/审查记录）
- `.webnovel/workflow_state.json`：工作流断点（用于 `/webnovel-resume`）
- `.webnovel/index.db`：结构化索引（章节/角色/伏笔的 SQLite 索引）
- `.webnovel/archive/*.json`：归档数据（角色/伏笔/审查报告）

---

## 2. 关键脚本职责（输入/输出）

- `init_project.py`：初始化项目结构与模板（生成 `.webnovel/state.json` 等）
- `extract_entities.py`：扫描章节中的 `<entity/>` / `<skill/>` / `<foreshadow/>` 标签 → 写入 `设定集/` + 更新 `state.json`（兼容旧方括号格式）
- `update_state.py`：**原子性**更新 `state.json`（进度/位置/战力/关系/伏笔/审查记录/Strand）
- `structured_index.py`：把章节元数据写入 `.webnovel/index.db`；并从 `state.json` 同步角色/伏笔到索引（用于快速查询/上下文筛选）
- `status_reporter.py`：生成健康报告、伏笔紧急度分析、Strand 分布等
- `archive_manager.py`：归档不活跃角色、已回收伏笔、过旧审查报告（写入 `.webnovel/archive/*.json` 并从 `state.json` 移除）
- `context_manager.py`：生成“滑动窗口”上下文（优先读索引；失败则降级读 `state.json` + 文件遍历）

---

## 3. 每章推荐数据链（写作→索引→设定→状态）

1. 写/保存章节 → `正文/…`
2. `metadata-extractor`（agent）抽取：`title/location/characters/word_count/hash`
3. `structured_index.py --update-chapter ...`（更新 `.webnovel/index.db`）
4. `extract_entities.py --chapter N --auto`（同步 `设定集/` + 更新 `state.json`）
5. `update_state.py --progress N WORDS`（必要时记录位置/战力/Strand/关系/伏笔）
6. `archive_manager.py --auto-check`（可选：自动触发归档，控制 `state.json` 体积）
7. Git 备份（可选）

---

## 4. 伏笔字段规范（避免数据链断裂）

### 4.1 状态字段（统一口径）

- 规范值：`未回收` / `已回收`
- 兼容值（历史/别名）：`待回收` / `进行中` / `active` / `pending` / `resolved`
- 说明：脚本会尽量**自动归一化**到规范值，但写作与手工更新时仍建议统一用规范值。

### 4.2 推荐字段（越全越好）

- 最小可用：`content`, `status`
- 强烈建议：`planted_chapter`, `target_chapter`, `tier`（核心/支线/装饰）
- 可选增强：`location`, `characters`, `resolved_chapter`

### 4.3 紧急度来源（两套，别混淆）

- **分析用**（更精细）：`status_reporter.py --focus urgency`（基于 `tier + target_chapter`）
- **快速提醒**（更粗糙）：`structured_index.py --query-urgent-foreshadowing`（基于“超过 50 章未回收”的阈值）

---

## 5. 常见冲突与已修复点

- 伏笔状态写成“待回收/进行中”导致被过滤：脚本已兼容并建议统一写“未回收”
- 手工 `--add-foreshadowing` 没有埋设/目标章节：`update_state.py` 已自动补 `planted_chapter/target_chapter/tier`
- 归档路径混淆：固定为 `.webnovel/archive/*.json`
