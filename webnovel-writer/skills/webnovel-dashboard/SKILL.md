---
name: webnovel-dashboard
description: 읽기 전용 소설 관리 대시보드를 실행해 프로젝트 상태, 엔티티 그래프, 화별 내용을 확인합니다.
allowed-tools: Bash Read
---

# Webnovel Dashboard

## 목표

- 로컬에서 읽기 전용 Web 패널을 실행합니다.
- 창작 진행 상황, 설정 사전, 관계 그래프, 화별 내용 및 추독력 데이터를 실시간으로 확인합니다.
- Story Runtime 메인 체인 상태(`story-runtime/health`, latest commit, fallback 현황 포함)를 명시적으로 확인합니다.
- `.webnovel/` 변경 사항을 모니터링할 수 있지만, 프로젝트 내용을 수정해서는 안 됩니다.

## 실행 흐름

### Step 1：환경 및 모듈 디렉터리 확인

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -z "${CLAUDE_PLUGIN_ROOT}" ] || [ ! -d "${CLAUDE_PLUGIN_ROOT}/dashboard" ]; then
  echo "ERROR: dashboard 모듈을 찾을 수 없습니다: ${CLAUDE_PLUGIN_ROOT}/dashboard" >&2
  exit 1
fi

export DASHBOARD_DIR="${CLAUDE_PLUGIN_ROOT}/dashboard"
```

### Step 2：의존성 설치 및 프로젝트 루트 디렉터리 해석

```bash
python -m pip install -r "${DASHBOARD_DIR}/requirements.txt" --quiet
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
echo "프로젝트 경로: ${PROJECT_ROOT}"
```

추가 요구 사항:
- `PROJECT_ROOT` 는 반드시 성공적으로 해석되어야 합니다
- 의존성이 이미 설치된 경우 재실행해도 오류로 처리하지 않습니다

### Step 3：Python 모듈 경로 설정 및 프런트엔드 빌드 산출물 검증

```bash
if [ -n "${PYTHONPATH:-}" ]; then
  export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}:${PYTHONPATH}"
else
  export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}"
fi

if [ ! -f "${DASHBOARD_DIR}/frontend/dist/index.html" ]; then
  echo "ERROR: 프런트엔드 빌드 산출물이 없습니다 ${DASHBOARD_DIR}/frontend/dist/index.html" >&2
  exit 1
fi
```

### Step 4：Dashboard 실행

```bash
python -m dashboard.server --project-root "${PROJECT_ROOT}"
```

브라우저 자동 열기가 필요하지 않은 경우:

```bash
python -m dashboard.server --project-root "${PROJECT_ROOT}" --no-browser
```

실행 후 다음 엔드포인트가 사용 가능한지 우선 확인합니다:
- `/api/story-runtime/health`
- `/api/preflight`

## 주의 사항

- Dashboard 는 완전한 읽기 전용 패널로, 수정 API를 제공하지 않습니다.
- 파일 읽기는 반드시 `PROJECT_ROOT` 범위 내로 제한해야 합니다.
- 포트를 커스터마이즈해야 하는 경우 `--port 9000` 을 사용합니다.

## 성공 기준

- Dashboard 프로세스가 실행되어 접근 가능한 URL을 출력했습니다
- 브라우저에서 정상적으로 페이지를 열 수 있습니다 (또는 `--no-browser` 모드에서 URL을 수동으로 접근 가능)
- 페이지에 프로젝트 데이터(화 목록, 엔티티 그래프 등)가 표시됩니다

## 실패 복구

| 오류 | 복구 방법 |
|------|---------|
| 의존성 설치 실패 | Python 버전과 네트워크를 확인하고, 수동으로 `pip install -r requirements.txt` 를 실행합니다 |
| 프런트엔드 `dist/` 누락 | 플러그인이 완전히 설치되었는지 확인합니다. dist 는 플러그인 패키지에 포함되어야 합니다 |
| 프로젝트 루트 해석 실패 | `.webnovel/state.json` 이 존재하는지 확인하고, `WORKSPACE_ROOT` 가 올바른지 점검합니다 |
| 포트 충돌 | `--port <다른 포트>` 를 사용하거나 해당 포트를 점유한 프로세스를 종료합니다 |
| 페이지 공백/데이터 누락 | `.webnovel/` 아래에 state.json, index.db 등 데이터 파일이 있는지 확인합니다 |

## 보안 경계

- 읽기 전용 작업으로, 프로젝트 파일을 일절 수정하지 않습니다
- 파일 접근은 `PROJECT_ROOT` 범위 내로 제한합니다
- 외부 네트워크에 노출하지 않습니다 (기본값: localhost)
