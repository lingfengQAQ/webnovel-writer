---
name: webnovel-plan
description: 마스터 아웃라인을 기반으로 권 아웃라인·타임라인·화별 아웃라인을 생성하고, 새로 추가된 설정을 기존 설정집에 증분 반영합니다.
---

# Outline Planning

## 목표

- 마스터 대강을 기반으로 권 대강, 타임라인, 화별 대강을 세분화하되 전체 스토리를 다시 만들지 않는다.
- 먼저 설정 기준선을 보완하고, 그 다음 바로 집필에 들어갈 수 있는 화별 대강을 산출한다.
- 권 대강 완성 후, 새로 추가된 설정을 기존 설정집에 증분 반영한다.
- 상세 대강을 "구조화된 상세 대강"으로 업그레이드하여 다운스트림 집필에 중간 레벨 플롯 구조를 제공한다.

## 실행 원칙

1. 증분 보완만 수행하며, 전체 마스터 대강이나 설정집을 다시 쓰지 않는다.
2. 먼저 권 레벨 리듬을 고정하고, 그 다음 화를 일괄 분해한다.
3. 타임라인은 하드 제약이므로, 모든 화별 대강에 반드시 시간 필드가 있어야 한다.
4. 마스터 대강과 설정이 충돌하면 먼저 차단하고 사용자 판단을 기다린다.
5. 구조화 노드는 집필 실행을 위한 것이며, 언어학적으로 엄격한 SVO 추출을 추구하지 않는다.

## 흔한 오류

- ❌ 화를 먼저 분해하고 나서 권 레벨 목표를 생각하는 것
- ❌ 타임라인 필드가 없는데도 화 분해를 계속하는 것
- ❌ 구조화 노드를 공허한 요약 문장으로 작성하는 것
- ❌ 모든 reference를 한 번에 다 읽고 나서 기획을 시작하는 것
- ❌ 설정 충돌을 발견했는데도 차단하지 않고 화별 대강을 계속 산출하는 것

## 우선순위 체인

1. 사용자 명시 요구 (최고)
2. 마스터 대강의 핵심 갈등과 권말 클라이맥스 (이탈 불가)
3. 타임라인 하드 제약 (단조 증가, 카운트다운 정확)
4. 스킬 기본 플로우
5. reference 권고 (최저)

## 결정 트리 진입점

- 프로젝트 루트가 유효하지 않거나 마스터 대강이 없으면 → **차단**
- 마스터 대강에 권명/화 범위/핵심 갈등/권말 클라이맥스가 없으면 → **차단**, 사용자에게 보완 요청
- Step 2에서 설정 충돌 발견 시 → **BLOCKER 표시**, 사용자 판단 대기
- 화 일괄 분해 시 시간이 역행하고 플래시백 표시가 없으면 → 현재 배치 **차단**
- Step 9 검증 실패 시 → 실패한 배치만 재작업하고, 전체 권을 덮어쓰지 않음

## 환경 준비

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" placeholder-scan --format text
```

이번 기획이 구체적인 화까지 직접 다루는 경우, 먼저 Story System 런타임 계약을 갱신해야 한다:

```bash
# genre는 state.json의 초기화 설정 스냅샷에서 읽는다. 집필 메인 체인의 진짜 소스는 .story-system 계약 트리다.
# 반드시 먼저 상세 대강에서 실제 CHAPTER_GOAL을 파싱해야 하며, {화별대강목표} / 제N화 대강목표 같은 플레이스홀더를 전달하는 것을 금지한다.
GENRE="$(python -X utf8 -c "import json,sys; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

생성 후 반드시 `.story-system/MASTER_SETTING.json`、`.story-system/volumes/`、
`.story-system/chapters/`、`.story-system/reviews/`를 이후 집필 메인 체인 입력으로 취급해야 한다.
기획 시작/종료 시 모두 `placeholder-scan`을 실행한다. plan 단계에서 플레이스홀더가 발견되면 먼저 경고하고 관련 파일을 보완한다. 화 집필 진입 전에는 현재 화 관련 엔티티의 `[미정...]` / `임시명` / `{플레이스홀더}`를 남겨두어서는 안 된다.
매 권 기획 완료 후, `outline/마스터아웃라인.md`에 다음 권의 개요와 본 권에서 새로 추가/승계된 복선만 점진적으로 추가하며, init 단계에서 V2-V20 빈 표를 미리 채우지 않는다.
기획 완료 후 반영은 반드시 명시적 구조화 파일 `outline/제{volume_id}권-마스터반영.json`에서 와야 하며, 권 대강 자유 텍스트에서 복선이나 열린 고리를 자유롭게 추론하는 것을 금지한다.

