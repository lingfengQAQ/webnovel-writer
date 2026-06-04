---
name: webnovel-init
description: 웹소설 프로젝트를 심화 초기화합니다. 단계별 인터랙션으로 창작 정보를 수집해 곧바로 기획·집필로 들어갈 수 있는 프로젝트 골격과 제약 파일을 생성합니다.
allowed-tools: Read Write Edit Grep Bash Agent AskUserQuestion WebSearch WebFetch
---

# Project Initialization (Deep Mode)

## 목표

- 구조화된 인터랙션을 통해 충분한 정보를 수집하여 "먼저 생성하고 나중에 수정"하는 방식을 방지한다.
- 실제로 활용 가능한 프로젝트 골격을 산출한다: `.webnovel/state.json`、`settings/*`、`outline/마스터아웃라인.md`、`.webnovel/idea_bank.json`.
- 이후 `/webnovel-plan`과 `/webnovel-write`가 바로 실행될 수 있도록 보장한다.

## 실행 원칙

1. 먼저 수집하고, 그 다음에 생성한다. 충분성 게이트를 통과하기 전에는 `init_project.py`를 실행하지 않는다.
2. 질문을 단계별로 나눠서 하며, 매 라운드에서는 "현재 누락되어 있고 다음 단계를 막는" 정보만 질문한다.
3. `Read/Grep/Bash/Agent/AskUserQuestion/WebSearch/WebFetch` 호출을 통해 수집을 보조할 수 있다.
4. 사용자가 이미 명확히 밝힌 정보는 다시 묻지 않는다. 충돌하는 정보가 있을 경우 사용자에게 판단을 맡긴다.
5. Deep 모드는 완전성을 우선하므로 느려도 허용하지만, 핵심 필드 누락은 금지한다.
6. 참고작 분석은 구조화된 결과만 init 메인 플로우에 반환한다. 사용자 확인 전에는 `idea_bank.json`、`.story-system`、`settings`、`outline`、`manuscript`、`.webnovel/state.json` 또는 어떤 canon/read model 파일에도 쓰지 않는다.

## 참조 로딩 전략

경로 설명: `references/`는 스킬 전용 `skills/webnovel-init/references/`를 가리키며, `../../references/`는 공유 references를 가리킨다.

### 필수 읽기 md

| Step | Trigger | Reference | 실제 경로 |
|------|---------|-----------|---------|
| Step 1 | always | 데이터 흐름 규범 | `${SKILL_ROOT}/references/system-data-flow.md` |
| Step 1 | always | 장르 클리셰 라이브러리 | `${SKILL_ROOT}/references/genre-tropes.md` |
| 판매 포인트/장르 수집 | always | 장르 설정 | `${SKILL_ROOT}/../../references/genre-profiles.md` |

### 조건부 읽기 md

| Step | Trigger | Reference | 실제 경로 |
|------|---------|-----------|---------|
| Step 2 | 사용자 캐릭터가 평면적일 때 | 캐릭터 디자인 | `${SKILL_ROOT}/references/worldbuilding/character-design.md` |
| Step 4 | always | 세력 구도 | `${SKILL_ROOT}/references/worldbuilding/faction-systems.md` |
| Step 4 | 선선/현판/고무/이능 관련 시 | 파워 시스템 | `${SKILL_ROOT}/references/worldbuilding/power-systems.md` |
| Step 4 | always | 세계 규칙 | `${SKILL_ROOT}/references/worldbuilding/world-rules.md` |
| Step 5 | always | 창의 제약 | `${SKILL_ROOT}/references/creativity/creativity-constraints.md` |
| Step 5 | always | 판매 포인트 생성 | `${SKILL_ROOT}/references/creativity/selling-points.md` |
| Step 5 | 복합 장르 | 장르 융합 | `${SKILL_ROOT}/references/creativity/creative-combination.md` |
| Step 5 | 막힐 때 | 영감 후보 | `${SKILL_ROOT}/references/creativity/inspiration-collection.md` |
| Step 5 | 장르 매핑 적중 시 | 반클리셰 라이브러리 | `${SKILL_ROOT}/references/creativity/anti-trope-*.md` |
| Step 6 | always | 설정 일관성 | `${SKILL_ROOT}/references/worldbuilding/setting-consistency.md` |

### CSV 검색

| Step | Trigger | 검색 명령 |
|------|---------|---------|
| 캐릭터/제목/세력 설정 | 사용자가 명명 작업을 시작할 때 | `python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill init --table 命名规则 --query "{명명 대상} {장르}" --genre {장르}` |

