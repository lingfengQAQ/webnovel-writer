#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Project naming constants (한국 웹소설 시장 표준).

프로젝트 디렉터리명·챕터/권 파일명 토큰·관련 정규식을 한곳에 모은 순수 상수 모듈.
다른 모듈이 리터럴을 중복 하드코딩하지 않도록 항상 여기서 임포트한다.

설계 메모:
- 디렉터리/파일 토큰은 ASCII로 고정해 윈도/정규식 안정성을 확보한다.
- 챕터 "제목"은 작가가 쓰는 한국어를 그대로 유지한다(파일명에 한국어 제목 허용).
- 대강 헤딩의 단위는 한국어 `화`를 사용한다.
- config.py 는 .env 로딩/프로젝트 탐지 같은 부작용이 있으므로,
  부작용 없는 본 모듈을 별도로 두어 chapter_paths 등이 가볍게 의존하도록 한다.
"""

from __future__ import annotations

import re

# ================= 프로젝트 디렉터리명 (영문) =================
DIR_MANUSCRIPT = "manuscript"   # 정문(正文) → 원고
DIR_SETTINGS = "settings"       # 설정집(设定集)
DIR_OUTLINE = "outline"         # 대강(大纲)
DIR_REVIEWS = "reviews"         # 심사보고(审查报告)

# 레거시 중국어 디렉터리명 (읽기 전용 하위호환에만 사용)
LEGACY_DIR_MANUSCRIPT = "正文"
LEGACY_DIR_SETTINGS = "设定集"
LEGACY_DIR_OUTLINE = "大纲"
LEGACY_DIR_REVIEWS = "审查报告"

# ================= 챕터/권 파일명 토큰 =================
CHAPTER_PREFIX = "ch"           # ch0007
VOLUME_PREFIX = "vol"           # vol01

CHAPTER_PAD_FLAT = 4            # 평탄 레이아웃: ch0007
CHAPTER_PAD_VOL = 3            # 권 레이아웃 내부: ch007
VOLUME_PAD = 2                 # vol01
CHAPTERS_PER_VOLUME = 50

# 대강 헤딩에서 쓰는 챕터 단위
OUTLINE_CHAPTER_UNIT = "화"
OUTLINE_VOLUME_UNIT = "권"

# ================= 정규식 =================
# 파일명/텍스트에서 챕터 번호 추출 (예: ch0007 → 7)
CHAPTER_NUM_RE = re.compile(rf"{CHAPTER_PREFIX}(?P<num>\d+)")

# 대강 헤딩: "### 7화: 제목" / "### 7화：제목" (레거시 "### 第7章：标题"도 호환)
OUTLINE_HEADING_RE = re.compile(
    rf"^#{{1,6}}\s*(?:第\s*)?(?P<num>\d+)\s*(?:{OUTLINE_CHAPTER_UNIT}|章)\s*[:：]\s*(?P<title>.+?)\s*$",
    re.MULTILINE,
)

# 분할 대강 파일명: "ch0007-제목.md" (레거시 "第0007章-标题.md"도 호환)
SPLIT_OUTLINE_FILENAME_RE = re.compile(
    rf"^(?:{CHAPTER_PREFIX}|第)0*(?P<num>\d+)(?:章)?[-—_ ]+(?P<title>.+?)\.md$"
)

# 레거시(중국어) 챕터 번호 추출: "第0007章" → 7 (읽기 하위호환)
LEGACY_CHAPTER_NUM_RE = re.compile(r"第(?P<num>\d+)章")


def chapter_token(chapter_num: int, *, use_volume_layout: bool = False) -> str:
    """챕터 파일명 토큰 (확장자/제목 제외). 예: ch0007 / ch007"""
    pad = CHAPTER_PAD_VOL if use_volume_layout else CHAPTER_PAD_FLAT
    return f"{CHAPTER_PREFIX}{chapter_num:0{pad}d}"


def volume_token(volume_num: int) -> str:
    """권 디렉터리 토큰. 예: vol01"""
    return f"{VOLUME_PREFIX}{volume_num:0{VOLUME_PAD}d}"
