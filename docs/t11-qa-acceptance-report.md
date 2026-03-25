# T11 统一验收 QA 报告（最小可行全链路）

- 任务：T11 `worker-qa`
- 验收日期：2026-03-25
- 验收范围：`scripts/data_modules/tests/*`、`dashboard/tests/*`、`dashboard/frontend/test/*`、`dashboard/frontend/src/*.test.*`，以及 AC 对应的代码/文档抽检
- 约束说明：忽略非 T11 任务域改动，不回滚他人提交

## 1) 自动化执行证据（命令 + 结果）

1. 脚本域（Runtime + Skills）  
   命令：
   ```powershell
   $tmpRoot='D:\code\webnovel-writer\.tmp\pytest-t11'; New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null; $env:TMP=$tmpRoot; $env:TEMP=$tmpRoot; $env:WEBNOVEL_TMPDIR_FIX='1'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; $env:PYTHONPATH='D:\code\webnovel-writer\webnovel-writer\scripts\test_bootstrap;D:\code\webnovel-writer\webnovel-writer\scripts'; python -m pytest -q webnovel-writer/scripts/data_modules/tests/test_codex_migration.py webnovel-writer/scripts/data_modules/tests/test_skill_backend_t04.py -o addopts= -p pytest_asyncio.plugin -p no:cacheprovider --basetemp D:\code\webnovel-writer\.tmp\pytest-t11\run-scripts
   ```
   结果：`5 passed`

2. Dashboard API（Settings / Split / Resplit / Edit Assist）  
   命令：
   ```powershell
   $tmpRoot='D:\code\webnovel-writer\.tmp\pytest-t11'; New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null; $env:TMP=$tmpRoot; $env:TEMP=$tmpRoot; $env:WEBNOVEL_TMPDIR_FIX='1'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; $env:PYTHONPATH='D:\code\webnovel-writer\webnovel-writer\scripts\test_bootstrap;D:\code\webnovel-writer\webnovel-writer\scripts'; python -m pytest -q webnovel-writer/dashboard/tests/test_settings_dictionary_api.py webnovel-writer/dashboard/tests/test_outlines_split_api.py webnovel-writer/dashboard/tests/test_outlines_resplit_api.py webnovel-writer/dashboard/tests/test_edit_assist_api.py -o addopts= -p pytest_asyncio.plugin -p no:cacheprovider --basetemp D:\code\webnovel-writer\.tmp\pytest-t11\run-dashboard
   ```
   结果：`10 passed`

3. Split 冒烟（T06 验收脚本）  
   命令：
   ```powershell
   $env:PYTHONPATH='D:\code\webnovel-writer\webnovel-writer\scripts'; python webnovel-writer/dashboard/tests/t06_split_smoke.py
   ```
   结果：输出 `[AC-004] PASS`、`[AC-005] PASS`、`[AC-006] PASS`

4. 前端 Skills 组件测试  
   命令：
   ```powershell
   npm test
   ```
   工作目录：`D:\code\webnovel-writer\webnovel-writer\dashboard\frontend`  
   结果：`PASS skills-page component suite`

5. 前端 ResplitDialog 组件测试  
   命令：
   ```powershell
   node ./test/resplit-dialog.component.test.cjs
   ```
   结果：`PASS resplit-dialog component suite`

6. 前端 API mock fallback 测试  
   命令：
   ```powershell
   node --test --test-isolation=none src/api/outlines.test.js src/api/settings.test.js
   ```
   结果：`2 passed`

7. 双纲页面同屏渲染校验（UI 最小可行）  
   命令：`node` 内联脚本（mock `outlines.js` + 渲染 `OutlineWorkspacePage.jsx`）  
   结果：`PASS outline-workspace dual-pane render`

8. Codex 专属化抽检（代码与文档）  
   命令（示例）：
   ```powershell
   rg -n "\.claude|Claude|claude" D:\code\webnovel-writer\webnovel-writer\scripts D:\code\webnovel-writer\webnovel-writer\dashboard D:\code\webnovel-writer\docs --glob "!**/tests/**" --glob "!**/test/**"
   ```
   结果：命中多处 `.claude/Claude` 兼容或描述（见缺陷清单）

## 2) AC-001 ~ AC-010 最终矩阵