## 도구 전략 (필요에 따라)

- `Read/Grep`: 프로젝트 컨텍스트와 참조 파일을 읽는다(`README.md`、`CLAUDE.md`、`templates/genres/*`、`references/*`).
- `Bash`: `init_project.py` 실행, 파일 존재 여부 확인, 최소 검증 명령 실행.
- `Agent`: 병렬 서브태스크 분할(장르 매핑, 제약 패키지 후보 생성, 파일 검증 등). Step 1.5에서 사용자가 참고작 분석을 영감의 출처로 선택하면 `webnovel-writer:deconstruction-agent`를 호출한다.
- `AskUserQuestion`: 핵심 분기 판단, 후보 방안 선택, 최종 확인에 사용한다.
- `WebSearch`: 최신 시장 트렌드, 플랫폼 동향, 장르 데이터 조회에 사용한다(도메인 필터링 가능).
- `WebFetch`: 확인된 출처 페이지 내용을 가져와 사실 검증에 사용한다.
- 외부 검색 트리거 조건:
  - 사용자가 시장 트렌드나 플랫폼 동향 참조를 명시적으로 요청할 때;
  - 창의 제약에 "시간 민감한 근거"가 필요할 때;
  - 장르 정보에 명백한 불확실성이 있을 때.

## 인터랙션 플로우 (Deep)

### Step 1: 사전 검사 및 컨텍스트 로딩

환경 설정 (bash 명령 실행 전):
```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -z "${CLAUDE_PLUGIN_ROOT}" ] || [ ! -d "${CLAUDE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: CLAUDE_PLUGIN_ROOT이 설정되지 않았거나 디렉터리가 없습니다: ${CLAUDE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
```

반드시 해야 할 것:
- 현재 디렉터리에 쓰기 권한이 있는지 확인한다.
- 스크립트 디렉터리를 파싱하고 진입점이 존재하는지 확인한다(플러그인 디렉터리만 지원):
  - 고정 경로: `${CLAUDE_PLUGIN_ROOT}/scripts`
  - 진입 스크립트: `${SCRIPTS_DIR}/webnovel.py`
- 초기화 전에 `where`로 `WORKSPACE_ROOT`를 책 프로젝트 루트로 해석하지 않는다. 새 프로젝트가 아직 없을 때 `where`가 오래된 포인터나 이전 프로젝트를 찾을 수 있다.
- 작업 공간과 스크립트 디렉터리만 출력하고, 생성 대상이 작업 공간 아래의 제목 안전화 서브디렉터리에 있음을 확인한다.
- 최소 참조를 로딩한다:
  - `references/system-data-flow.md` (init 산출물과 plan/write 입력 체인 교정에 사용)
  - `references/genre-tropes.md`
  - `templates/genres/` (사용자가 장르를 선택한 후 필요에 따라 읽는다)

출력:
- Deep 수집 진입 전 "알려진 정보 목록"과 "수집 대기 목록".

### Step 1.5: 영감 출처 질문 (선택 사항)

스토리 코어 수집 전에 반드시 먼저 `AskUserQuestion` 또는 직접 질문 방식으로 사용자가 영감의 출처를 제공할 의사가 있는지 확인한다. 기본적으로 참고작을 분해하지 않으며, 참고 작품을 필수 항목으로 취급하지 않는다.

권장 질문:

```text
이 소설의 영감 출처를 어디서부터 시작하고 싶으신가요? 직접 원창 아이디어를 말씀하셔도 되고, 참고 작품을 제공해서 분석에 활용해도 됩니다. 참고작을 분석하길 원하신다면 책 제목과 플랫폼을 알려주시고, 가능하다면 챕터 발췌문이나 텍스트 경로도 함께 제공해 주세요. 참고작이 없다면 바로 넘어가셔도 됩니다.
```

허용되는 영감의 출처:
- 사용자가 자유롭게 서술한 원창 아이디어;
- 참고작 분석: 책 제목, 플랫폼, 챕터 발췌문, 전체 텍스트 경로;
- 시장 트렌드 또는 플랫폼 동향;
- 장르 템플릿, 반클리셰 라이브러리, 기존 브레인스토밍 아이디어.

사용자가 참고작 분석을 선택하고 텍스트 경로나 챕터 발췌문을 제공했을 때는 반드시 `Agent` 도구로 `webnovel-writer:deconstruction-agent`를 호출해야 하며, init 메인 플로우가 구두로 분석 결과를 대체해서는 안 된다.

