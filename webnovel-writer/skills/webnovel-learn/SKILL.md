---
name: webnovel-learn
description: 현재 세션에서 성공 패턴을 추출해 project_memory.json에 기록합니다.
allowed-tools: Read Bash
---

# /webnovel-learn

## Project Root Guard（반드시 먼저 확인）

- 프로젝트 루트 디렉터리에서 실행해야 합니다 (`.webnovel/state.json` 이 존재해야 함)
- 잘못된 디렉터리에 쓰는 것을 방지하기 위해 통합 진입점으로 프로젝트 루트를 해석합니다:

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## 목표
- 재사용 가능한 집필 패턴 추출 (훅/페이스/대화/마이크로 사이다 등)
- `.webnovel/project_memory.json` 에 추가 기록

## 입력
```bash
/webnovel-learn "이번 화의 위기 훅 설계가 매우 효과적이며 서스펜스가 최고조에 달했다"
```

## 출력
```json
{
  "status": "success",
  "learned": {
    "pattern_type": "hook",
    "description": "위기 훅 설계: 서스펜스 최고조",
    "source_chapter": 100,
    "learned_at": "2026-02-02T12:00:00Z"
  }
}
```

## 실행 흐름
1. `"$PROJECT_ROOT/.webnovel/state.json"` 을 읽어 현재 화 번호(progress.current_chapter)를 가져옵니다
2. 사용자 입력을 파싱하여 pattern_type 으로 분류합니다 (hook/pacing/dialogue/payoff/emotion/format/other)
3. 반드시 스크립트를 통해 기록해야 하며, JSON을 직접 작성하거나 문자열 조합으로 만들어서는 안 됩니다:

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" project-memory add-pattern \
  --pattern-type "{pattern_type}" \
  --description "{사용자 입력 또는 정제된 전체 설명}" \
  --category "{분류, 빈 값 허용}" \
  --importance "{high|medium|low}"
```

스크립트는 `.webnovel/project_memory.json` 을 자동으로 읽거나 초기화하고, JSON 직렬화를 통해 다시 쓰며, 영문 큰따옴표·개행 등의 문자를 자동으로 이스케이프 처리합니다.

## 제약 사항
- 기존 기록은 삭제하지 않으며, 추가만 합니다
- 완전히 동일한 description 의 중복 기록은 피합니다 (중복 제거 가능)
- `Write` 도구 사용 또는 `.webnovel/project_memory.json` 의 수동 편집은 금지입니다

## 중복 제거 규칙

- 추가 전에 기존 `patterns` 배열을 스캔합니다
- `pattern_type` + `description` 이 완전히 동일한 기록이 있으면 건너뛰고 사용자에게 알립니다
- 부분적으로 유사한 경우는 중복 제거하지 않으며, 사용자의 판단에 맡깁니다

## 성공 기준

- `project_memory.json` 이 존재하고 형식이 올바릅니다
- 새로운 패턴이 `patterns` 배열에 추가되었습니다
- 출력에 `status: success` 와 완전한 `learned` 객체가 포함됩니다

## 실패 복구

| 오류 | 복구 방법 |
|------|---------|
| `project_memory.json` 이 없는 경우 | `{"patterns": []}` 로 자동 초기화 후 계속 진행 |
| JSON 파싱 실패 | 오염된 데이터를 쓰지 않고, 파일 손상을 사용자에게 알리며 수동 수정을 권장합니다 |
| `state.json` 누락으로 화 번호를 가져올 수 없는 경우 | `source_chapter: null` 로 설정하고 진행을 차단하지 않습니다 |
| 사용자 입력을 분류할 수 없는 경우 | `pattern_type: "other"` 를 사용하고 진행을 차단하지 않습니다 |