## 참조 로딩 전략

### 필수 읽기 md

| Step | Trigger | Reference |
|------|---------|-----------|
| Step 4 | always | `templates/output/大纲-卷节拍表.md` |
| Step 5 | always | `templates/output/大纲-卷时间线.md` |
| Step 6 | always | `../../references/genre-profiles.md` |
| Step 6 | always | `../../references/shared/strand-weave-pattern.md` |
| 화별 대강 분해 | always | `../../references/outlining/plot-signal-vs-spoiler.md` |

### 조건부 읽기 md

| Step | Trigger | Reference |
|------|---------|-----------|
| Step 6 | 사이다 설계 필요 시 | `../../references/shared/cool-points-guide.md` |
| Step 6/7 | 갈등 설계 필요 시 | `references/outlining/conflict-design.md` |
| Step 7 | 추독력 분석 필요 시 | `../../references/reading-power-taxonomy.md` |
| Step 7 | 화별 대강 세분화 필요 시 | `references/outlining/chapter-planning.md` |
| Step 6/7 | 특정 장르 리듬 | `references/outlining/genre-volume-pacing.md` |

### CSV 검색

| Step | Trigger | 검색 명령 |
|------|---------|---------|
| 권 레벨 기획 | always | `python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 场景写法 --query "卷级结构 叙事功能"` |
| 화별 대강 분해 | 새 캐릭터 등장 시 | `... --skill plan --table 命名规则 --query "角色命名" --genre {장르}` |

## 실행 플로우

### Step 1: 프로젝트 데이터 로딩 및 전제 조건 확인

**반드시 로딩해야 함**:

```bash
# 프로젝트 설정/상태 프로젝션 (호환 읽기, 집필 후 사실 진짜 소스로 사용하지 않음)
cat "$PROJECT_ROOT/.webnovel/state.json"

# 마스터 대강 (전체 블루프린트)
cat "$PROJECT_ROOT/outline/마스터아웃라인.md"

# 장르 (init 설정 스냅샷에서, 이후 CSV 검색과 판단 매칭에 이 값 사용)
GENRE="$(python -X utf8 -c "import json; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"
```

**기존 권의 플롯 상태** (권 간 기획 시 반드시 로딩):

이미 완성된 권이 있으면 (`.webnovel/summaries/` 아래에 파일이 있으면), 다음 데이터를 로딩하여 기작성 내용을 파악한다:

```bash
# 최근 5화 요약 (플롯 흐름 파악)
for ch in $(seq $((START_CH - 5)) $((START_CH - 1))); do
  cat "$PROJECT_ROOT/.webnovel/summaries/ch$(printf '%04d' $ch).md" 2>/dev/null
done

# 핵심 캐릭터 현재 상태
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  knowledge query-entity-state --entity "{protagonist_id}" --at-chapter {이전 권 마지막 화}

# 핵심 관계 현재 상태
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  knowledge query-relationships --entity "{protagonist_id}" --at-chapter {이전 권 마지막 화}

# 활성 복선 (권 간 미회수 복선)
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  memory-contract get-open-loops
```

**CSV 창작 참조** (권 레벨 기획 시 필요에 따라 검색):

```bash
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 爽点与节奏 --query "{권 레벨 핵심 갈등}" --genre "${GENRE}"
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 桥段套路 --query "{권 레벨 핵심 갈등}" --genre "${GENRE}"
```

**필요에 따라 읽기** (설정집):
- `settings/세계관.md`
- `settings/파워시스템.md`
- `settings/주인공카드.md`
- `settings/빌런설계.md`
- `.webnovel/idea_bank.json`

차단 조건:
- 마스터 대강에 권명, 화 범위, 핵심 갈등 또는 권말 클라이맥스가 없을 때

### Step 2: 설정 기준선 보완

목표: 설정집을 골격 템플릿 상태에서 "기획 가능, 집필 가능" 상태로 전환한다.

반드시 보완해야 할 항목:
- `settings/세계관.md`: 세계 경계, 사회 구조, 핵심 장소 용도
- `settings/파워시스템.md`: 경지 체계, 제한, 대가와 쿨다운
- `settings/주인공카드.md`: 욕망, 결함, 초기 자원과 제한
- `settings/빌런설계.md`: 소/중/대 빌런 계층과 미러 관계

하드 규칙:
- 증분 보완만 수행하고, 전체 파일을 비우거나 다시 쓰지 않는다
- 충돌 발견 시 충돌 목록을 먼저 나열하고 차단한다

### Step 3: 목표 권 선택 및 범위 확인

반드시 확인해야 할 항목:
- 권명
- 화 범위
- 핵심 갈등
- 특수 요구 사항 여부 (시점, 감정 라인, 장르 변화 등)