```text
Agent(
  subagent_type: "webnovel-writer:deconstruction-agent",
  prompt: "reference_title={reference_title}; reference_source={reference_source}; reference_text_path={reference_text_path}; reference_text_excerpt={reference_text_excerpt}; analysis_mode={quick|deep|auto}; init_goal={현재 초기화 스토리 방향 또는 공란}; target_genre={장르 또는 공란}。init_reference_research JSON 객체만 반환하고, 어떤 파일도 쓰지 않으며, 디렉터리를 생성하지 않고, .story-system、.webnovel、settings、outline、manuscript、idea_bank.json、state.json 또는 어떤 canon/read model 파일도 작성하지 않는다."
)
```

처리 규칙:
- 사용자가 책 제목/플랫폼만 있고 텍스트나 발췌문이 없다면, 발췌문/경로 제공이 가능한지 먼저 물어본다. 제공할 수 없다면, 해당 참고작은 "방향 힌트"로만 활용하며 해당 책의 황금 3화, 캐릭터, 설정 또는 스토리 사실을 만들어내서는 안 된다.
- 반환된 `init_reference_research` JSON을 수신한 후, 그 안의 `reader_promise`、`opening_hook_patterns`、`cool_point_loops`、`protagonist_patterns`、`antagonist_pressure_patterns`、`pacing_notes`、`borrowable_structures`、`differentiation_requirements`、`init_candidates`、`quality`만 사용한다.
- 먼저 `quality`를 확인한다: `quality.passed=false`、`confidence < 0.85` 또는 `warnings`가 비어있지 않을 때, 후보를 창의 제약 패키지에 병합해서는 안 된다. 리스크와 보충이 필요한 자료만 사용자에게 확인을 위해 표시한다.
- `do_not_copy`와 `canon_contamination_warnings`는 반드시 알려진 정보 목록에 포함시키고, 이후 창의 생성의 레드라인으로 삼는다.
- Step 2-6에서는 사용자가 확인하고 본 작품의 차별화된 표현으로 변형된 패턴만 사용할 수 있다.
- 참고작의 캐릭터, 설정, 조직, 장소, 치트키, 스토리 사실을 그대로 생성 프로젝트 파일에 작성하는 것을 금지한다.

### Step 2: 스토리 코어와 상업적 포지셔닝

수집 항목 (필수):
- 제목 (우선 작업 제목을 줘도 됨)
- 장르 (A+B 복합 장르 지원)
- 목표 규모 (총 글자 수 또는 총 화 수)
- 한 줄 스토리
- 핵심 갈등
- 대상 독자/플랫폼

장르 집합 (정규화 및 매핑에 사용):
- 선선/현판류: 수선 | 시스템물 | 고무 | 서양 판타지 | 무한 루프 | 종말 | SF
- 도시/현대류: 도시 이능 | 도시 일상 | 도시 아이디어 | 현실 소재 | 다크 소재 | e스포츠 | 스트리밍 소설
- 로맨스류: 고전 로맨스 | 궁중/귀족 암투 | 청춘 달달 | 재벌 총수 | 직장 연애 | 민국 로맨스 | 판타지 로맨스 | 현대 로맨스 아이디어 | 여성향 미스터리 | 막장 로맨스 | 대역 소설 | 다자녀 | 전원 생활 | 시대물
- 특수 장르: 규칙 괴담 | 미스터리 아이디어 | 미스터리 공포 | 역사/고대 | 역사 아이디어 | 게임/스포츠 | 항일/첩보 | 지후 단편 | 크툴루

인터랙션 방식:
- 우선 사용자가 자유롭게 묘사하도록 하고, 그 후 재구조화하여 확인한다.
- 사용자가 막히면 2~4개의 후보 방향을 제시한다.

### Step 3: 캐릭터 골격과 관계 갈등

수집 항목 (필수):
- 주인공 이름
- 주인공 욕망 (원하는 것)
- 주인공 결함 (대가를 치르게 만드는 결함)
- 주인공 구조 (단독 주인공/다중 주인공)
- 로맨스 라인 설정 (없음/단독 히로인/다중 히로인)
- 빌런 계층 (소/중/대)과 미러 대립 한 줄 요약

수집 항목 (선택):
- 주인공 원형 태그 (성장형/복수형/천재형 등)
- 다중 주인공 역할 분담

### Step 4: 치트키와 구현 메커니즘

