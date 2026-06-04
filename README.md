# Webnovel Writer (한국 웹소설 에디션)

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)

> 이 저장소는 중국 웹소설용으로 만들어진 원본을 **한국 웹소설 시장에 맞게 현지화**한 버전입니다.
> 프롬프트·문서는 한국어, 생성되는 프로젝트 폴더명은 영문(`manuscript/`, `outline/`, `settings/`, `reviews/`), 장르 체계는 한국 웹소설 장르로 매핑되어 있습니다.

## 이게 뭔가요?

`Webnovel Writer`는 Claude Code 기반의 장편 웹소설 창작 시스템입니다.

목표는 간단합니다: **AI가 장편을 쓸 때 설정을 헷갈리거나 앞 내용을 잊지 않게 하는 것.**

시스템이 캐릭터 설정·복선·세계관 규칙을 자동으로 관리해, 수백 화를 연재해도 앞뒤 모순 없이 이어갈 수 있게 돕습니다.

## 빠른 시작

### 1) 플러그인 설치

Claude Code 마켓플레이스에서 설치:

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

> 현재 프로젝트에서만 쓰려면 `--scope user`를 `--scope project`로 바꾸세요.

### 2) Python 의존성 설치

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

### 3) 소설 프로젝트 초기화

Claude Code에서:

```bash
/webnovel-init
```

제목·장르·주인공 등을 단계별로 입력하면 작업 폴더에 프로젝트가 생성됩니다.

**장르 입력 예시(한국 웹소설):** `헌터물`, `현대판타지`, `무협`, `선협`, `시스템`, `회귀`, `로맨스판타지`(`로판`), `현대로맨스`, `재벌물`, `추리`, `공포`, `e스포츠`, `대체역사`, `게임`. 복합 장르는 `+`로 연결합니다(예: `현대판타지+공포`).

생성되는 폴더 구조(영문):

```
<프로젝트>/
├── manuscript/   # 원고(화 본문)
├── outline/      # 대강(마스터/권/화 아웃라인)
├── settings/     # 설정집(세계관·파워시스템·캐릭터 등)
├── reviews/      # 심사 보고서
└── .webnovel/    # 런타임 상태(읽기 모델)
```

> 기존 중국어 폴더(`正文/`, `大纲/`, `设定集/`, `审查报告/`)로 만들어진 프로젝트는 **읽기 호환**됩니다. 새로 쓰는 파일은 항상 영문 폴더로 생성됩니다.

### 4) RAG 설정(필수)

프로젝트 루트에서 설정 템플릿을 `.env`로 복사하고 API Key를 채웁니다:

```bash
cp .env.example .env
```

최소 설정:

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

> ⚠️ **한국 사용자 주의:** 임베딩 기본값은 ModelScope(중국)입니다. 한국에서 접속이 불안정할 수 있으니, OpenAI 호환 다국어 임베딩 엔드포인트로 `EMBED_BASE_URL`/`EMBED_MODEL`을 바꾸는 것을 권장합니다.

### 5) 집필 시작

```bash
/webnovel-plan 1      # 1권 아웃라인 기획
/webnovel-write 1     # 1화 집필
/webnovel-review 1-5  # 1~5화 심사
```

> 한국 웹소설 1편 분량(약 5,000자)에 맞춰 사이다(쾌감) 밀도·분량 기준값이 조정되어 있습니다.

### 6) 시각화 대시보드(선택)

```bash
/webnovel-dashboard
```

읽기 전용 대시보드로 프로젝트 상태, 엔티티 그래프, 화별 내용, 추독력 데이터를 볼 수 있습니다. 프런트엔드는 플러그인에 미리 빌드되어 있어 `npm build`가 필요 없습니다.

## 장르 매핑

한국 장르명은 내부 프로필 키로 매핑됩니다(구조는 원본 유지):

| 한국 장르 | 내부 프로필 |
|---|---|
| 선협 / 무협 / 동양판타지 / 아카데미물 | xianxia |
| 헌터물 / 현대판타지 / 재벌물 | urban-power |
| 시스템 / 회귀 / 빙의 / 환생 | shuangwen |
| 로맨스판타지 / 현대로맨스 | romance |
| 게임 | game-lit |
| 추리 / 미스터리 | mystery |
| 공포 / 괴담 | rules-mystery |
| e스포츠 | esports |
| 대체역사 | history-travel |

> `회귀`·`빙의`·`환생`은 교차 트로프라 단독 입력 시 사이다/성장 중심 기본 프로필(`shuangwen`)로 해소됩니다. 다른 장르와 조합해 쓰는 것을 권장합니다.

## 현지화 적용 범위(1차)

- ✅ 생성 폴더명 영문화(`manuscript`/`outline`/`settings`/`reviews`) + 챕터 파일명 ASCII 토큰화(`ch0007`/`vol01`)
- ✅ 한국 장르 매핑(별칭·프로필·템플릿 파일 매핑)
- ✅ 한국 시장 기본값(편당 분량/사이다 밀도, 한국어 경보 키워드, 임베딩 안내)
- ✅ 사용자 노출 CLI 메시지·스킬 설명·문서 한국어화
- ✅ 레거시(중국어) 프로젝트 읽기 호환

> 진행 중(다음 단계): 스킬/에이전트 본문 프롬프트 전면 한국어화, 9개 참고 CSV 본문 현지화, 장르 템플릿/설정 본문 한국어화, 대시보드 프런트엔드.

## 오픈소스 라이선스

본 프로젝트는 `GPL v3`를 따릅니다. 자세한 내용은 [LICENSE](LICENSE) 참고.

## 감사의 글

원본 프로젝트: [lingfengQAQ/webnovel-writer](https://github.com/lingfengQAQ/webnovel-writer) — **Claude Code + Gemini CLI + Codex** Vibe Coding으로 개발.
