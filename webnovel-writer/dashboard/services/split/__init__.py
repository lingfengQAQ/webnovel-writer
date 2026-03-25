"""
Split service package for outline split preview/apply/history flows.
"""

from .service import SplitService, SplitServiceError

__all__ = ["SplitService", "SplitServiceError"]
