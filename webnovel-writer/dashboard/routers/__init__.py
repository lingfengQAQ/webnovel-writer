"""
Dashboard API routers package.
"""

from .edit_assist import router as edit_assist_router
from .outlines import router as outlines_router
from .runtime import router as runtime_router
from .settings import dictionary_router as settings_dictionary_router
from .settings import files_router as settings_files_router
from .skills import router as skills_router

__all__ = [
    "runtime_router",
    "skills_router",
    "settings_files_router",
    "settings_dictionary_router",
    "outlines_router",
    "edit_assist_router",
]
