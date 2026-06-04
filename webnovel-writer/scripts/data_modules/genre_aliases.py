#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
한국 웹소설 장르 정규화 및 프로필 키 매핑.

설계 방침(1차 핵심 변환):
- 입력층(작가가 쓰는 한국어 장르명)과 별칭 맵만 한국식으로 교체한다.
- 내부 프로필 키(xianxia/shuangwen/romance/...)는 기존 머신을 그대로 재사용한다.
- 장르 템플릿 파일은 이번 단계에서 기존(중국어) 파일명을 유지하고, 한국 장르명에서
  해당 파일명으로 매핑한다(다음 단계에서 본문 한국어화).
"""

from __future__ import annotations


# 한국어 동의어/약칭/하위 트로프 → 정규 한국 장르명
GENRE_INPUT_ALIASES: dict[str, str] = {
    # 동양 판타지 계열
    "수선": "선협",
    "수진": "선협",
    "동양판타지": "선협",
    # 헌터/게이트 계열
    "헌터": "헌터물",
    "게이트": "헌터물",
    "각성": "헌터물",
    # 시스템/레벨업 계열
    "스탯창": "시스템",
    "상태창": "시스템",
    "레벨업": "시스템",
    "시스템물": "시스템",
    # 로맨스 계열
    "로판": "로맨스판타지",
    "현판": "현대판타지",
    # 재벌/현대물
    "재벌": "재벌물",
    "회장님": "재벌물",
    # 공포/괴담
    "괴담": "공포",
    "규칙괴담": "공포",
    # 게임
    "게임판타지": "게임",
    "겜판": "게임",
    # e스포츠
    "이스포츠": "e스포츠",
    "프로게이머": "e스포츠",
    # 대체역사
    "회귀역사": "대체역사",
    "빙의역사": "대체역사",
}


# 정규 한국 장르명 → 내부 프로필 키(기존 머신 재사용)
GENRE_PROFILE_KEY_ALIASES: dict[str, str] = {
    # 동양 판타지 → xianxia
    "선협": "xianxia",
    "무협": "xianxia",
    "동양판타지": "xianxia",
    "아카데미물": "xianxia",
    # 헌터/현대 판타지 → urban-power
    "헌터물": "urban-power",
    "현대판타지": "urban-power",
    "재벌물": "urban-power",
    # 시스템/레벨업 → shuangwen(爽文/系统流)
    "시스템": "shuangwen",
    # 회귀/빙의/환생: 교차 트로프 → 사이다/성장 중심 기본 프로필
    "회귀": "shuangwen",
    "빙의": "shuangwen",
    "환생": "shuangwen",
    # 게임 → game-lit
    "게임": "game-lit",
    # 로맨스 → romance
    "로맨스판타지": "romance",
    "현대로맨스": "romance",
    # 추리/미스터리 → mystery
    "추리": "mystery",
    "미스터리": "mystery",
    # 공포/괴담 → rules-mystery (코즈믹 호러는 cosmic-horror로 별도 입력)
    "공포": "rules-mystery",
    "코즈믹호러": "cosmic-horror",
    # e스포츠 → esports
    "e스포츠": "esports",
    # 대체역사 → history-travel
    "대체역사": "history-travel",
}


# 정규 한국 장르명 → 기존(중국어) 장르 템플릿 파일명 (templates/genres/<파일명>.md)
# 다음 단계에서 템플릿 본문을 한국어화하며 파일명도 영문/한글로 전환 예정.
GENRE_TEMPLATE_FILE: dict[str, str] = {
    "선협": "修仙",
    "무협": "高武",
    "동양판타지": "修仙",
    "아카데미물": "修仙",
    "헌터물": "都市异能",
    "현대판타지": "都市异能",
    "재벌물": "豪门总裁",
    "시스템": "系统流",
    "회귀": "系统流",
    "빙의": "系统流",
    "환생": "系统流",
    "게임": "无限流",
    "로맨스판타지": "幻想言情",
    "현대로맨스": "豪门总裁",
    "추리": "悬疑脑洞",
    "미스터리": "悬疑脑洞",
    "공포": "规则怪谈",
    "코즈믹호러": "克苏鲁",
    "e스포츠": "电竞",
    "대체역사": "历史脑洞",
}


# 정규 한국 장르명 → 중국어 canonical 장르(참고 CSV/스토리시스템 라우팅 매칭용)
# 참고자료 CSV(题材与调性推理/裁决规则/命名规则 등)는 아직 중국어 canonical 장르로
# 색인돼 있으므로, 한국 장르 입력을 매칭 가능한 중국어 canonical로 브리지한다.
# (CSV 본문 한국어화 완료 시 이 브리지는 제거 예정)
KOREAN_TO_CN_GENRE: dict[str, str] = {
    "선협": "仙侠",
    "무협": "仙侠",
    "동양판타지": "玄幻",
    "아카데미물": "玄幻",
    "헌터물": "都市",
    "현대판타지": "都市",
    "재벌물": "现言",
    "시스템": "玄幻",
    "회귀": "玄幻",
    "빙의": "玄幻",
    "환생": "玄幻",
    "게임": "游戏",
    "로맨스판타지": "幻言",
    "현대로맨스": "现言",
    "추리": "悬疑",
    "미스터리": "悬疑",
    "공포": "悬疑",
    "코즈믹호러": "悬疑",
    "e스포츠": "游戏",
    "대체역사": "历史",
}


def to_csv_genre(genre: str) -> str:
    """한국 장르명을 참고 CSV가 쓰는 중국어 canonical 장르로 변환.

    매핑이 없으면 빈 문자열을 반환한다(중국어 입력은 호출 측 기존 로직이 처리).
    """
    normalized = normalize_genre_token(genre)
    return KOREAN_TO_CN_GENRE.get(normalized, "")


def normalize_genre_token(token: str) -> str:
    value = str(token or "").strip()
    if not value:
        return ""
    return GENRE_INPUT_ALIASES.get(value, value)


def to_profile_key(genre: str) -> str:
    value = str(genre or "").strip()
    if not value:
        return ""
    normalized = normalize_genre_token(value)
    return GENRE_PROFILE_KEY_ALIASES.get(normalized, normalized.lower())


def to_template_file(genre: str) -> str:
    """정규화한 한국 장르명에 대응하는 기존 템플릿 파일명(stem)을 반환.

    매핑이 없으면 정규화한 입력값을 그대로 반환한다(파일이 없으면 호출 측에서 폴백).
    """
    normalized = normalize_genre_token(genre)
    return GENRE_TEMPLATE_FILE.get(normalized, normalized)
