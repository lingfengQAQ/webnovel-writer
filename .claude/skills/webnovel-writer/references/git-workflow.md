# Git 版本控制工作流（原子性备份系统）

> **目的**: 解决"写废设定"问题，支持任意时间点的原子性回滚。

---

## 核心理念

200万字网文创作过程中，必然会遇到"写废"的情况：
- 第 150 章发现设定矛盾，需要回滚到第 140 章重写
- 某条感情线写崩了，想从 50 章前分支出"平行世界"
- 不确定主角该选择哪条道路，需要同时尝试两个版本

**传统备份方案的致命缺陷**：
```
❌ 只备份 state.json → 回滚时章节文件仍存在 → 数据撕裂
   例：回滚到 ch140（筑基期），但 ch150.md 文件（金丹期）依然存在
```

**Git 原子性解决方案**：
```
✅ state.json + 所有 .md 文件同时回滚 → 数据 100% 一致
✅ 只存储差异（diff）→ 节省 95% 存储空间
✅ 天然支持分支 → "平行世界"创作
```

---

## 自动化工作流

### 1. 项目初始化（自动 Git init）

```bash
python scripts/init_project.py ./my-novel "废柴崛起" "修仙"
```

**自动执行**：
1. 创建项目结构
2. 初始化 Git 仓库（`git init`）
3. 创建 `.gitignore`（排除缓存文件）
4. 首次提交（"Initial commit: Project initialized"）

**验证**：
```bash
cd my-novel
git log
# 应该看到初始提交
```

---

### 2. 章节创作后自动备份

```bash
/webnovel-write 45
```

**执行流程**：
1. 生成第 45 章内容 → 保存到 `正文/第0045章.md`
2. 更新 `state.json`（主角实力/伏笔/关系等）
3. **自动调用**：
   ```bash
   python scripts/backup_manager.py --chapter 45 --chapter-title "外门大比：一招制敌"
   ```

**Git 操作**：
```bash
git add .
git commit -m "Chapter 45: 外门大比：一招制敌"
git tag ch0045
```

**结果**：
- state.json 和 第0045章.md **同时提交**
- 创建 tag `ch0045` 便于快速定位

---

### 3. 回滚到任意章节（原子性）

**场景**：第 150 章发现设定崩了，需要回到第 140 章重写。

```bash
python scripts/backup_manager.py --rollback 140
```

**执行逻辑**：
1. 检查是否有未提交的变更
2. **如有未提交变更**：
   - 自动创建备份分支（`backup_before_rollback_20250131_143022`）
   - 提交所有未保存的改动到备份分支
   - 切换回 master
3. 执行原子性回滚：
   ```bash
   git checkout ch0140
   ```
4. **结果**：
   - `state.json` 恢复到第 140 章状态（筑基 7 层）
   - `正文/` 目录只包含前 140 章的 .md 文件
   - 第 141-150 章的文件**全部消失**（Git 已管理，可随时恢复）

**数据一致性保证**：
```
✅ state.json: 筑基 7 层
✅ 正文/第0140章.md: 最后一章（筑基期内容）
✅ 正文/第0150章.md: 不存在（已回滚）
```

---

### 4. 对比两个版本的差异

**场景**：想看看从第 100 章到第 150 章，主角实力和设定变化了多少。

```bash
python scripts/backup_manager.py --diff 100 150
```

**输出示例**：
```
📊 对比第 100 章 与 第 150 章的差异...

📈 文件变更统计：
 .webnovel/state.json     | 25 +++++++++++++
 正文/第0101章.md         | 120 +++++++++++++++++++++++
 正文/第0102章.md         | 115 +++++++++++++++++++++++
 ...（共 50 个新增章节）

📝 state.json 详细差异：
-  "realm": "筑基期",
-  "layer": 7,
+  "realm": "金丹期",
+  "layer": 3,
```

---

### 5. 创建"平行世界"分支

**场景**：不确定主角该走"复仇路线"还是"隐忍路线"，想同时尝试两个版本。

```bash
# 从第 50 章创建分支
python scripts/backup_manager.py --create-branch 50 --branch-name "alternative-revenge"
```

**Git 操作**：
```bash
git branch alternative-revenge ch0050
```