| AC | 结果 | 证据/说明 |
|---|---|---|
| AC-001 | **FAIL** | 运行链路仍存在 `.claude` 兼容依赖与路径：`scripts/project_locator.py`、`scripts/data_modules/config.py`、`dashboard/server.py` 等仍引用 `.claude`，不满足“无 Claude 运行时依赖”。 |
| AC-002 | **PASS** | `test_skill_backend_t04.py::test_skill_api_workspace_isolation_ac002` 通过；跨工作区请求返回 `403 workspace_mismatch`，同名 skill 隔离。 |
| AC-003 | **PASS** | UI 渲染校验通过：`OutlineWorkspacePage` 同时呈现“总纲区/细纲区”并可加载双栏内容（`PASS outline-workspace dual-pane render`）。 |
| AC-004 | **PASS** | `test_outlines_split_api.py` + `t06_split_smoke.py` 通过，拆分后细纲新增片段并落盘。 |
| AC-005 | **PASS** | `t06_split_smoke.py` 输出 `[AC-005] PASS`；拆分结果按段归一写入。 |
| AC-006 | **PASS** | `test_outlines_split_api.py` 与 `test_outlines_resplit_api.py` 校验 `order_index` 连续与锚点可回溯；`t06_split_smoke.py` 输出 `[AC-006] PASS`。 |
| AC-007 | **PASS** | `test_outlines_resplit_api.py` 覆盖小选区/大选区回退策略及冲突拦截；`resplit-dialog.component.test.cjs` 覆盖前端预览/应用流程。 |
| AC-008 | **FAIL** | 后端 API 用例通过，但前端 E2E 不满足：`OutlineWorkspacePage.jsx` 中 `assist-edit` 为“当前仅占位”，未形成设定/大纲/正文三区统一“预览后应用”链路。 |
| AC-009 | **PASS** | `test_settings_dictionary_api.py` 通过：词典抽离、冲突处理、`source_file/source_span/fingerprint` 可追溯字段齐备。 |
| AC-010 | **FAIL** | 文档仍含过时 Claude 路径/叙述：`docs/commands.md`、`docs/operations.md` 等仍包含 Claude Slash/.claude 说明，不满足 Codex 专属叙事一致性。 |

## 3) 缺陷清单

### DEFECT-001（P1）AC-001 未通过：运行时仍保留 Claude 依赖路径
- 影响：Codex 专属化目标不达标，运行路径仍是双兼容。
- 证据：
  - `D:\code\webnovel-writer\webnovel-writer\scripts\project_locator.py`：`POINTER_DIR_NAMES = (".codex", ".claude")`
  - `D:\code\webnovel-writer\webnovel-writer\dashboard\server.py`：读取 `.codex/.claude` 指针
  - `D:\code\webnovel-writer\webnovel-writer\scripts\data_modules\config.py`：兼容 `~/.claude`
- 建议修复：收敛为 `.codex` 单路径，`.claude` 仅允许一次性迁移工具读取，不参与主链路解析。

### DEFECT-002（P1）AC-008 未通过：前端协助修改链路未打通
- 影响：无法满足“设定/大纲/正文编辑区统一右键协助修改并预览后应用”。
- 证据：
  - `D:\code\webnovel-writer\webnovel-writer\dashboard\frontend\src\pages\OutlineWorkspacePage.jsx` 第 167 行：`assist-edit -> T07/T10 对接点（当前仅占位）`
  - 同文件第 163 行：`resplit-preview -> T10 对接点（当前仅占位）`
  - 页面 `sourceId` 仅见 `settings.dictionary.entry`、`outline.*.editor`，未见正文编辑区入口
- 建议修复：将 `assist-edit` 动作接入 `/api/edit-assist/preview` + `/api/edit-assist/apply`，并补齐三个编辑区触发点与 E2E 用例。

### DEFECT-003（P1）AC-010 未通过：文档仍有过时 Claude 描述
- 影响：发布文档与 Codex 专属定位不一致，验收 gate 不能关闭。
- 证据：
  - `D:\code\webnovel-writer\docs\commands.md`：以 Claude Slash 命令说明流程
  - `D:\code\webnovel-writer\docs\operations.md`：Codex/Claude 双端运行与 `.claude` 路径说明
- 建议修复：T12 统一文档口径，仅保留 Codex 主路径与必要迁移注释。

## 4) 结论

- 自动化链路（API/UI/E2E 最小可行）已执行并可复现。
- 当前 AC 结果：**PASS = 7，FAIL = 3（AC-001/AC-008/AC-010）**。
- 按执行计划 Gate，“全部 AC 用例通过”尚未达成，T11 结论为：**验收完成但未全绿，需缺陷关闭后复验**。
