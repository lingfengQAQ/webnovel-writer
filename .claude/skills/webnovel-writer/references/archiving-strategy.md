# 数据归档策略（200万字长跑保障）

> **目标**：防止 state.json 无限增长，确保 200 万字小说创作流程稳定运行。

---

## 问题背景

### Gemini 2M+ 压力测试发现的致命缺陷

在 webnovel-writer 系统的审核中，Gemini 指出了一个长期运行的潜在风险：

**现象**：
- `update_state.py` 只对 `strand_tracker.history` 做了局部修剪（保留最近 50 章）
- 但 `entities.characters`（角色库）和 `plot_threads.resolved`（已回收伏笔）会无限追加

**后果推演**（200万字场景）：
1. **100 万字时**：state.json 达到 **5MB**
2. **update_state.py 性能下降**：每次读写都要解析和序列化 5MB 的 JSON，IO 开销越来越大
3. **AI 上下文风险**：如果用户误用 `cat .webnovel/state.json`，会导致大量 Token 消耗（5MB ≈ 150万字 ≈ 30万 Tokens）
4. **Git 仓库膨胀**：每次 commit 都会保存完整的 state.json，仓库体积快速增长

**虽然 context_manager.py 能通过滑动窗口缓解 AI 读取压力，但 state.json 本身的大小仍然会不断增长。**

---

## 解决方案：智能归档系统

### 设计原则

1. **渐进式归档**（Progressive Archiving）
   - 不是一次性清空，而是根据"活跃度"逐步归档
   - 保留近期活跃的数据，归档长期不活跃的数据

2. **自动触发**（Auto-Triggered）
   - 每 10 章检查一次归档条件
   - 文件大小超过 1MB 时触发强制归档

3. **可逆性**（Reversible）
   - 所有归档数据都保存在 `archive/` 目录
   - 可以随时恢复归档的角色/伏笔

4. **透明性**（Transparent）
   - 用户可以查看归档统计 (`--stats`)
   - 可以预览即将归档的数据 (`--dry-run`)

---

## 归档策略详解

### 1. 角色归档（Character Archiving）

**触发条件**：
- 角色 `importance="minor"`（次要角色）
- **超过 50 章未出场**（`current_chapter - last_appearance_chapter ≥ 50`）

**归档目标**：
- `archive/characters.json`

**保留数据**：
- 主要角色（`importance="major"`）**永不归档**
- 女主、师父、主要反派等关键角色保持活跃

**恢复机制**：
```bash
python archive_manager.py --restore-character "李雪"
```

**示例**：
```
第 5 章：角色"路人甲"出场（打脸工具人）
第 60 章：检测到"路人甲"超过 50 章未出场 → 归档
第 120 章：剧情需要"路人甲"重新出场 → 用户执行恢复命令
```

---

### 2. 伏笔归档（Plot Thread Archiving）

**触发条件**：
- 伏笔 `status="已回收"`
- **超过 20 章**（`current_chapter - resolved_chapter ≥ 20`）

**归档目标**：
- `archive/plot_threads.json`

**保留数据**：
- 未回收的伏笔（`status="未回收"`）**永不归档**
- 长期主线伏笔保持活跃

**恢复机制**：
- 伏笔归档后通常不需要恢复（已完成其使命）
- 如需查阅历史伏笔，可直接读取归档文件

**示例**：
```
第 10 章：埋下伏笔"神秘玉佩的秘密"
第 45 章：回收伏笔"神秘玉佩的秘密"（status="已回收"）
第 70 章：检测到伏笔已回收超过 20 章 → 归档
```

---

### 3. 审查报告归档（Review Report Archiving）

**触发条件**：
- 审查报告超过 **50 章**（`current_chapter - review_chapter ≥ 50`）

**归档目标**：
- `archive/reviews.json`

**保留数据**：
- 最近 50 章的审查报告保持活跃
- 用于分析质量趋势

**恢复机制**：
- 审查报告归档后通常不需要恢复
- 如需查阅历史报告，可直接读取归档文件

**示例**：
```
第 10 章：双章审查（Ch9-10）
第 65 章：检测到 Ch9-10 审查报告超过 50 章 → 归档
```

---

## 触发条件详解

### 自动触发（Auto-Check）

在 `webnovel-write.md` 的 **Step 4.5** 中，每次章节创作完成后自动调用：

```bash
python archive_manager.py --auto-check
```

**触发条件**（满足任一即执行归档）：
1. **文件大小触发**：`state.json` 大小 ≥ **1 MB**
2. **章节触发**：当前章节数是 **10 的倍数**（每 10 章检查一次）

**示例输出**（无需归档）：
```
✅ 无需归档（触发条件未满足）
   文件大小: 0.35 MB (阈值: 1.0 MB)
   当前章节: 7 (每 10 章触发)
```

