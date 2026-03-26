# Phase 3: 自动化创作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现持续自动写作，直到完成或手动停止

**Architecture:** 在Phase 1/2基础上，增加批量写作控制器，支持批量章节写入、进度跟踪、异常自动处理

**Tech Stack:** Python + Bash + workflow_manager + JSON状态文件

---

## 核心功能设计

### 1. 批量写作模式

```
webnovel-write --batch --from 101 --to 200
```

- 循环执行 `/webnovel-write` 从起始章到结束章
- 每章完成后自动进入下一章
- 支持手动中断（Ctrl+C）

### 2. 进度跟踪

```
.webnovel/workflow_batch.json
```

```json
{
  "batch_id": "batch_20260326_101_200",
  "started_at": "2026-03-26T22:00:00",
  "from_chapter": 101,
  "to_chapter": 200,
  "current_chapter": 105,
  "completed_chapters": [101, 102, 103, 104],
  "failed_chapters": [],
  "status": "running",
  "total_calls_used": 1250,
  "max_calls": 1400
}
```

### 3. 夜间模式

```
webnovel-write --batch --from 101 --to 200 --night-mode --max-calls 1400
```

- `--night-mode`: 启用夜间模式
- `--max-calls 1400`: 额度上限（留100次余量）
- 每章写入前检查已用额度
- 接近额度时自动暂停

### 4. 异常自动处理

- 每章完成后自动保存进度
- 异常时记录失败章节和原因
- 使用 `webnovel-resume` 从断点恢复

---

## 文件结构

```
.webnovel/
├── workflow_batch.json      # 批量写作进度
├── workflow_state.json     # 单章写作状态（已存在）
└── recovery_backups/      # 恢复备份
```

---

## Task 1: 批量写作控制器设计

**目标:** 创建批量写作的核心逻辑

**Files:**
- Create: `webnovel-writer/scripts/batch_writer.py`
- Modify: `webnovel-writer/scripts/webnovel.py`

- [ ] **Step 1: 创建batch_writer.py**

```python
#!/usr/bin/env python3
"""
批量写作控制器
支持批量章节写入、进度跟踪、异常处理
"""

import json
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict

class BatchWriter:
    def __init__(self, project_root: Path, from_chapter: int, to_chapter: int,
                 night_mode: bool = False, max_calls: int = 1400):
        self.project_root = project_root
        self.from_chapter = from_chapter
        self.to_chapter = to_chapter
        self.night_mode = night_mode
        self.max_calls = max_calls
        self.current_chapter = from_chapter
        self.completed_chapters: List[int] = []
        self.failed_chapters: List[Dict] = []
        self.total_calls = 0

        self.batch_file = project_root / ".webnovel" / "workflow_batch.json"

    def load_progress(self):
        """从文件加载进度"""
        if self.batch_file.exists():
            with open(self.batch_file) as f:
                data = json.load(f)
            self.current_chapter = data.get("current_chapter", self.from_chapter)
            self.completed_chapters = data.get("completed_chapters", [])
            self.failed_chapters = data.get("failed_chapters", [])
            self.total_calls = data.get("total_calls_used", 0)

    def save_progress(self):
        """保存进度到文件"""
        data = {
            "batch_id": f"batch_{datetime.now().strftime('%Y%m%d')}_{self.from_chapter}_{self.to_chapter}",
            "started_at": datetime.now().isoformat(),
            "from_chapter": self.from_chapter,
            "to_chapter": self.to_chapter,
            "current_chapter": self.current_chapter,
            "completed_chapters": self.completed_chapters,
            "failed_chapters": self.failed_chapters,
            "status": "running",
            "total_calls_used": self.total_calls,
            "max_calls": self.max_calls
        }
        self.batch_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.batch_file, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def check_quota(self) -> bool:
        """检查额度是否充足"""
        if not self.night_mode:
            return True
        remaining = self.max_calls - self.total_calls
        return remaining >= 50  # 留50次余量

    def run(self):
        """执行批量写作"""
        self.load_progress()

        while self.current_chapter <= self.to_chapter:
            if not self.check_quota():
                print(f"⚠️ 额度不足（剩余{self.max_calls - self.total_calls}次），停止批量写作")
                break

            chapter = self.current_chapter
            print(f"\n{'='*50}")
            print(f"开始写入第 {chapter} 章")
            print(f"{'='*50}")

            try:
                # 调用单章写作（通过system调用claude-code）
                result = self.write_chapter(chapter)

                if result["success"]:
                    self.completed_chapters.append(chapter)
                    self.total_calls += result.get("calls_used", 50)
                    print(f"✅ 第 {chapter} 章完成")
                else:
                    self.failed_chapters.append({
                        "chapter": chapter,
                        "error": result.get("error", "未知错误")
                    })
                    print(f"❌ 第 {chapter} 章失败: {result.get('error')}")

                self.current_chapter += 1
                self.save_progress()

                # 章节间休息（避免请求过快）
                time.sleep(2)

            except KeyboardInterrupt:
                print("\n⚠️ 用户中断批量写作")
                self.save_progress()
                break
            except Exception as e:
                print(f"❌ 异常: {e}")
                self.failed_chapters.append({
                    "chapter": chapter,
                    "error": str(e)
                })
                self.save_progress()
                break

        self.save_progress()
        self.print_summary()

    def write_chapter(self, chapter: int) -> Dict:
        """调用单章写作"""
        # TODO: 实现调用claude-code执行webnovel-write
        pass

    def print_summary(self):
        """打印批量写作摘要"""
        print(f"\n{'='*50}")
        print("批量写作完成")
        print(f"{'='*50}")
        print(f"完成章节: {len(self.completed_chapters)}/{self.to_chapter - self.from_chapter + 1}")
        print(f"失败章节: {len(self.failed_chapters)}")
        print(f"总调用次数: {self.total_calls}")
```