수집 항목 (필수):
- 치트키 유형 ("치트키 없음" 가능)
- 이름/시스템명 (없으면 공란)
- 스타일 (하드코어/유머/다크/절제 등)
- 가시성 (누가 아는지)
- 불가역적 대가 (반드시 대가가 있거나 "없음+이유" 명시)
- 성장 리듬 (슬로우 스타트/중속/빠른 페이스)

수집 항목 (조건부 필수):
- 시스템물일 경우: 시스템 성격, 레벨업 리듬
- 회귀물일 경우: 회귀 시점, 기억 완전도
- 전승/기영일 경우: 보조 범위와 개입 제한

### Step 5: 세계관과 파워 규칙

수집 항목 (필수):
- 세계 규모 (단일 도시/다중 구역/대륙/다중 세계)
- 파워 시스템 유형
- 세력 구도
- 사회 계층과 자원 분배

수집 항목 (장르 관련):
- 화폐 체계와 환산 규칙
- 문파/조직 계층
- 경지 체계와 소경지

### Step 6: 창의 제약 패키지 (차별화 핵심)

절차:
1. Step 1.5에서 확인된 영감 출처를 취합한다: 원창 아이디어, 참고작 분석 결과, 시장 트렌드, 장르 템플릿 또는 반클리셰 라이브러리.
2. 장르 매핑을 기반으로 반클리셰 라이브러리를 로딩한다 (최대 2개의 주요 관련 라이브러리).
3. 창의 패키지 2~3세트를 생성하며, 각 세트에 포함:
   - 한 줄 판매 포인트
   - 반클리셰 규칙 1개
   - 하드 제약 2~3개
   - 주인공 결함 드라이브 한 줄 요약
   - 빌런 미러 한 줄 요약
   - 오프닝 훅
4. 세 가지 질문 필터링:
   - 왜 이 장르는 반드시 이렇게 써야 하는가?
   - 평범한 주인공으로 바꾸면 무너지는가?
   - 판매 포인트를 한 줄로 명확히 설명할 수 있고 템플릿과 겹치지 않는가?
5. 5차원 점수를 표시하여 (`references/creativity/creativity-constraints.md`의 `8.1 5차원 점수` 참조) 사용자 결정을 돕는다.
6. 사용자가 최종 방안을 선택하거나 거부하고 이유를 제시한다.

비고:
- 사용자가 "현재 시장에 맞추기"를 요구하면 외부 검색을 트리거하고 타임스탬프를 표시할 수 있다.
- 참고작 분석을 사용했다면, 후보를 표시할 때 참고 출처, 변환 방식, 복사 불가 항목, 차별화 요건을 반드시 명시해야 한다. 사용자가 명확히 확인하기 전에는 `idea_bank.json`이나 어떤 생성 프로젝트 파일에도 쓰지 않는다.

### Step 7: 일관성 재술과 최종 확인

반드시 "초기화 요약 초안"을 출력하고 사용자에게 확인받아야 한다:
- 스토리 코어 (장르/한 줄 스토리/핵심 갈등)
- 주인공 코어 (욕망/결함)
- 치트키 코어 (능력과 대가)
- 세계 코어 (규모/파워/세력)
- 창의 제약 코어 (반클리셰 + 하드 제약)

확인 규칙:
- 사용자가 명확히 확인하지 않으면 생성을 실행하지 않는다.
- 사용자가 일부만 수정한 경우, 해당 Step으로 돌아가 최소한의 재수집을 진행한다.

## 내부 데이터 모델 (초기화 수집 객체)

```json
{
  "project": {
    "title": "",
    "genre": "",
    "target_words": 0,
    "target_chapters": 0,
    "one_liner": "",
    "core_conflict": "",
    "target_reader": "",
    "platform": ""
  },
  "protagonist": {
    "name": "",
    "desire": "",
    "flaw": "",
    "archetype": "",
    "structure": "단독 주인공"
  },
  "relationship": {
    "heroine_config": "",
    "heroine_names": [],
    "heroine_role": "",
    "co_protagonists": [],
    "co_protagonist_roles": [],
    "antagonist_tiers": {},
    "antagonist_level": "",
    "antagonist_mirror": ""
  },
  "golden_finger": {
    "type": "",
    "name": "",
    "style": "",
    "visibility": "",
    "irreversible_cost": "",
    "growth_rhythm": ""
  },
  "world": {
    "scale": "",
    "factions": "",
    "power_system_type": "",
    "social_class": "",
    "resource_distribution": "",
    "currency_system": "",
    "currency_exchange": "",
    "sect_hierarchy": "",
    "cultivation_chain": "",
    "cultivation_subtiers": ""
  },
  "constraints": {
    "anti_trope": "",
    "hard_constraints": [],
    "core_selling_points": [],
    "opening_hook": ""
  }
}
```

