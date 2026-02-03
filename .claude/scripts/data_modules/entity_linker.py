#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Entity Linker - 实体消歧辅助模块 (v5.4)

为 Data Agent 提供实体消歧的辅助功能：
- 置信度判断
- 别名索引管理 (通过 index.db aliases 表)
- 消歧结果记录

v5.1 变更（v5.4 沿用）:
- 别名存储从 state.json 迁移到 index.db aliases 表
- 使用 IndexManager 进行别名读写
- 移除对 state.json 的直接操作
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

from .config import get_config
from .index_manager import IndexManager


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
    """实体链接器 - 辅助 Data Agent 进行实体消歧 (v5.1 SQLite，v5.4 沿用)"""

    def __init__(self, config=None):
        self.config = config or get_config()
        self._index_manager = IndexManager(self.config)

    # ==================== 别名管理 (v5.1 SQLite，v5.4 沿用) ====================

    def register_alias(self, entity_id: str, alias: str, entity_type: str = "角色") -> bool:
        """注册新别名（v5.1 引入：写入 index.db aliases 表）"""
        if not alias or not entity_id:
            return False
        return self._index_manager.register_alias(alias, entity_id, entity_type)

    def lookup_alias(self, mention: str, entity_type: str = None) -> Optional[str]:
        """查找别名对应的实体ID（返回第一个匹配，可选按类型过滤）"""
        entries = self._index_manager.get_entities_by_alias(mention)
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
        entries = self._index_manager.get_entities_by_alias(mention)
        return [{"type": e.get("type"), "id": e.get("id")} for e in entries]

    def get_all_aliases(self, entity_id: str, entity_type: str = None) -> List[str]:
        """获取实体的所有别名"""
        return self._index_manager.get_entity_aliases(entity_id)

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
        注册新实体的别名 (v5.1 引入，v5.4 沿用)

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
    from .cli_output import print_success, print_error
    from .index_manager import IndexManager

    parser = argparse.ArgumentParser(description="Entity Linker CLI (v5.4 SQLite)")
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
    logger = IndexManager(config)
    tool_name = f"entity_linker:{args.command or 'unknown'}"

    def emit_success(data=None, message: str = "ok"):
        print_success(data, message=message)
        try:
            logger.log_tool_call(tool_name, True)
        except Exception:
            pass

    def emit_error(code: str, message: str, suggestion: str | None = None):
        print_error(code, message, suggestion=suggestion)
        try:
            logger.log_tool_call(tool_name, False, error_code=code, error_message=message)
        except Exception:
            pass

    if args.command == "register-alias":
        entity_type = getattr(args, "type", "角色")
        success = linker.register_alias(args.entity, args.alias, entity_type)
        if success:
            emit_success({"entity": args.entity, "alias": args.alias, "type": entity_type}, message="alias_registered")
        else:
            emit_error("ALIAS_EXISTS", "注册失败或已存在")

    elif args.command == "lookup":
        entity_type = getattr(args, "type", None)
        entity_id = linker.lookup_alias(args.mention, entity_type)
        if entity_id:
            emit_success({"mention": args.mention, "entity": entity_id}, message="lookup")
        else:
            emit_error("NOT_FOUND", f"未找到别名: {args.mention}")

    elif args.command == "lookup-all":
        matches = linker.lookup_alias_all(args.mention)
        emit_success(matches, message="lookup_all")

    elif args.command == "list-aliases":
        entity_type = getattr(args, "type", None)
        aliases = linker.get_all_aliases(args.entity, entity_type)
        emit_success(aliases, message="aliases")

    else:
        emit_error("UNKNOWN_COMMAND", "未指定有效命令", suggestion="请查看 --help")


if __name__ == "__main__":
    main()