### Step 4: 권 비트 시트 생성

실행 전 템플릿 로딩:

```bash
cat "${SKILL_ROOT}/../../templates/output/大纲-卷节拍表.md"
```

하드 요구사항:
- 반드시 중간 반전을 작성해야 한다. 실제로 없다면 "없음 (이유: ...)"으로 적는다
- 위기 체인은 최소 3번 점층적으로 고조되어야 한다
- 권말 새 훅은 반드시 마지막 화의 화말 미결 문제로 연결될 수 있어야 한다

출력 파일: `outline/제{volume_id}권-비트시트.md`

### Step 5: 권 타임라인 표 생성

실행 전 템플릿 로딩:

```bash
cat "${SKILL_ROOT}/../../templates/output/大纲-卷时间线.md"
```

하드 요구사항:
- 반드시 시간 체계를 명확히 해야 한다
- 반드시 본 권의 시간 범위를 명확히 해야 한다
- 카운트다운 이벤트가 있을 때 반드시 나열하고 D-N으로 표시해야 한다

출력 파일: `outline/제{volume_id}권-타임라인.md`

### Step 6: 권 대강 골격 생성

반드시 로딩해야 함:

```bash
cat "${SKILL_ROOT}/../../references/genre-profiles.md"
cat "${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md"
```

필요에 따라 로딩:

```bash
cat "${SKILL_ROOT}/../../references/shared/cool-points-guide.md"
cat "${SKILL_ROOT}/references/outlining/conflict-design.md"
cat "${SKILL_ROOT}/references/outlining/genre-volume-pacing.md"
cat "$PROJECT_ROOT/.webnovel/idea_bank.json"
```

권 대강에 반드시 명확히 해야 할 항목:
- 권 요약
- 핵심 인물과 빌런 계층
- Strand 분포
- 사이다 밀도 기획
- 복선 기획
- 제약 트리거 기획

권 간 일관성 검사 (첫 권이 아닐 때 반드시 실행):
- 이전 권에서 미회수된 복선은 새 권의 복선 기획에 반드시 등장해야 한다 (계속 추진하거나 회수 표시)
- 캐릭터 관계 변화는 반드시 이어받아야 한다 (이전 권에 아무 일도 없었던 것처럼 할 수 없음)
- 주인공의 능력/경지는 반드시 이어받아야 한다 (후퇴하거나 단계를 건너뛸 수 없음, 플롯 설명이 있는 경우 제외)

### Step 7: 화별 대강 일괄 생성

배치 규칙:
- 기본 `10화/배치`
- 복잡한 장르나 다중 라인 병행 시 `8화/배치`로 줄일 수 있음
- 단순 레벨업 물은 `12화/배치`로 늘릴 수 있음
- 단일 배치 `12화` 초과는 권장하지 않음

필요에 따라 로딩:

```bash
cat "${SKILL_ROOT}/../../references/reading-power-taxonomy.md"
cat "${SKILL_ROOT}/references/outlining/chapter-planning.md"
```

각 화에 반드시 포함해야 할 항목:
- 목표
- 저항
- 대가
- 시간 앵커
- 화 내 시간 범위
- 이전 화와의 시간 차
- 카운트다운 상태
- 사이다
- Strand
- 빌런 계층
- 시점/주인공
- 핵심 엔티티
- 이번 화 변화
- 화말 미결 문제
- 훅
- `화 시작점 (CBN)`
- `추진 노드 (CPNs)`
- `화 종점 (CEN)`
- `반드시 커버할 노드`
- `이번 화 금지 구역`

#### 구조화 노드 규범

노드 형식 통일:

`주체 | 행동/변화 | 대상/결과`

설명:
- 여기서의 노드는 집필 실행 골격이며, 엄격한 언어학적 SVO를 추구하지 않는다.
- `행동/변화`는 행동, 판단, 인식 변화, 또는 상태 전이를 표현할 수 있다.
- `대상/결과`는 사람, 사물, 장소일 수도 있고 결과 상태일 수도 있다.

예시:
- `소염 | 도착 | 가남학원 입구`
- `소염 | 시연 | 이화 제어력`
- `약로 | 소염에게 | 명확한 관심 형성`
- `소염 | 인식 | 학원 시험이 예상보다 훨씬 엄격함`

구조 규칙:
- 각 화 고정 `1개 CBN`
- 각 화 `2~4개 CPN`
- 각 화 고정 `1개 CEN`
- 인접한 화의 `CEN → 다음 화 CBN`은 반드시 논리적으로 이어져야 함 (첫 화와 마지막 화 제외)
- `CPNs`는 반드시 시간 순서로 나열해야 함