## 충분성 게이트 (반드시 통과해야 함)

다음 조건을 충족하기 전에는 `init_project.py` 실행을 금지한다:

1. 제목, 장르(복합 가능)가 확정되어야 한다.
2. 목표 규모를 계산할 수 있어야 한다(글자 수 또는 화 수 중 하나 이상).
3. 주인공 이름 + 욕망 + 결함이 완전해야 한다.
4. 세계 규모 + 파워 시스템 유형이 완전해야 한다.
5. 치트키 유형이 확정되어야 한다("치트키 없음" 허용).
6. 창의 제약이 확정되어야 한다:
   - 반클리셰 규칙 1개
   - 하드 제약 최소 2개
   - 또는 사용자가 명확히 거부하고 이유를 기록.

## 프로젝트 디렉터리 안전 규칙 (필수)

- `project_root`는 반드시 제목 안전화를 통해 생성해야 한다(불법 문자 제거, 공백을 `-`로 변환).
- 구성 공식: `project_root = <현재 작업 디렉터리>/<제목 안전화 결과>`, 즉 `PROJECT_ROOT="${WORKSPACE_ROOT}/${PROJECT_SLUG}"`.
- 안전화 결과가 비어있거나 `.`으로 시작하면 자동으로 `proj-` 접두사를 붙인다.
- 플러그인 디렉터리 아래에 프로젝트 파일을 생성하는 것을 금지한다(`${CLAUDE_PLUGIN_ROOT}`).
- `WORKSPACE_ROOT`를 직접 `PROJECT_ROOT`로 사용하는 것을 금지한다. 단, 사용자가 현재 디렉터리 자체가 책 프로젝트 루트임을 명확히 지정한 경우는 예외.
- 초기화 전에 반드시 표시하고 확인해야 한다:
  - `WORKSPACE_ROOT`
  - `PROJECT_SLUG`
  - `PROJECT_ROOT`

권장 안전화 명령 (규칙과 일치):

```bash
PROJECT_SLUG="$(python -X utf8 -c "import re,sys; title=sys.argv[1].strip(); slug=re.sub(r'[\\\\/:*?\"<>|]+','',title); slug=re.sub(r'\\s+','-',slug).strip('-'); print(('proj-' + slug) if (not slug or slug.startswith('.')) else slug)" "{title}")"
PROJECT_ROOT="${WORKSPACE_ROOT}/${PROJECT_SLUG}"
echo "WORKSPACE_ROOT=${WORKSPACE_ROOT}"
echo "PROJECT_SLUG=${PROJECT_SLUG}"
echo "PROJECT_ROOT=${PROJECT_ROOT}"
```

## 생성 실행

### 1) 초기화 스크립트 실행

```bash
python "${SCRIPTS_DIR}/webnovel.py" init \
  "${PROJECT_ROOT}" \
  "{title}" \
  "{genre}" \
  --protagonist-name "{protagonist_name}" \
  --target-words {target_words} \
  --target-chapters {target_chapters} \
  --golden-finger-name "{gf_name}" \
  --golden-finger-type "{gf_type}" \
  --golden-finger-style "{gf_style}" \
  --core-selling-points "{core_points}" \
  --protagonist-structure "{protagonist_structure}" \
  --heroine-config "{heroine_config}" \
  --heroine-names "{heroine_names}" \
  --heroine-role "{heroine_role}" \
  --co-protagonists "{co_protagonists}" \
  --co-protagonist-roles "{co_protagonist_roles}" \
  --antagonist-tiers "{antagonist_tiers}" \
  --world-scale "{world_scale}" \
  --factions "{factions}" \
  --power-system-type "{power_system_type}" \
  --social-class "{social_class}" \
  --resource-distribution "{resource_distribution}" \
  --gf-visibility "{gf_visibility}" \
  --gf-irreversible-cost "{gf_irreversible_cost}" \
  --currency-system "{currency_system}" \
  --currency-exchange "{currency_exchange}" \
  --sect-hierarchy "{sect_hierarchy}" \
  --cultivation-chain "{cultivation_chain}" \
  --cultivation-subtiers "{cultivation_subtiers}" \
  --protagonist-desire "{protagonist_desire}" \
  --protagonist-flaw "{protagonist_flaw}" \
  --protagonist-archetype "{protagonist_archetype}" \
  --antagonist-level "{antagonist_level}" \
  --target-reader "{target_reader}" \
  --platform "{platform}"
```

