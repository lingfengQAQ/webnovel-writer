#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Centralized context template weights.
"""

from __future__ import annotations


DEFAULT_TEMPLATE = "plot"

TEMPLATE_WEIGHTS: dict[str, dict[str, float]] = {
    "plot": {"core": 0.40, "scene": 0.35, "global": 0.25},
    "battle": {"core": 0.35, "scene": 0.45, "global": 0.20},
    "emotion": {"core": 0.45, "scene": 0.35, "global": 0.20},
    "transition": {"core": 0.50, "scene": 0.25, "global": 0.25},
}

TEMPLATE_WEIGHTS_DYNAMIC_DEFAULT: dict[str, dict[str, dict[str, float]]] = {
    "early": {
        "plot": {"core": 0.48, "scene": 0.39, "global": 0.13},
        "battle": {"core": 0.42, "scene": 0.50, "global": 0.08},
        "emotion": {"core": 0.52, "scene": 0.38, "global": 0.10},
        "transition": {"core": 0.56, "scene": 0.28, "global": 0.16},
    },
    "mid": {
        "plot": {"core": 0.40, "scene": 0.35, "global": 0.25},
        "battle": {"core": 0.35, "scene": 0.45, "global": 0.20},
        "emotion": {"core": 0.45, "scene": 0.35, "global": 0.20},
        "transition": {"core": 0.50, "scene": 0.25, "global": 0.25},
    },
    "late": {
        "plot": {"core": 0.36, "scene": 0.29, "global": 0.35},
        "battle": {"core": 0.31, "scene": 0.39, "global": 0.30},
        "emotion": {"core": 0.41, "scene": 0.29, "global": 0.30},
        "transition": {"core": 0.46, "scene": 0.21, "global": 0.33},
    },
}

