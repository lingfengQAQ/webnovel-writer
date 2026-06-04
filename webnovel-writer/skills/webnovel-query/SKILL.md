---
name: webnovel-query
description: 프로젝트 설정·캐릭터·파워 시스템·세력·복선 등을 조회합니다. 긴급도 분석과 치트키 상태 조회를 지원합니다.
allowed-tools: Read Grep Bash AskUserQuestion
---

# Information Query Skill

## Use when

사용자가 스토리 설정, 캐릭터, 파워 시스템, 세력, 복선, 치트키, 페이스/리듬 등 프로젝트 내부 정보를 질문할 때 실행합니다.

## 프로젝트 루트 보호

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT}/skills/webnovel-query"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

- `PROJECT_ROOT` 에는 반드시 `.webnovel/state.json` 이 포함되어야 합니다
- `${CLAUDE_PLUGIN_ROOT}/` 하위에서 프로젝트 파일을 읽거나 쓰는 것은 **금지**입니다

## 조회 유형 인식

| 키워드 | 조회 유형 | 데이터 소스 |
|--------|---------|--------|
| 캐릭터/주인공/조연 | 표준 조회 | 주인공카드.md, 캐릭터라이브러리/ |
| 경계/축기/금단 | 표준 조회 | 파워시스템.md |
| 문파/세력/장소 | 표준 조회 | 세계관.md |
| 복선/긴급 복선 | 복선 분석 | state.json + foreshadowing.md |
| 치트키/시스템 | 치트키 상태 | state.json |
| 페이스/Strand | 리듬 분석 | state.json + strand-weave-pattern.md |
| 태그/엔티티 포맷 | 포맷 조회 | tag-specification.md |
| 특정 캐릭터의 N화 시점 상태/히스토리 상태/시간점 상태 | 시계열 조회 | knowledge query-entity-state / query-relationships |

## 참조 파일 로드 전략

먼저 조회 유형을 파악한 뒤 필요한 파일만 로드합니다. 경로 설명: `references/` 는 스킬 전용 `skills/webnovel-query/references/` 를 의미하며, `../../references/` 는 공유 references를 의미합니다.

| 조회 유형 | 참조 파일 | 실제 경로 |
|---------|-----------|---------|
| 모든 조회 | 데이터 흐름 명세 | `${SKILL_ROOT}/references/system-data-flow.md` |
| 복선 분석 | 복선 분석 | `${SKILL_ROOT}/references/advanced/foreshadowing.md` |
| 리듬 분석 | Strand 패턴 | `${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md` |
| 포맷 조회 | 태그 명세 | `${SKILL_ROOT}/references/tag-specification.md` |

사용자의 요청이 명확하게 여러 유형에 걸치지 않는 한, L2 파일을 두 개 이상 동시에 로드하면 안 됩니다.

## 조회 흐름

1. **조회 유형 파악**: 사용자 키워드를 위 표와 대조합니다
2. **참조 파일 로드**: 해당 유형에 필요한 참조 파일만 로드합니다
3. **메인 체인 컨텍스트 로드**:

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" memory-contract load-context --chapter {chapter_num}
```

4. **우선순위에 따라 데이터 소스 조회** (쓰기 전 진본 → 쓰기 후 진본 → 프로젝션 레이어):
   1. `.story-system/MASTER_SETTING.json` - 전체 작품 주요 설정 (장르, 톤, 핵심 금기)
   2. `.story-system/volumes/*.json` - 권 단위 계약 (해당 권의 목표, 리듬 전략)
   3. `.story-system/chapters/*.json` - 화 단위 계약 (해당 화의 포커스, 동적 컨텍스트)
   4. 최신 accepted `.story-system/commits/chapter_XXX.commit.json` - 쓰기 후 사실 (발행된 화의 최종 확정 상태)
   5. `memory-contract load-context` - 메모리 오케스트레이션 결과 (장기 기억, 복선, 타임라인)
   6. `.webnovel/state.json` / `index.db` - 프로젝션 레이어 (fallback/read-model 전용, 웹소설 백오피스의 "캐릭터 카드", "화 목록"에 해당)
   
   **우선순위 설명**:
   - 쓰기 전 진본 (1-3): 작가가 집필을 시작하기 전에 반드시 준수해야 할 "대강·설정·금지 구역"
   - 쓰기 후 진본 (4): 발행된 화의 "최종 확정 상태"로, 수정 불가
   - 프로젝션 레이어 (5-6): 쓰기 후 진본에서 자동 생성된 "조회 뷰"로, 빠른 검색에 활용
5. **컨텍스트 충분성 확인**: 조회 유형 파악 완료 + 메인 체인 계약 / latest commit 로드 완료
6. **조회 실행**: 유형에 따라 해당 데이터 소스를 검색합니다. 시계열 조회인 경우 다음 명령을 사용합니다:

```bash
# 특정 엔티티의 지정 화 시점 상태 조회
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" knowledge query-entity-state --entity "{entity_id}" --at-chapter {N}

# 특정 엔티티의 지정 화 시점 모든 관계 조회
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" knowledge query-relationships --entity "{entity_id}" --at-chapter {N}
```

7. **출력 포맷**: 아래 템플릿에 따라 출력합니다

## 출력 형식

```markdown
# 조회 결과: {키워드}

## 개요
- **매칭 유형**: {type}
- **데이터 소스**: state.json + 설정집 + 대강
- **매칭 수**: X 건

## 상세 정보
{구조화된 데이터, 파일 경로 및 줄 번호 포함}

## 데이터 일관성 검사
{state.json과 정적 파일 간의 차이점; 차이 없을 경우 생략}
```

## 경계 조건 및 실패 복구

- 읽기 전용 작업으로, 프로젝트 파일을 일절 수정하지 않습니다
- 데이터 소스가 누락된 경우 어떤 파일이 없는지 사용자에게 명확히 알립니다
- 조회 결과가 없을 경우 빈 결과를 반환하고 검색 범위를 재확인하도록 안내합니다
- `.story-system/` 계약과 accepted commit이 모두 누락된 경우, 현재 조회가 legacy fallback으로 강등되었음을 명시적으로 알려야 합니다