### 2) `idea_bank.json` 작성

`.webnovel/idea_bank.json`에 작성:

```json
{
  "selected_idea": {
    "title": "",
    "one_liner": "",
    "anti_trope": "",
    "hard_constraints": []
  },
  "constraints_inherited": {
    "anti_trope": "",
    "hard_constraints": [],
    "protagonist_flaw": "",
    "antagonist_mirror": "",
    "opening_hook": ""
  }
}
```

### 3) 마스터 대강 패치

반드시 보완해야 할 항목:
- 스토리 한 줄 요약
- 핵심 메인 플롯 / 핵심 서브 플롯
- 창의 제약 (반클리셰, 하드 제약, 주인공 결함, 빌런 미러)
- 빌런 계층
- 핵심 사이다 마일스톤 (2~3개)

### 4) 집필 전 계약 트리 생성 (Story System 초기화)

init 완료 후 즉시 MASTER_SETTING을 생성하여, 이후 plan 단계에서 톤/금기 참조가 가능하도록 한다:

```bash
GENRE="$(python -X utf8 -c "import json,os; root=os.environ['PROJECT_ROOT']; s=json.load(open(root + '/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  story-system "${GENRE}" --genre "${GENRE}" --persist --format json
```

설명:
- 이 시점에는 `--chapter`를 전달하지 않고, `MASTER_SETTING.json`과 `anti_patterns.json`만 생성한다
- `--emit-runtime-contracts`를 전달하지 않는다(권/화 레벨 데이터가 아직 없음)
- plan 단계에서 구체적인 화까지 분해할 때 volume/chapter/review 계약을 생성한다

## 검증과 전달

실행 확인:

```bash
test -f "${PROJECT_ROOT}/.webnovel/state.json"
find "${PROJECT_ROOT}/settings" -maxdepth 1 -type f -name "*.md"
test -f "${PROJECT_ROOT}/outline/総纲.md"
test -f "${PROJECT_ROOT}/.webnovel/idea_bank.json"
test -f "${PROJECT_ROOT}/.story-system/MASTER_SETTING.json"
test "$(basename "${PROJECT_ROOT}")" = "${PROJECT_SLUG}"
```

성공 기준:
- `state.json`이 존재하고 핵심 필드가 비어있지 않아야 한다(title/genre/target_words/target_chapters).
- 설정집 핵심 파일이 존재해야 한다: `세계관.md`、`파워시스템.md`、`주인공카드.md`.
- 단독 주인공 프로젝트에서는 `주인공그룹.md`를 생성하지 않는다. `heroine_config=无女主`이면 `여주카드.md`를 생성하지 않는다.
- 기본적으로 `치트키설계.md`、`복합장르-융합로직.md`、`사이다기획.md` 또는 빈 `캐릭터라이브러리/아이템라이브러리/기타설정` 디렉터리를 생성하지 않는다. 이 정보는 주인공 카드, 세계관, 권 대강이 사실 소스다.
- `마스터아웃라인.md`에 핵심 메인 플롯과 제약 필드가 채워져 있어야 한다.
- `idea_bank.json`이 작성되었고 최종 선택된 방안과 일치해야 한다.
- `.story-system/MASTER_SETTING.json`이 존재하고 `route.primary_genre`가 비어있지 않아야 한다.

## 금지된 쓰기 경로 (필수)

사용자 확인 전에는 어떤 파일도 쓰지 않는다. 금지된 경로 목록 (레거시 중국어 토큰도 함께 유지):
- `settings/` (설정집 / 设定集)
- `outline/` (대강 / 大纲)
- `manuscript/` (원고 / 正文)
- `idea_bank.json`
- `.story-system`
- `.webnovel/state.json`
- 또는 다른 어떤 canon/read model 파일

## 실패 처리 (최소 롤백)

트리거 조건:
- 핵심 파일 누락;
- 마스터 대강 핵심 필드 누락;
- 제약이 활성화되었지만 `idea_bank.json`이 없거나 내용이 일치하지 않음.

복구 절차:
1. 누락된 필드만 보완하고, 전체를 다시 묻지 않는다.
2. 최소 단계만 재실행:
   - 파일 누락 → `init_project.py` 재실행;
   - 마스터 대강 필드 누락 → 마스터 대강만 패치;
   - idea_bank 불일치 → 해당 파일만 재작성.
3. 재검증하고, 모두 통과하면 종료한다.
