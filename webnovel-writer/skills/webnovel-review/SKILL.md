---
name: webnovel-review
description: 심사 Agent로 화별 품질을 평가하고 보고서를 생성하며 심사 지표를 기록합니다.
allowed-tools: Read Grep Write Edit Bash Agent AskUserQuestion
---

# Quality Review Skill

## 목표

- 실제 책 프로젝트 루트 디렉터리를 파싱하여 통일된 플로우로 화 심사를 완료한다.
- 통일된 `reviewer`를 호출하여 구조화된 문제 목록과 심사 보고서를 생성한다.
- 심사 지표를 `index.db`에 기록하고, 심사 기록을 `.webnovel/state.json` 호환 프로젝션에 저장한다. 메인 체인의 사실 진실 출처는 여전히 review 컨트랙트와 accepted `CHAPTER_COMMIT`이다.
- 심사 시 `.story-system/reviews/chapter_{NNN}.review.json`과 latest accepted `CHAPTER_COMMIT`을 우선적으로 메인 체인 사실 판단 기준으로 삼는다.
- 심각한 문제가 존재할 경우, 즉시 재작업 여부를 사용자에게 명확하게 결정하도록 넘긴다.

## 흔한 실수

- ❌ reviewer 원시 JSON을 확인하지 않고 바로 구두로 요약
- ❌ blocking issue가 있음에도 플로우를 통과로 간주
- ❌ 보고서 파일 생성을 DB 저장 완료로 간주(`save-review-metrics` 미실행)
- ❌ 메인 플로우가 `overall_score` 또는 심사 결론을 위조
- ❌ 필요 시 참고 자료를 한꺼번에 전부 읽기

## 우선순위 체인

1. 사용자 명시적 요구(최고)
2. `blocking=true` 하드 임계값
3. 프로젝트 고유 제약(설정집, 기존 스토리)
4. skill 기본 플로우
5. reference 권고(최저)

## 의사결정 트리 진입점

- 프로젝트 루트가 유효하지 않거나 `.webnovel/state.json`이 없으면 → **차단**
- 원고 파일이 존재하지 않으면 → **차단**
- reviewer가 `blocking=true` issue를 반환하면 → Step 6 사용자 판단으로 진입
- 모든 issue가 non-blocking이면 → 정상 DB 저장, 플로우 종료

## 실행 플로우

### Step 1: 프로젝트 루트 디렉터리 파싱 및 환경 변수 설정

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

대상 화에 runtime 컨트랙트가 누락된 경우, 먼저 보완한다:

```bash
GENRE="$(python -X utf8 -c "import json,sys; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

요건:
- `PROJECT_ROOT`에는 반드시 `.webnovel/state.json`이 포함되어야 한다
- 주요 디렉터리가 하나라도 존재하지 않으면 즉시 차단
- `CHAPTER_GOAL`은 반드시 상세 대강의 실제 목표에서 가져와야 한다. `chapter_brief.meta.query`가 여전히 `{챕터 목표}` / `제N화 챕터 목표`인 경우 시스템 문제로 기록한다.
- 중간 심각도 이상의 `ai_flavor` issue는 review-pipeline에 의해 `.story-system/anti_patterns.json`으로 피드백되어, 이후 화 집필 시 회피 패턴으로 활용된다.

### Step 2: 참고 자료 필요 시 로드

#### md 필수 읽기

| 트리거 | Reference |
|---------|-----------|
| always | `../../references/shared/core-constraints.md` |
| always | `../../references/review-schema.md` |

#### md 필요 시

| 트리거 | Reference |
|---------|-----------|
| 심사에 사이다 또는 훅 분석이 포함될 때 | `../../references/shared/cool-points-guide.md` |
| 심사에 다중 플롯 교차가 포함될 때 | `../../references/shared/strand-weave-pattern.md` |
| ai_flavor issue ≥ 3 | `../../skills/webnovel-write/references/anti-ai-guide.md` |
| blocking issue로 사용자 판단이 필요할 때 (Step 6) | `../../references/review/blocking-override-guidelines.md` |

### Step 3: 프로젝트 프로젝션 상태와 심사 대상 원고 로드

```bash
cat "${PROJECT_ROOT}/.webnovel/state.json"
```

요건:
- 현재 화 번호와 대응하는 원고 파일을 명확히 확인한다
- 원고 또는 호환 상태 파일이 누락된 경우 즉시 차단

### Step 4: 통일 심사 Agent 호출

반드시 `Agent` 도구로 `reviewer`를 호출해야 하며, 메인 플로우가 결론을 위조하거나 subagent 출력을 구두로 대체하는 것을 금지한다.

```text
Agent(
  subagent_type: "webnovel-writer:reviewer",
  prompt: "chapter={chapter_num}; chapter_file={chapter_file}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}。严格输出 reviewer schema JSON，并保存到 ${PROJECT_ROOT}/.webnovel/tmp/review_results.json。"
)
```

입력:
- `chapter`
- `chapter_file`
- `project_root`
- `scripts_dir`

출력 제약:
- JSON만 출력한다
- 각 issue에는 반드시 `evidence`가 있어야 한다
- `overall_score`는 출력하지 않는다

중간 산출물 규약:
- reviewer 원시 결과: `${PROJECT_ROOT}/.webnovel/tmp/review_results.json`
- DB 저장 지표: `${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json`

### Step 5: 심사 보고서 생성 및 DB 저장

보고서 저장 경로: `reviews/제{chapter_num}화심사보고서.md`

보고서 구조:
- 총람(문제 수 / 차단 수)
- 차단 문제
- 기타 문제
- 수정 방향

표준 파일 플로우:

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" review-pipeline \
  --chapter {chapter_num} \
  --review-results "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --metrics-out "${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json" \
  --report-file "reviews/제{chapter_num}화심사보고서.md"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index save-review-metrics \
  --data "@${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json"
```

요건:
- `review-pipeline`이 생성한 `review_metrics.json`은 `review_metrics` 테이블에 직접 쓸 수 있어야 한다
- 차단 판단 기준은 reviewer 원시 결과의 `blocking=true`다

### Step 6: 호환 심사 기록 저장 및 차단 처리

먼저 호환 심사 기록을 저장한다(read-model/projection이며, 사후 사실 진실 출처가 아님):

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" update-state -- --add-review "{chapter_num}-{chapter_num}" "reviews/제{chapter_num}화심사보고서.md"
```

`blocking=true` 문제가 하나라도 존재하면, 반드시 `AskUserQuestion`을 사용하여 사용자에게 물어야 한다:
- 즉시 수정
- 보고서만 저장하고 나중에 처리

사용자가 즉시 수정을 선택한 경우:
- 재작업 목록을 출력한다
- 사용자의 명시적 승인 하에 최소한의 수정을 진행한다

사용자가 나중에 처리하기를 선택한 경우:
- 보고서와 지표 기록을 보존하고 플로우를 종료한다

## 성공 기준

1. 실제 책 프로젝트 루트 디렉터리가 파싱되었다.
2. `reviewer`를 통해 구조화된 문제 JSON이 출력되었다.
3. 심사 보고서가 생성되었다.
4. `review_metrics`가 `index.db`에 저장되었다.
5. 심사 기록이 `.webnovel/state.json` 호환 프로젝션에 저장되었다.
6. 차단 문제가 존재할 경우, 사용자가 처리 전략을 명확히 선택했다.