- [ ] **Step 2: 在webnovel.py添加batch命令**

```python
# 在webnovel.py添加
elif action == "batch":
    from batch_writer import BatchWriter
    # 解析参数 --from, --to, --night-mode, --max-calls
    writer = BatchWriter(project_root, from_ch, to_ch, night_mode, max_calls)
    writer.run()
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: 添加批量写作控制器"
```

---

## Task 2: 单章调用CLI封装

**目标:** 实现write_chapter方法，调用Claude Code执行单章写作

**Files:**
- Modify: `webnovel-writer/scripts/batch_writer.py`

- [ ] **Step 1: 实现write_chapter方法**

```python
def write_chapter(self, chapter: int) -> Dict:
    """调用Claude Code执行单章写作"""
    import subprocess

    # 构建调用命令
    cmd = [
        "claude-code",
        "--dangerously-skip-permanent-cache",
        f"/webnovel-write {chapter}"
    ]

    try:
        result = subprocess.run(
            cmd,
            cwd=self.project_root,
            capture_output=True,
            text=True,
            timeout=600  # 10分钟超时
        )

        if result.returncode == 0:
            # 估算调用次数（基于输出行数）
            calls_used = self.estimate_calls(result.stdout)
            return {
                "success": True,
                "calls_used": calls_used
            }
        else:
            return {
                "success": False,
                "error": result.stderr or "未知错误"
            }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "章节写作超时（10分钟）"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def estimate_calls(self, output: str) -> int:
    """估算调用次数（基于输出特征）"""
    # 简单估算：每100行输出约1次API调用
    lines = output.strip().split("\n")
    return max(1, len(lines) // 100)
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: 实现单章调用封装"
```

---

## Task 3: 进度恢复功能

**目标:** 支持从中断点恢复批量写作

**Files:**
- Modify: `webnovel-writer/scripts/batch_writer.py`
- Create: `webnovel-writer/scripts/resume_batch.py`

- [ ] **Step 1: 添加恢复功能**

```python
def resume(self):
    """从中断点恢复批量写作"""
    self.load_progress()

    if not self.batch_file.exists():
        print("❌ 没有找到批量写作进度文件")
        return

    print(f"📂 恢复批量写作")
    print(f"从第 {self.current_chapter} 章继续")
    print(f"已完成: {len(self.completed_chapters)} 章")
    print(f"失败: {len(self.failed_chapters)} 章")

    # 继续执行
    self.run()
```

