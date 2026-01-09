#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Entity Linker - 实体消歧辅助模块

为 Data Agent 提供实体消歧的辅助功能：
- 置信度判断
- 别名索引管理
- 消歧结果记录
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import filelock

from .config import get_config

try:
    # 常见：从 scripts/ 目录运行，security_utils 在 sys.path 顶层
    from security_utils import atomic_write_json, read_json_safe
except ImportError:  # pragma: no cover
    # 兼容：从仓库根目录以 `python -m scripts...` 运行
    from scripts.security_utils import atomic_write_json, read_json_safe


@dataclass
class DisambiguationResult:
    """消歧结果"""
    mention: str
    entity_id: Optional[str]
    confidence: float
    candidates: List[str] = field(default_factory=list)
    adopted: bool = False
    warning: Optional[str] = None


class EntityLinker:
    """实体链接器 - 辅助 Data Agent 进行实体消歧 (v5.0 一对多别名)"""

    def __init__(self, config=None):
        self.config = config or get_config()
        # v5.0: alias_index 改为一对多格式 {alias: [{"type": ..., "id": ...}, ...]}
        self._alias_index: Dict[str, List[Dict]] = {}
        self._state_file = self.config.state_file
        self._load_alias_index()

    def _load_alias_index(self):
        """从 state.json 加载 alias_index"""
        if self._state_file.exists():
            try:
                with open(self._state_file, "r", encoding="utf-8") as f:
                    state = json.load(f)
                self._alias_index = state.get("alias_index", {})
            except (json.JSONDecodeError, IOError):
                self._alias_index = {}
        else:
            self._alias_index = {}

    def save_alias_index(self):
        """保存 alias_index 到 state.json（v5.0 内嵌格式，锁内合并 + 原子写入）"""
        if not self._state_file.exists():
            return

        lock_path = self._state_file.with_suffix(self._state_file.suffix + ".lock")
        lock = filelock.FileLock(str(lock_path), timeout=10)
        try:
            with lock:
                state = read_json_safe(self._state_file, default={})

                disk_alias = state.get("alias_index", {})
                if not isinstance(disk_alias, dict):
                    disk_alias = {}

                # 一对多：合并去重（避免覆盖其他进程刚写入的 state 字段/别名）
                for alias, entries in (self._alias_index or {}).items():
                    if not alias or not isinstance(entries, list):
                        continue

                    existing = disk_alias.get(alias)
                    if not isinstance(existing, list):
                        existing = []
                        disk_alias[alias] = existing

                    for entry in entries:
                        if not isinstance(entry, dict):
                            continue
                        et = entry.get("type")
                        eid = entry.get("id")
                        if not et or not eid:
                            continue
                        if any(
                            isinstance(e, dict) and e.get("type") == et and e.get("id") == eid
                            for e in existing
                        ):
                            continue
                        existing.append({"type": et, "id": eid})

                state["alias_index"] = disk_alias

                self.config.ensure_dirs()
                atomic_write_json(self._state_file, state, use_lock=False, backup=True)

                # 同步内存到磁盘最新快照
                self._alias_index = disk_alias
        except filelock.Timeout:
            raise RuntimeError("无法获取 state.json 文件锁，请稍后重试")

    # ==================== 别名管理 (v5.0 一对多) ====================

    def register_alias(self, entity_id: str, alias: str, entity_type: str = "角色") -> bool:
        """注册新别名（v5.0 一对多：同一别名可映射多个实体）"""
        if not alias:
            return False

        if alias not in self._alias_index:
            self._alias_index[alias] = []

        # 检查是否已存在相同 (type, id) 组合
        for entry in self._alias_index[alias]:
            if entry.get("type") == entity_type and entry.get("id") == entity_id:
                return True  # 已存在，视为成功

        self._alias_index[alias].append({
            "type": entity_type,
            "id": entity_id
        })
        return True

    def lookup_alias(self, mention: str, entity_type: str = None) -> Optional[str]:
        """查找别名对应的实体ID（返回第一个匹配，可选按类型过滤）"""
        entries = self._alias_index.get(mention, [])
        if not entries:
            return None

        if entity_type:
            for entry in entries:
                if entry.get("type") == entity_type:
                    return entry.get("id")
            return None
        else:
            return entries[0].get("id") if entries else None

    def lookup_alias_all(self, mention: str) -> List[Dict]:
        """查找别名对应的所有实体（一对多）"""
        return self._alias_index.get(mention, [])

    def get_all_aliases(self, entity_id: str, entity_type: str = None) -> List[str]:
        """获取实体的所有别名"""
        aliases = []
        for alias, entries in self._alias_index.items():
            for entry in entries:
                if entry.get("id") == entity_id:
                    if entity_type is None or entry.get("type") == entity_type:
                        aliases.append(alias)
                        break
        return aliases

    # ==================== 置信度判断 ====================

    def evaluate_confidence(self, confidence: float) -> Tuple[str, bool, Optional[str]]:
        """
        评估置信度，返回 (action, adopt, warning)

        - action: "auto" | "warn" | "manual"
        - adopt: 是否采用
        - warning: 警告信息
        """
        if confidence >= self.config.extraction_confidence_high:
            return ("auto", True, None)
        elif confidence >= self.config.extraction_confidence_medium:
            return ("warn", True, f"中置信度匹配 (confidence: {confidence:.2f})")
        else:
            return ("manual", False, f"需人工确认 (confidence: {confidence:.2f})")

    def process_uncertain(
        self,
        mention: str,
        candidates: List[str],
        suggested: str,
        confidence: float,
        context: str = ""
    ) -> DisambiguationResult:
        """
        处理不确定的实体匹配

        返回消歧结果，包含是否采用、警告信息等
        """
        action, adopt, warning = self.evaluate_confidence(confidence)

        result = DisambiguationResult(
            mention=mention,
            entity_id=suggested if adopt else None,
            confidence=confidence,
            candidates=candidates,
            adopted=adopt,
            warning=warning
        )

        return result

    # ==================== 批量处理 ====================

    def process_extraction_result(
        self,
        uncertain_items: List[Dict]
    ) -> Tuple[List[DisambiguationResult], List[str]]:
        """
        处理 AI 提取结果中的 uncertain 项

        返回 (results, warnings)
        """
        results = []
        warnings = []

        for item in uncertain_items:
            result = self.process_uncertain(
                mention=item.get("mention", ""),
                candidates=item.get("candidates", []),
                suggested=item.get("suggested", ""),
                confidence=item.get("confidence", 0.0),
                context=item.get("context", "")
            )
            results.append(result)

            if result.warning:
                warnings.append(f"{result.mention} → {result.entity_id}: {result.warning}")

        return results, warnings

    def register_new_entities(
        self,
        new_entities: List[Dict]
    ) -> List[str]:
        """
        注册新实体的别名 (v5.0)

        返回注册的实体ID列表
        """
        registered = []

        for entity in new_entities:
            entity_id = entity.get("suggested_id") or entity.get("id")
            if not entity_id or entity_id == "NEW":
                continue

            entity_type = entity.get("type", "角色")

            # 注册主名称
            name = entity.get("name", "")
            if name:
                self.register_alias(entity_id, name, entity_type)

            # 注册提及方式
            for mention in entity.get("mentions", []):
                if mention and mention != name:
                    self.register_alias(entity_id, mention, entity_type)

            registered.append(entity_id)

        return registered


