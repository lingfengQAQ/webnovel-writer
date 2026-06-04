---
name: webnovel-write
description: 발행 가능한 화를 생성하며 컨텍스트→초고→심사→윤문→커밋→백업을 전 과정 수행합니다.
allowed-tools: Read Write Edit Grep Bash Agent
---

# 화 집필 플로우

## 목표

발행 가능한 화를 `manuscript/ch{NNNN}-{제목}.md`에 출력한다. 기본 ~5,000자이며, 사용자 또는 대강에 별도 요건이 있을 경우 그에 따른다.

## 모드

| 모드 | 플로우 |
|------|------|
| 기본 | Step 1→2→3→4→5→6 |
| `--fast` | Step 1→2→3(경량)→4→5→6 |
| `--minimal` | Step 1→2→4(타입세팅만)→5→6 |

## 하드 규칙

- 단계 병합·생략·심사 위조 금지
- 지정된 subagent는 반드시 `Agent` 도구로 호출해야 하며, 메인 플로우가 subagent 출력을 말로 대체해서는 안 된다
- blocking issue가 해소되지 않으면 Step 4/5로 진입 불가
- 실패 시 실패한 단계만 재실행하며, 이전 단계로 되돌리지 않는다
- 참고 자료는 단계별로 필요할 때만 로드한다

## 우선순위

사용자 요구 > 상태 머신 하드 임계값 > 프로젝트 제약(총설/설정/메모리) > skill 플로우 > reference 권고

## CSV 검색 (Step 2 필요 시)

```bash
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill write --table {표名} --query "{키워드}" --genre {장르}
```

트리거 조건: 신규 캐릭터→명명 규칙, 전투→장면 묘사법, 다중 캐릭터 대화→집필 기법, 감정 묘사→집필 기법, 자주 쓰이는 브리지 장면→장면 묘사법.

## 실행 플로우

### 준비: 사전 점검

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:?}/skills/webnovel-write"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" preflight
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" placeholder-scan --format text
```

### 준비: 컨트랙트 트리 갱신

장르는 `.webnovel/state.json`의 초기화 설정 스냅샷에서 읽어 컨트랙트 트리를 갱신하는 데 사용한다. 집필 전 메인 체인의 진실 출처는 여전히 `.story-system/` 컨트랙트다. story-system 호출 전에 반드시 상세 대강에서 실제 본화 목표를 파싱해야 하며, `{챕터 목표}`, `제N화 챕터 목표` 등의 자리 표시자를 query로 전달하는 것을 금지한다.

```bash
GENRE="$(python -X utf8 -c "import json,sys; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

필수 파일: `MASTER_SETTING.json`(톤/금기), `volume_{NNN}.json`(권 단위 리듬), `chapter_{NNN}.review.json`(필수 노드/금지 구역). 누락 시 차단.

`chapter_{NNN}.json`은 최상위의 `chapter_directive`를 반드시 우선 확인해야 한다. `chapter_focus`는 오직 `chapter_directive.goal` 또는 실제 query에서만 가져와야 하며, `dynamic_context`의 참고 요약에서 상속하는 것을 금지한다.

집필 작업지시서의 정렬 순서는 반드시 다음으로 고정한다:
1. 본화 하드 제약: `chapter_directive.goal/time_anchor/chapter_span/countdown/chapter_end_open_question`
2. CBN/CPNs/CEN과 `must_cover_nodes`
3. 본화 금지 구역: `forbidden_zones`, 위반 시 불통과
4. 스타일 지침: reasoning, 주인공 OOC 경보, anti_patterns
5. 장면 묘사 보완: `dynamic_context`, 스타일 참고 용도로만 사용하며 챕터 목표 제약을 덮어쓸 수 없다

### Step 1: context-agent가 집필 작업지시서 생성

반드시 `Agent` 도구로 `context-agent`를 호출해야 하며, 메인 플로우가 직접 작업지시서를 정리하는 것을 금지한다.

```text
Agent(
  subagent_type: "webnovel-writer:context-agent",
  prompt: "chapter={chapter_num}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}; storage_path=${PROJECT_ROOT}/.webnovel; state_file=${PROJECT_ROOT}/.webnovel/state.json（projection/read-model，仅兼容读取）。先 research，再按 본화 하드 제약→CBN/CPNs/CEN→본화 금지 구역→스타일 지침→dynamic_context 보완 참고 의 순서로 5단락 집필 작업지시서를 출력한다."
)
```

산출물: Step 2 초고를 독립적으로 지원할 수 있는 집필 작업지시서 1부.

### Step 2: 원고 초고 작성

오직 작업지시서에 근거해 초고를 작성한다. core-constraints/anti-ai-guide는 로드하지 않는다(이미 작업지시서에 내재화됨). 순수 원고만 출력하며 자리 표시자 없음. 구조화 노드가 있을 경우 CBN→CPNs→CEN을 중심으로 전개한다.