- [ ] **Step 2: 添加命令行入口**

```bash
# resume_batch.py
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", required=True)
    args = parser.parse_args()

    writer = BatchWriter(Path(args.project_root), 0, 0)
    writer.resume()
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: 添加批量写作恢复功能"
```

---

## Task 4: 质量门控

**目标:** 设置质量阈值，低于阈值自动停下

**Files:**
- Modify: `webnovel-writer/scripts/batch_writer.py`

- [ ] **Step 1: 添加质量检查**

```python
class BatchWriter:
    def __init__(self, ...):
        # ... 现有参数
        self.min_quality_score = 75  # 最低质量分数

    def check_quality(self, chapter: int) -> bool:
        """检查章节质量分数"""
        # 从review_metrics表读取本章分数
        score = self.get_chapter_score(chapter)
        return score >= self.min_quality_score

    def get_chapter_score(self, chapter: int) -> Optional[float]:
        """获取章节质量分数"""
        # TODO: 从index.db读取
        pass

    def run(self):
        while self.current_chapter <= self.to_chapter:
            # ... 现有逻辑

            # 质量检查
            if not self.check_quality(chapter):
                print(f"⚠️ 第 {chapter} 章质量分数低于阈值，停止批量写作")
                self.save_progress()
                break
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: 添加质量门控"
```

---

## Task 5: 夜间模式优化

**目标:** 优化夜间模式的额度计算和提示

**Files:**
- Modify: `webnovel-writer/scripts/batch_writer.py`

- [ ] **Step 1: 增强夜间模式**

```python
def run(self):
    while self.current_chapter <= self.to_chapter:
        # 夜间模式额度检查
        if self.night_mode:
            remaining = self.max_calls - self.total_calls
            if remaining < 50:
                print(f"🌙 夜间额度即将用尽（剩余{remaining}次）")
                print(f"将在本章后停止，以便明天继续")

            # 计算预计可用章节数
            avg_calls_per_chapter = 50  # 假设每章50次
            estimated_chapters = remaining // avg_calls_per_chapter
            if estimated_chapters < self.to_chapter - self.current_chapter + 1:
                print(f"📊 预计可完成章节数: {estimated_chapters}")
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: 优化夜间模式提示"
```

---

## Task 6: 端到端测试

**目标:** 测试批量写作功能

- [ ] **Step 1: 测试批量写作**

```bash
# 测试2章批量写作
python -X utf8 webnovel.py --project-root "测试项目" \
  batch --from 1 --to 2 --night-mode --max-calls 100
```

- [ ] **Step 2: 验证进度文件**

```bash
cat .webnovel/workflow_batch.json
```

- [ ] **Step 3: 测试恢复功能**

```bash
# 中断后恢复
python resume_batch.py --project-root "测试项目"
```

- [ ] **Step 4: 提交测试结果**

```bash
git add -A
git commit -m "test: 批量写作端到端测试"
```

---

## 依赖关系

```
Task 1 (批量控制器) ← 基础
    ↓
Task 2 (单章调用) ← 依赖Task 1
    ↓
Task 3 (进度恢复) ← 依赖Task 1
    ↓
Task 4 (质量门控) ← 可并行
    ↓
Task 5 (夜间模式) ← 可并行
    ↓
Task 6 (端到端测试) ← 依赖1-5
```

---

## 验收标准

- [ ] `webnovel-write --batch --from 101 --to 200` 能正常执行
- [ ] `.webnovel/workflow_batch.json` 正确记录进度
- [ ] 中断后 `resume_batch.py` 能从断点恢复
- [ ] `--night-mode --max-calls 1400` 额度控制生效
- [ ] 质量低于阈值时自动停下
- [ ] 期间无需人工干预（除异常外）
- [ ] 异常自动处理，不丢失进度

---

## 回滚计划

| 步骤 | 回滚方式 |
|------|----------|
| Task 1 | `git revert` 批量控制器 |
| Task 2 | `git revert` 单章调用封装 |
| Task 3 | `git revert` 恢复功能 |
| Task 4 | `git revert` 质量门控 |
| Task 5 | `git revert` 夜间模式优化 |
| Task 6 | `git revert` 测试提交 |
