#!/usr/bin/env python3
"""
会话管理系统 - M2 阶段实现

负责：
1. 创建/销毁会话
2. 加载会话级 Skill profile
3. 持久化会话状态
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path


class SessionManager:
    """会话管理器。"""

    def __init__(self, project_root: Path | None = None):
        """初始化会话管理器。

        Args:
            project_root: 项目根目录。如果为 None，则不绑定到特定项目。
        """
        self.project_root = project_root.resolve() if project_root else None
        self.sessions_dir = self._get_sessions_dir()

    def _get_sessions_dir(self) -> Path:
        """获取会话目录。"""
        if self.project_root:
            sessions_dir = self.project_root / ".webnovel" / "codex" / "sessions"
        else:
            # 全局会话目录（用于 session stop）
            codex_home = Path.home() / ".codex"
            sessions_dir = codex_home / "webnovel" / "sessions"

        sessions_dir.mkdir(parents=True, exist_ok=True)
        return sessions_dir

    @classmethod
    def available_profiles(cls) -> list[str]:
        """自动发现可用的 Skill profiles。

        Returns:
            可用的 profile 名称列表
        """
        profiles_dir = Path(__file__).parent.parent / "codex_skill_profiles"
        if not profiles_dir.exists():
            return []
        return sorted([
            d.name for d in profiles_dir.iterdir()
            if d.is_dir() and not d.name.startswith((".", "_"))
        ])

    @classmethod
    def validate_profile(cls, profile: str) -> None:
        """验证 profile 名称是否有效。

        Args:
            profile: 要验证的 profile 名称

        Raises:
            ValueError: profile 不存在
        """
        available = cls.available_profiles()
        if profile not in available:
            raise ValueError(
                f"未知的 Skill profile: '{profile}'。"
                f"可用的 profiles: {', '.join(available)}"
            )

    def create_session(self, profile: str) -> str:
        """创建新会话。

        Args:
            profile: Skill profile 名称

        Returns:
            会话 ID
        """
        # Validate profile exists
        self.validate_profile(profile)

        session_id = f"session-{uuid.uuid4().hex[:12]}"
        session_dir = self.sessions_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        # 创建会话元数据
        metadata = {
            "session_id": session_id,
            "profile": profile,
            "created_at": datetime.utcnow().isoformat(),
            "project_root": str(self.project_root) if self.project_root else None,
            "status": "active",
        }

        metadata_file = session_dir / "metadata.json"
        metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

        # 创建 skills 子目录
        skills_dir = session_dir / "skills"
        skills_dir.mkdir(exist_ok=True)

        # 加载 profile 对应的 Skill
        self._load_profile_skills(profile, skills_dir)

        return session_id

    def destroy_session(self, session_id: str) -> None:
        """销毁会话并清理会话级 Skill。

        Args:
            session_id: 会话 ID
        """
        session_dir = self.sessions_dir / session_id
        if not session_dir.exists():
            raise FileNotFoundError(f"会话不存在: {session_id}")

        # 递归删除会话目录
        import shutil
        shutil.rmtree(session_dir)

    def get_session_info(self, session_id: str) -> dict:
        """获取会话信息。

        Args:
            session_id: 会话 ID

        Returns:
            会话元数据
        """
        metadata_file = self.sessions_dir / session_id / "metadata.json"
        if not metadata_file.exists():
            raise FileNotFoundError(f"会话不存在: {session_id}")

        return json.loads(metadata_file.read_text(encoding="utf-8"))

    def _load_profile_skills(self, profile: str, skills_dir: Path) -> None:
        """加载 profile 对应的 Skill。

        Args:
            profile: Skill profile
            skills_dir: 会话 skills 目录
        """
        # 从模板库加载 profile
        profile_template_dir = Path(__file__).parent.parent / "codex_skill_profiles" / profile

        if not profile_template_dir.exists():
            # 如果模板不存在，创建空的 profile 目录
            profile_dir = skills_dir / profile
            profile_dir.mkdir(exist_ok=True)
            return

        # 复制 profile 目录到会话 skills 目录
        import shutil
        profile_dest = skills_dir / profile
        if profile_dest.exists():
            shutil.rmtree(profile_dest)
        shutil.copytree(profile_template_dir, profile_dest)