반드시 커버할 노드 규칙:
- 각 화 반드시 커버할 노드는 최대 `4`개
- 권장 구성: `CBN + CEN + 핵심 CPN 1~2개`
- 선택 노드는 집필 제안으로만 활용하며, fail의 주요 근거로 삼아서는 안 됨

이번 화 금지 구역 규칙:
- `5`개를 초과하지 않음
- 이번 화에 절대 일어나서는 안 되는 하드 금지 구역만 작성
- 스타일 관련 제안이나 공허한 서술을 쓰지 않음

하위 호환:
- 구 프로젝트 화별 대강에 `CBN/CPNs/CEN/반드시 커버할 노드/이번 화 금지 구역` 필드가 없는 경우, 다운스트림 플로우는 정상 실행하되 구조화 검사만 건너뜀

출력 파일: `outline/제{volume_id}권-상세대강.md`

### Step 8: 새로 추가된 설정을 기존 설정집에 반영

입력 소스:
- 권 비트 시트
- 권 타임라인 표
- 권 상세 대강
- 기존 설정집 파일

반영 규칙:
- 관련 단락만 증분 보완한다
- 새 캐릭터는 캐릭터 카드 또는 캐릭터 그룹에 작성한다
- 새 세력, 장소, 규칙은 세계관 또는 파워 체계에 작성한다
- 새 빌런 계층은 빌런 설계에 작성한다

하드 규칙:
- 마스터 대강 또는 기존 설정과 충돌이 발견되면 `BLOCKER`를 표시하고 이후 업데이트를 중단한다

### Step 9: 검증, 저장 및 상태 업데이트

다음 검사를 반드시 통과해야 한다:
- 비트 시트가 존재하고 비어있지 않음
- 타임라인 표가 존재하고 비어있지 않음
- 상세 대강이 존재하고 비어있지 않음
- 각 화 시간 필드가 모두 완전함
- 타임라인이 단조 증가함
- 카운트다운이 올바르게 추진됨
- 새 설정이 기존 설정집에 반영됨
- `BLOCKER=0`
- 노드가 있을 때, 인접한 화의 `CEN → CBN`에 명백한 논리 충돌이 없음
- 노드가 있을 때, 각 화 반드시 커버할 노드가 `4`개를 초과하지 않음

모든 검증을 통과한 후, 명시적 구조화 반영 파일을 생성한다:

```json
{
  "next_volume_anchor": {
    "volume": 2,
    "volume_name": "다음 권명",
    "core_conflict": "다음 권 핵심 갈등",
    "volume_end_climax": "다음 권 권말 클라이맥스"
  },
  "foreshadow_writeback": [
    {"content": "본 권 기획에서 명확히 새로 추가된 복선", "buried_chapter": "제10화", "payoff_chapter": "", "level": "권 레벨"}
  ],
  "open_loop_writeback": [
    {"content": "본 권 종료 후에도 계속 열려있는 문제", "buried_chapter": "", "payoff_chapter": "", "level": "지속 열린 고리"}
  ]
}
```

기획 과정에서 명시적으로 나열된 구조화 복선/열린 고리만 작성이 허용된다. 자유 텍스트의 암시를 정리해서 넣지 않는다. 그 후 최소 마스터 대강 반영을 실행한다:

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" master-outline-sync \
  --volume {volume_id} \
  --writeback-file "outline/제{volume_id}권-마스터반영.json" \
  --format text
```

이 단계는 `outline/마스터아웃라인.md`의 V+1 권명 / 핵심 갈등 / 권말 클라이맥스와 복선 표만 업데이트할 수 있으며, 다음 권의 상세 대강, 비트 시트, 타임라인 또는 화별 대강을 생성해서는 안 된다.

상태 업데이트:

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" update-state -- \
  --volume-planned {volume_id} \
  --chapters-range "{start}-{end}"
```

## 하드 실패 조건

- 비트 시트가 없거나 비어있음
- 중간 반전이 없고 이유도 제시되지 않음
- 타임라인 표가 없거나 비어있음
- 상세 대강이 없거나 비어있음
- 어느 화든 시간 필드가 누락됨
- 시간이 역행하고 플래시백 표시가 없음
- 카운트다운 산술 충돌
- 마스터 대강의 핵심 갈등 또는 권말 클라이맥스와 명백히 충돌
- 미판단된 `BLOCKER`가 존재

## 복구 규칙

1. 실패한 배치만 재작업하고, 전체 권 파일을 덮어쓰지 않는다.
2. 마지막 배치가 유효하지 않을 때, 해당 배치만 삭제하고 재작성한다.
3. 모든 검증을 통과한 후에만 상태를 업데이트한다.