### Step 3: 심사

반드시 `Agent` 도구로 `reviewer`를 호출해야 하며, 메인 플로우가 심사 JSON을 위조하는 것을 금지한다.

```text
Agent(
  subagent_type: "webnovel-writer:reviewer",
  prompt: "chapter={chapter_num}; chapter_file=${CHAPTER_FILE}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}。严格输出 reviewer schema JSON，并保存到 ${PROJECT_ROOT}/.webnovel/tmp/review_results.json。"
)
```

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" review-pipeline \
  --chapter {chapter_num} \
  --review-results "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --metrics-out "${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json" \
  --report-file "reviews/제{chapter_num}화심사보고서.md" \
  --save-metrics
```

blocking=true → 수정 후 재심사, Step 4로 진입 불가. `--fast`는 setting/timeline/continuity만 검사. `--minimal`은 건너뜀.

### Step 4: 윤문

`polish-guide.md`, `typesetting.md`, `style-adapter.md`를 로드한다.

순서: non-blocking issue 수정 → 스타일 적응 → 타입세팅 → Anti-AI 최종 검사.

표현만 수정하며 사실은 변경하지 않는다. `anti_ai_force_check=fail` 시 Step 5로 진입 불가. `--minimal`은 타입세팅만.

### Step 5: 커밋

#### 5.1 Data Agent 사실 추출

반드시 `Agent` 도구로 `data-agent`를 호출해야 하며, fulfillment_result / disambiguation_result / extraction_result 세 개의 JSON을 산출하고 Step 3의 review_results를 재사용한다.

```text
Agent(
  subagent_type: "webnovel-writer:data-agent",
  prompt: "chapter={chapter_num}; chapter_file=${CHAPTER_FILE}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}。원고에서 사실을 추출하여 .webnovel/tmp/ 아래의 fulfillment_result.json, disambiguation_result.json, extraction_result.json을 생성한다. fulfillment_result.json은 최상위에 planned_nodes/covered_nodes/missed_nodes/extra_nodes를 포함해야 하며, disambiguation_result.json은 최상위에 pending을 포함해야 하고, extraction_result.json은 반드시 7절 형식에 따라 최상위 필드 accepted_events/state_deltas/entity_deltas/entities_appeared/scenes/summary_text를 출력해야 하며 chapter/fulfillment/disambiguation/extraction 안에 감싸는 것을 금지한다. accepted_events 하위 항목은 반드시 event_id/chapter/event_type/subject/payload를 포함해야 한다. state/index/summaries/memory는 직접 쓰지 않는다."
)
```

Data Agent는 사실 추출 및 아티팩트 생성만 수행하며, state/index/summaries/memory는 직접 쓰지 않는다.

#### 5.2 CHAPTER_COMMIT

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" chapter-commit \
  --chapter {chapter_num} \
  --review-result "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --fulfillment-result "${PROJECT_ROOT}/.webnovel/tmp/fulfillment_result.json" \
  --disambiguation-result "${PROJECT_ROOT}/.webnovel/tmp/disambiguation_result.json" \
  --extraction-result "${PROJECT_ROOT}/.webnovel/tmp/extraction_result.json"
```

자동 판정: blocking_count>0 이거나 missed_nodes가 비어 있지 않거나 pending이 비어 있지 않으면 → rejected, 그 외에는 accepted.

#### 5.3 프로젝션 검증

projection_status 5개 항목(state/index/summary/memory/vector) 모두 done 또는 skipped.

chapter_status는 projection writer가 자동으로 진행: accepted→committed, rejected→rejected.

#### 5.4 장애 격리

커밋 미생성 → 5.2 재실행. 프로젝션 실패 → 실패 항목만 재실행. Step 1-4는 되돌리지 않는다.

### Step 6: Git 백업

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" backup \
  --chapter {chapter_num} \
  --chapter-title "{title}"
```

백업은 반드시 파싱된 `PROJECT_ROOT`를 기준으로 해야 하며, 워크스페이스 상위 디렉터리에서 전체 Git add를 실행하는 것을 금지한다. 이는 책 프로젝트 저장소가 부모 저장소의 서브모듈로 추가되는 것을 방지하기 위함이다.

## 충분성 게이트

1. 원고 파일이 존재하며 비어 있지 않다
2. 심사가 DB에 저장되었다(`--minimal` 제외)
3. blocking=true이면 반드시 Step 3에서 멈춘다
4. anti_ai_force_check=pass(`--minimal` 제외)
5. CHAPTER_COMMIT이 accepted이며, 프로젝션 5개 항목이 done/skipped
6. chapter_status=committed(프로젝션이 자동 진행)

## 실패 복구

심사 누락 → Step 3 재실행. 요약/상태/메모리 누락 → Step 5 재실행. 윤문 왜곡 → Step 4로 돌아가 수정 후 Step 5 재실행.