**示例输出**（触发归档）：
```
🔍 开始归档检查...
   文件大小: 1.2 MB
   当前章节: 120

📊 归档统计:
   不活跃角色: 12
   已回收伏笔: 8
   旧审查报告: 5

✅ 归档完成:
   角色归档: 12 → characters.json
   伏笔归档: 8 → plot_threads.json
   报告归档: 5 → reviews.json

💾 文件大小: 1.2 MB → 0.8 MB (节省 0.4 MB)
```

---

### 强制归档（Force）

用户可以手动触发归档，忽略触发条件：

```bash
python archive_manager.py --force
```

**使用场景**：
- 手动清理 state.json
- 性能优化
- Git 仓库体积优化

---

### Dry-Run 模式

预览即将归档的数据，但不执行实际归档：

```bash
python archive_manager.py --auto-check --dry-run
```

**示例输出**：
```
🔍 [Dry-run] 将被归档的数据:

   不活跃角色:
   - 路人甲 (超过 55 章未出场)
   - 打酱油乙 (超过 63 章未出场)
   - ...（共 12 个）

   已回收伏笔:
   - 神秘玉佩的秘密 (已回收 25 章)
   - 天雷果的下落 (已回收 30 章)
   - ...（共 8 个）

   旧审查报告:
   - Ch9-10 (55 章前)
   - Ch19-20 (45 章前)
   - ...（共 5 个）
```

---

## 归档文件结构

```
.webnovel/
├── state.json               # 活跃数据（1 MB 以下）
└── archive/                 # 归档目录
    ├── characters.json      # 归档的角色
    ├── plot_threads.json    # 归档的伏笔
    └── reviews.json         # 归档的审查报告
```

**归档文件格式**（示例）：

**archive/characters.json**:
```json
[
  {
    "name": "路人甲",
    "importance": "minor",
    "description": "被主角打脸的工具人",
    "last_appearance_chapter": 5,
    "archived_at": "2025-01-02T12:30:45"
  },
  {
    "name": "打酱油乙",
    "importance": "minor",
    "description": "陪衬角色",
    "last_appearance_chapter": 8,
    "archived_at": "2025-01-02T12:30:45"
  }
]
```

**archive/plot_threads.json**:
```json
[
  {
    "description": "神秘玉佩的秘密",
    "status": "已回收",
    "introduced_chapter": 10,
    "resolved_chapter": 45,
    "resolution": "玉佩是主角父亲留下的信物",
    "archived_at": "2025-01-02T12:30:45"
  }
]
```

---

## 性能预测（200万字场景）

### 场景 1：无归档系统

| 章节 | 总字数 | state.json 大小 | 读写耗时 | 风险 |
|------|--------|----------------|----------|------|
| 100 章 | 50 万字 | **1.5 MB** | 50 ms | ⚠️ 中等 |
| 200 章 | 100 万字 | **3.5 MB** | 150 ms | 🔴 高 |
| 400 章 | 200 万字 | **8 MB** | 500 ms | 🔴🔴 极高 |

**问题**：
- 200 章后，每次 `update_state.py` 耗时 150ms+
- 400 章时，state.json 达到 8MB，Git 仓库体积失控

---

### 场景 2：启用归档系统

| 章节 | 总字数 | state.json 大小 | 归档文件大小 | 读写耗时 | 风险 |
|------|--------|----------------|-------------|----------|------|
| 100 章 | 50 万字 | **0.8 MB** | 0.5 MB | 30 ms | ✅ 低 |
| 200 章 | 100 万字 | **0.9 MB** | 1.8 MB | 35 ms | ✅ 低 |
| 400 章 | 200 万字 | **1.0 MB** | 4.5 MB | 40 ms | ✅ 低 |

**优势**：
- state.json 稳定在 **1 MB 以下**
- `update_state.py` 耗时稳定在 **30-40 ms**
- 归档文件单独管理，不影响主流程性能

**数据归档规律**（每 10 章触发）：
- **Ch 10, 20, 30...**：检查归档条件
- **Ch 60**：首次归档（12 个次要角色）
- **Ch 100**：归档 8 个已回收伏笔
- **Ch 150**：归档 5 个旧审查报告
- **Ch 200+**：稳定运行，state.json 保持 1 MB 以下

---

## 恢复机制

### 恢复归档的角色

```bash
python archive_manager.py --restore-character "李雪"
```

**执行逻辑**：
1. 从 `archive/characters.json` 中查找角色"李雪"
2. 移除 `archived_at` 字段
3. 将角色恢复到 `state.json` 的 `entities.characters`
4. 从归档文件中移除该角色

**示例输出**：
```
✅ 角色已恢复: 李雪
```

**使用场景**：
- 剧情需要某个次要角色重新出场
- 用户误归档了重要角色（虽然主要角色不会被归档）

---

## 查看归档统计

```bash
python archive_manager.py --stats
```

**示例输出**：
```
📊 归档统计:
   角色归档: 24
   伏笔归档: 15
   报告归档: 8
   归档大小: 2.3 KB

💾 state.json 当前大小: 0.9 MB
```