**后续操作**：
```bash
# 切换到分支
git checkout alternative-revenge

# 在分支上继续创作（第 51-100 章走复仇路线）
/webnovel-write 51
/webnovel-write 52
...

# 切回主线（隐忍路线）
git checkout master
/webnovel-write 51
```

**最终结果**：
- `master` 分支：隐忍路线（第 51-100 章）
- `alternative-revenge` 分支：复仴路线（第 51-100 章）
- 两条时间线可独立发展，互不影响

---

### 6. 查看所有备份历史

```bash
python scripts/backup_manager.py --list
```

**输出示例**：
```
📚 备份列表（Git tags）：

📖 ch0001 | a3f8c21 2025-01-15 10:30:45 +0800 Chapter 1: 家族废物
📖 ch0002 | b7e2d34 2025-01-15 14:22:10 +0800 Chapter 2: 神秘系统觉醒
📖 ch0003 | c9a1f56 2025-01-15 18:45:33 +0800 Chapter 3: 首次吞噬
...
📖 ch0150 | f2d8e91 2025-01-30 22:15:20 +0800 Chapter 150: 金丹雷劫

总计：150 个备份

📜 最近提交历史：

f2d8e91 Chapter 150: 金丹雷劫
e1c7d82 Chapter 149: 突破前夕
d0b6c73 Chapter 148: 秘境夺宝
...
```

---

## 高级用法

### 恢复到 master 分支

如果回滚后想继续从最新章节写：

```bash
git checkout master
```

### 查看分支列表

```bash
git branch -a
```

### 删除不需要的分支

```bash
git branch -d alternative-revenge
```

### 手动 Git 操作

所有标准 Git 命令都可用：

```bash
# 查看提交历史
git log --oneline

# 查看某次提交的详细变更
git show ch0100

# 对比当前状态与某个章节
git diff ch0120

# 创建自定义分支
git checkout -b experiment-magic-system ch0080
```

---

## 故障排查

### Q: 回滚后发现选错了章节号，怎么恢复？

A: Git 的所有操作都是可逆的。如果回滚到 ch0140 但想回到 ch0150：

```bash
# 方法 1：直接 checkout 到目标 tag
git checkout ch0150

# 方法 2：回到 master（最新状态）
git checkout master
```

### Q: 误删了某个分支，如何找回？

A: Git 会保留删除前的提交记录：

```bash
# 查看所有操作历史
git reflog

# 找到分支删除前的提交 SHA（如 abc1234），恢复分支
git branch alternative-revenge abc1234
```

### Q: 如何清理磁盘空间（删除旧版本）？

A: Git 增量存储已经很省空间（95% 节省），但如果确实需要：

```bash
# 删除 100 章之前的所有 tag
git tag -l "ch00*" | xargs git tag -d

# 垃圾回收
git gc --aggressive
```

**⚠️ 警告**：删除 tag 后无法再快速回滚到对应章节（但提交记录仍在）。

---

## 与传统备份系统的对比

| 对比项 | 传统 JSON Diff | Git 版本控制 |
|--------|---------------|-------------|
| **原子性** | ❌ 只备份 state.json | ✅ 所有文件同时回滚 |
| **存储效率** | ✅ 增量存储（95% 节省） | ✅ 增量存储（95% 节省） |
| **回滚速度** | ⚠️ 需要逐层应用 diff | ✅ 一条命令（git checkout） |
| **分支支持** | ❌ 需要手动复制目录 | ✅ 原生支持（git branch） |
| **工具生态** | ⚠️ 需自行实现 | ✅ 20 年成熟工具链 |
| **数据一致性** | ❌ state.json 与 .md 文件可能不同步 | ✅ 100% 保证同步 |
| **学习成本** | ⚠️ 需理解自定义格式 | ✅ 标准 Git 操作 |

---

## 总结：三大优势

1. **原子性回滚**：`state.json` + `正文/*.md` 同时回滚，数据 100% 一致
2. **增量存储**：只存储 diff，200万字小说仅占约 100MB（vs 传统全量备份 2GB+）
3. **分支管理**：天然支持"平行世界"创作，轻松尝试不同剧情走向

**记住**：Git 不只是程序员的工具，它是"**任何需要版本控制的内容创作者**"的最佳选择！