# ==================== CLI 接口 ====================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Entity Linker CLI (v5.0 一对多别名)")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 注册别名
    register_parser = subparsers.add_parser("register-alias")
    register_parser.add_argument("--entity", required=True, help="实体ID")
    register_parser.add_argument("--alias", required=True, help="别名")
    register_parser.add_argument("--type", default="角色", help="实体类型（默认：角色）")

    # 查找别名
    lookup_parser = subparsers.add_parser("lookup")
    lookup_parser.add_argument("--mention", required=True, help="提及文本")
    lookup_parser.add_argument("--type", help="按类型过滤")

    # 查找所有匹配（一对多）
    lookup_all_parser = subparsers.add_parser("lookup-all")
    lookup_all_parser.add_argument("--mention", required=True, help="提及文本")

    # 列出别名
    list_parser = subparsers.add_parser("list-aliases")
    list_parser.add_argument("--entity", required=True, help="实体ID")
    list_parser.add_argument("--type", help="实体类型")

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    linker = EntityLinker(config)

    if args.command == "register-alias":
        entity_type = getattr(args, "type", "角色")
        success = linker.register_alias(args.entity, args.alias, entity_type)
        if success:
            linker.save_alias_index()
            print(f"✓ 已注册: {args.alias} → {args.entity} (类型: {entity_type})")
        else:
            print(f"✗ 注册失败")

    elif args.command == "lookup":
        entity_type = getattr(args, "type", None)
        entity_id = linker.lookup_alias(args.mention, entity_type)
        if entity_id:
            print(f"{args.mention} → {entity_id}")
        else:
            print(f"未找到: {args.mention}")

    elif args.command == "lookup-all":
        entries = linker.lookup_alias_all(args.mention)
        if entries:
            print(f"{args.mention} 的所有匹配:")
            for entry in entries:
                print(f"  - {entry.get('id')} (类型: {entry.get('type')})")
        else:
            print(f"未找到: {args.mention}")

    elif args.command == "list-aliases":
        entity_type = getattr(args, "type", None)
        aliases = linker.get_all_aliases(args.entity, entity_type)
        if aliases:
            print(f"{args.entity} 的别名:")
            for alias in aliases:
                print(f"  - {alias}")
        else:
            print(f"未找到 {args.entity} 的别名")


if __name__ == "__main__":
    main()
