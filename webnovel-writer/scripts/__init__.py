"""
webnovel-writer scripts package

This package contains all Python scripts for the webnovel-writer plugin.
"""

__version__ = "5.5.4"
__author__ = "lcy"

# Expose main modules
from . import chapter_paths, project_locator, security_utils

__all__ = [
    "security_utils",
    "project_locator",
    "chapter_paths",
]
