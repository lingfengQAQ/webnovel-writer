#!/usr/bin/env python3
"""
批量写作控制器
支持批量章节写入、进度跟踪、异常处理
"""

import json
import subprocess
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

    def write_chapter(self, chapter: int) -> Dict:
        """调用Claude Code执行单章写作"""
        cmd = [
            "claude-code",
            "--dangerously-skip-permanent-cache",
            f"/webnovel-write {chapter}"
        ]

        try:
            result = subprocess.run(
                cmd,
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=600  # 10分钟超时
            )

            if result.returncode == 0:
                calls_used = self.estimate_calls(result.stdout + result.stderr)
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
        """估算调用次数"""
        lines = output.strip().split("\n")
        # 简单估算：每50行输出约1次API调用
        return max(1, len(lines) // 50)

    def run(self):
        """执行批量写作"""
        print("批量写作开始")
        self.load_progress()

        while self.current_chapter <= self.to_chapter:
            if not self.check_quota():
                print(f"额度不足，停止批量写作")
                break

            chapter = self.current_chapter
            print(f"\n开始写入第 {chapter} 章")

            try:
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

            except KeyboardInterrupt:
                print("\n用户中断批量写作")
                self.save_progress()
                break
            except Exception as e:
                print(f"异常: {e}")
                self.save_progress()
                break

        self.save_progress()
        self.print_summary()

    def print_summary(self):
        """打印批量写作摘要"""
        print(f"\n批量写作完成")
        print(f"完成章节: {len(self.completed_chapters)}")
        print(f"失败章节: {len(self.failed_chapters)}")
        print(f"总调用次数: {self.total_calls}")

    def resume(self):
        """从中断点恢复批量写作"""
        self.load_progress()

        if not self.batch_file.exists():
            print("没有找到批量写作进度文件")
            return

        print(f"恢复批量写作")
        print(f"从第 {self.current_chapter} 章继续")
        print(f"已完成: {len(self.completed_chapters)} 章")
        print(f"失败: {len(self.failed_chapters)} 章")

        # 继续执行
        self.run()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # run子命令
    p_run = subparsers.add_parser("run", help="运行批量写作")
    p_run.add_argument("--project-root", required=True)
    p_run.add_argument("--from", dest="from_chapter", type=int, required=True)
    p_run.add_argument("--to", dest="to_chapter", type=int, required=True)
    p_run.add_argument("--night-mode", action="store_true")
    p_run.add_argument("--max-calls", type=int, default=1400)

    # resume子命令
    p_resume = subparsers.add_parser("resume", help="恢复批量写作")
    p_resume.add_argument("--project-root", required=True)

    args = parser.parse_args()

    if args.command == "resume":
        writer = BatchWriter(Path(args.project_root), 0, 0)
        writer.resume()
    elif args.command == "run":
        writer = BatchWriter(
            Path(args.project_root),
            args.from_chapter,
            args.to_chapter,
            args.night_mode,
            args.max_calls
        )
        writer.run()