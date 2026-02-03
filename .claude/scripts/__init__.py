"""
webnovel-writer scripts package

This package contains all Python scripts for the webnovel-writer plugin.
"""

__version__ = "5.4.0"
__author__ = "lcy"

# Expose main modules
from . import security_utils
from . import project_locator
from . import chapter_paths

__all__ = [
    "security_utils",
    "project_locator",
    "chapter_paths",
]