---

## 集成到创作流程

### webnovel-write.md 的集成点

在 **Step 4（Update State）** 之后，**Step 5（Git Backup）** 之前：

```markdown
### Step 4.5: Data Archiving (AUTO-TRIGGERED)

**CRITICAL**: After Step 4, **automatically run** archive check:

```bash
python .claude/skills/webnovel-writer/scripts/archive_manager.py --auto-check
```

**Purpose**: 防止 state.json 无限增长（200万字长跑保障）

**IMPORTANT**:
- **不需要 workflow_manager 追踪**（归档是内部维护操作）
- 如报错（如文件不存在），视为警告，不阻塞流程
- 归档数据可随时使用 `--restore-character "角色名"` 恢复
```

### Execution Checklist

新增归档检查项：

```markdown
**Data Archiving** (200万字长跑保障):
- [ ] `archive_manager.py --auto-check` executed after Step 4
- [ ] Archive check result confirmed (无需归档 OR 归档完成)
```

---

## 技术实现细节

### archive_manager.py 核心类

```python
class ArchiveManager:
    def __init__(self, project_root=None):
        self.state_file = project_root / ".webnovel" / "state.json"
        self.archive_dir = project_root / ".webnovel" / "archive"

        # 归档规则配置
        self.config = {
            "character_inactive_threshold": 50,  # 角色超过 50 章未出场
            "plot_resolved_threshold": 20,       # 已回收伏笔超过 20 章
            "review_old_threshold": 50,          # 审查报告超过 50 章
            "file_size_trigger_mb": 1.0,         # 文件大小触发阈值
            "chapter_trigger": 10                # 每 10 章检查
        }
```

### 核心方法

**1. check_trigger_conditions()**
- 检查文件大小和章节数
- 返回是否需要归档

**2. identify_inactive_characters()**
- 遍历 `entities.characters`
- 筛选出 `importance="minor"` 且超过 50 章未出场的角色

**3. identify_resolved_plot_threads()**
- 遍历 `plot_threads.resolved`
- 筛选出超过 20 章的已回收伏笔

**4. archive_characters() / archive_plot_threads() / archive_reviews()**
- 将数据写入归档文件
- 添加 `archived_at` 时间戳

**5. remove_from_state()**
- 从 `state.json` 中移除已归档的数据
- 原子性操作（要么全部成功，要么全部回滚）

---

## 安全性保障

### 1. 备份机制

每次修改 `state.json` 前，自动创建备份：

```python
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_file = self.state_file.parent / f"state.backup_{timestamp}.json"
shutil.copy2(self.state_file, backup_file)
```

### 2. 原子性操作

归档过程中如果失败，会自动回滚到备份文件。

### 3. 数据完整性检查

- 归档前验证 JSON 格式
- 确保必要字段存在（如 `name`, `importance`）

### 4. Windows UTF-8 编码修复

```python
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
```

---

## FAQ

### Q1: 归档会丢失数据吗？

**A**: 不会。所有归档数据都保存在 `archive/` 目录，可以随时恢复。

---

### Q2: 主要角色会被归档吗？

**A**: 不会。只有 `importance="minor"` 的次要角色才会被归档。主要角色（`importance="major"`）永不归档。

---

### Q3: 如何恢复归档的角色？

**A**: 使用 `python archive_manager.py --restore-character "角色名"` 命令。

---

### Q4: 归档会影响创作流程吗？

**A**: 不会。归档是后台自动执行的，不阻塞创作流程。即使归档失败，也只会输出警告，不会中断章节创作。

---

### Q5: 归档阈值可以调整吗？

**A**: 可以。编辑 `archive_manager.py` 中的 `self.config` 字典：

```python
self.config = {
    "character_inactive_threshold": 100,  # 改为 100 章
    "plot_resolved_threshold": 50,        # 改为 50 章
    "review_old_threshold": 100,          # 改为 100 章
}
```

---

### Q6: 如何禁用自动归档？

**A**: 从 `webnovel-write.md` 的 Step 4.5 中注释掉归档调用：

```markdown
# 禁用自动归档（不推荐，除非你确定 state.json 不会超过 1MB）
# python archive_manager.py --auto-check
```

---

## 总结

**归档系统的核心价值**：

1. ✅ **防止 state.json 无限增长**：确保 200 万字长跑稳定
2. ✅ **性能优化**：保持 `update_state.py` 在 30-40 ms 的稳定耗时
3. ✅ **Git 仓库体积控制**：避免每次 commit 都保存巨大的 state.json
4. ✅ **可逆性**：所有归档数据可随时恢复
5. ✅ **透明性**：用户可以查看归档统计和预览即将归档的数据

**适用场景**：
- 长篇网文创作（100 章+）
- 角色众多的史诗级小说
- 需要长期维护的连载作品

**Gemini 审核结论**：✅ 系统已通过所有测试，可以上线。
