# 2026-06-10 全项目审查修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-06-10 深度审查发现的全部高/中危问题：数据丢失路径、数据链不一致、skill 流程死锁、隐私出网默认值与守卫绕过。

**Architecture:** 按伤害优先级分四个阶段（P0 数据安全 → P1 数据链与流程 → P2 安全隐私 → P3 质量卫生）。每个阶段独立可交付、全绿后再进下一阶段。修复以"先写探针测试复现问题 → 修复 → 验证"为节奏；过时的文案级断言按《测试是探针不是约束》原则直接改写。

**Tech Stack:** Python 3.10+ / pytest（Windows 下设 `PYTHONUTF8=1`）/ SQLite / FastAPI。

**审查报告来源:** 本计划对应 2026-06-10 会话中六个维度的审查结论（数据链、提示词、代码质量、dashboard+hooks、数据安全+CI、仓库卫生+残余模块）。

**运行测试:** `python -m pytest`（根目录 pytest.ini 已配置 testpaths 与 cov-fail-under=90）。

---

## Phase 0 — P0 数据安全（正文是不可再生数据）

### Task 1: backup_manager 备份失败不得报告成功

**Files:**
- Modify: `webnovel-writer/scripts/backup_manager.py:150-166, 228-254`
- Test: `webnovel-writer/scripts/tests/test_backup_manager.py`

- [x] **Step 1: 写失败测试**：在 tmp git 仓库中故意不配置 `user.name/user.email`（`git config --local --unset` 或 `-c user.useConfigOnly=true`），调用 `backup()`，断言返回失败且输出包含"备份失败"、不产生 `ch{N}` tag。
- [x] **Step 2: 运行确认现状是假成功**（当前会打印 ✅ 并打 tag 在旧 HEAD）。
- [x] **Step 3: 修复 `_run_git_command`**：`check=False` 分支改为返回 `(result.returncode == 0, stdout, stderr)`；调用方据真实退出码判断。"nothing to commit" 改为从 stdout/stderr 文本判断（当前 `:233` 的 `if not success and "nothing to commit"` 是永假死代码，一并删除重写）：

```python
def _run_git_command(self, args, check=True):
    result = subprocess.run(
        ["git", *args], cwd=self.project_root,
        capture_output=True, text=True, encoding="utf-8",
    )
    ok = result.returncode == 0
    if check and not ok:
        raise BackupError(f"git {' '.join(args)} 失败: {result.stderr.strip()}")
    return ok, result.stdout, result.stderr
```

- [x] **Step 4: `backup()` 中 commit 失败时中止**：不打 tag、返回非零、输出含修复指引（提示运行 `git config user.name/user.email`）；"nothing to commit" 视为成功但提示"本章无变更"。
- [x] **Step 5: 跑全部 backup 测试通过后提交** `fix: backup reports real git failures and aborts tagging`。

### Task 2: rollback 改为前滚式恢复，去掉 detached HEAD 与硬编码 master

**Files:**
- Modify: `webnovel-writer/scripts/backup_manager.py:294-307`
- Test: `webnovel-writer/scripts/tests/test_backup_manager.py`

- [ ] **Step 1: 写测试**：建 tmp 仓库（默认分支命名为 `main`），打两个 ch tag，回滚到 ch1 后断言：(a) 仍在原分支（`git symbolic-ref HEAD` 成功且为 main）；(b) 工作区内容等于 ch1；(c) `git log` 多出一个"rollback"提交（历史不丢）。
- [ ] **Step 2: 实现前滚式回滚**：

```python
def rollback(self, chapter: int) -> bool:
    tag = f"ch{chapter}"
    ok, _, _ = self._run_git_command(["rev-parse", "--verify", tag], check=False)
    if not ok:
        print(f"❌ 备份点 {tag} 不存在"); return False
    ok, _, err = self._run_git_command(["checkout", tag, "--", "."], check=False)
    if not ok:
        print(f"❌ 回滚失败: {err}"); return False
    self._run_git_command(["add", "-A"], check=False)
    ok, _, err = self._run_git_command(
        ["commit", "-m", f"rollback: 恢复到 {tag} 备份点"], check=False)
    # 工作区与 tag 相同则 commit 报 nothing to commit，视为成功
    return True
```

- [ ] **Step 3: 删除所有 `checkout master` 硬编码**；任何需要分支名的地方用 `git symbolic-ref --short HEAD` 探测。
- [ ] **Step 4: 测试通过后提交** `fix: rollback is forward-only, never detaches HEAD`。

### Task 3: 无 Git 时的降级备份必须覆盖正文，或醒目声明没有

**Files:**
- Modify: `webnovel-writer/scripts/backup_manager.py:175-195`
- Test: `webnovel-writer/scripts/tests/test_backup_manager.py`

- [ ] **Step 1: 写测试**：模拟 git 不可用（monkeypatch `_git_available` 为 False），项目含 `正文/第0001章-x.md`，调用 `backup()` 后断言备份目录里存在该正文文件副本。
- [ ] **Step 2: 实现**：降级路径把 `正文/`、`大纲/`、`设定集/`、`.webnovel/state.json` 全部 `shutil.copytree/copy2` 进 `.webnovel/backups/snapshot_ch{N}_{ts}/`；输出明确列出备份了什么。保留按数量滚动清理（最多 10 个 snapshot）。
- [ ] **Step 3: 提交** `fix: degraded backup covers manuscript files`。

### Task 4: init 重跑不得静默覆盖损坏的 state.json

**Files:**
- Modify: `webnovel-writer/scripts/init_project.py:294-300,366`
- Test: `webnovel-writer/scripts/data_modules/tests/test_init_project_pruning.py`

- [ ] **Step 1: 写测试**：项目里放一个非法 JSON 的 state.json，重跑 init，断言 (a) 生成 `state.corrupt_*.json` 副本且内容等于原损坏文本；(b) 输出包含警告。
- [ ] **Step 2: 实现**：捕获 `json.JSONDecodeError` 时先 `shutil.copy2(state_path, state_path.with_name(f"state.corrupt_{ts}.json"))` 再重建，打印"⚠️ 原 state.json 已损坏，已另存为 ... 供手工抢救"。
- [ ] **Step 3: 提交** `fix: preserve corrupt state.json before rebuilding`。

### Task 5: 迁移脚本带错不精简、写回原子化

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/migrate_state_to_sqlite.py:235-258`
- Test: `webnovel-writer/scripts/data_modules/tests/test_migrate_state_to_sqlite.py`

- [ ] **Step 1: 写测试**：构造一条会迁移失败的实体（如非法类型触发 `stats["errors"] += 1`），跑迁移，断言 state.json 中 `entities_v3` 字段仍在、CLI 退出码非 0。
- [ ] **Step 2: 实现**：`if stats["errors"]: 跳过步骤5精简，输出"存在迁移错误，已保留原字段"`；步骤 5 的裸 `open('w')+json.dump` 改为 `security_utils.atomic_write_json(state_path, state, use_lock=True)`。
- [ ] **Step 3: 提交** `fix: migration never prunes state on partial failure`。

### Task 6: archive_manager 原子写 + 恢复顺序反转

**Files:**
- Modify: `webnovel-writer/scripts/archive_manager.py:125-128, 494-508`
- Test: `webnovel-writer/scripts/data_modules/tests/test_archive_manager.py`

- [ ] **Step 1: `save_archive` 改用 `atomic_write_json`**（归档是数据被移出 state 后的唯一副本）。
- [ ] **Step 2: `restore_character` 顺序反转**：先恢复 SQLite，确认成功后才从归档 JSON 删除该角色；SQLite 失败时归档保持原样并返回错误。写测试：monkeypatch SQLite 恢复抛异常，断言归档文件未被修改。
- [ ] **Step 3: 提交** `fix: archive writes atomic, restore is delete-last`。

---

## Phase 1 — P1 数据链一致性与流程死锁

### Task 7: SQLite 同步失败必须可见

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_manager.py:393-416, 450-451, 606-609`
- Test: `webnovel-writer/scripts/data_modules/tests/test_state_manager_extra.py`

- [ ] `_sync_to_sqlite` 失败时：`save_state` 返回值携带 `sqlite_sync_ok=False`；`process-chapter` CLI 据此 `emit_error`（退出码非 0），错误信息提示运行 `webnovel.py projections retry --chapter N` 补偿。测试：monkeypatch `_sync_pending_patches_to_sqlite` 抛异常，断言 CLI 退出非 0 且 stdout JSON 含补偿指引。
- [ ] 提交 `fix: surface sqlite sync failures in process-chapter`。

### Task 8: get_state_changes / get_relationships 走 SQLite 回退

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_manager.py:972-977, 1005-1013`
- Test: `webnovel-writer/scripts/data_modules/tests/test_state_manager_extra.py`

- [ ] 仿照 `get_entity` 的 SQLite-first 模式：先查 `self._sql_state_manager.get_entity_state_changes / get_recent_relationships`，无结果再回退内存。测试：用一个新建 StateManager 实例（模拟跨进程）读取此前保存的 state_changes，断言非空。
- [ ] 同步把 `record_state_change`（:953-966）改为只进 `_pending_state_changes`，删除向 `self._state["state_changes"]` 的追加。
- [ ] 提交 `fix: state change reads hit sqlite, not stale memory`。

### Task 9: 事件镜像按章先删后插

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/event_log_store.py:109-146`
- Test: `webnovel-writer/scripts/data_modules/tests/test_event_log_store.py`

- [ ] 测试：同章先写 events A，再整体覆盖写 events B（不同 event_id），断言 `story_events` 表里只剩 B。实现：`_write_sqlite_mirror` 在同一事务内 `DELETE FROM story_events WHERE chapter = ?` 后再 INSERT（JSON 文件是该章事实源）。
- [ ] 提交 `fix: event mirror mirrors, not accumulates`。

### Task 10: 投影 writer 复用 chapter_status 单调状态机

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_projection_writer.py:59-65, 95`
- Test: `webnovel-writer/scripts/data_modules/tests/test_projection_writers.py`

- [ ] 把 `StateManager.set_chapter_status` 的 rank 比较逻辑提取为模块级函数 `should_transition(old, new) -> bool`（同文件或 schemas.py），两处共用。测试：先投影 accepted commit 再重放历史 rejected commit，断言状态仍是 `chapter_committed`。
- [ ] 提交 `fix: projection respects chapter status monotonicity`。

### Task 11: total_words 统一为投影重算口径

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_manager.py:280-285`
- Test: 改写涉及 `update_progress` 增量口径的既有断言（探针原则）

- [ ] `update_progress` 不再累加 `total_words`，只更新 `current_chapter/last_updated`；字数一律由 `StateProjectionWriter` 全量重算。grep 全仓库 `total_words` 的写入点确认只剩投影一处。
- [ ] 提交 `fix: single source of truth for total_words`。

### Task 12: add_entity 别名并入 pending 事务

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_manager.py:839-854`
- Test: `webnovel-writer/scripts/data_modules/tests/test_state_manager_extra.py`

- [ ] 别名写入改为追加到 `_pending_alias_entries`，统一在 `_sync_pending_patches_to_sqlite` 落库。测试：`add_entity` 后不调 `save_state` 直接查 SQLite，断言别名尚未落库；`save_state` 后断言已落库。
- [ ] 提交 `fix: alias writes go through pending patch transaction`。

### Task 13: SQLite 连接统一 WAL + busy_timeout + 批量事务

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/index_manager.py:626-634`（`_get_conn`）
- Test: 现有测试回归即可

- [ ] `_get_conn` 中执行 `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=8000`。投影路径上把"每方法一次 commit"合并为单连接单事务（`IndexProjectionWriter.apply` 持有一个连接传入各写方法）。
- [ ] 提交 `perf: WAL + single transaction per projection`。

### Task 14: projection_log 持锁追加 + compact

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/projection_log.py:101-119`
- Test: `webnovel-writer/scripts/data_modules/tests/test_projection_log.py`

- [ ] 追加前持 `FileLock(path + ".lock")`；新增 `compact_projection_log(project_root, keep_per_chapter=3)` 函数并挂到 `webnovel.py projections compact` 子命令。测试：写 5 条同章 run 后 compact，断言只剩 3 条且为最新。
- [ ] 提交 `fix: projection log locked appends + compact command`。

### Task 15: legacy 提交路径加护栏

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/memory_contract_adapter.py:71-120, 147-156`
- Test: `webnovel-writer/scripts/data_modules/tests/test_memory_contract_adapter.py`

- [ ] `_commit_chapter_legacy` 入口检测：该章已存在 accepted commit 文件时拒绝执行并报错"该章已走 Story System 主链，禁止 legacy 双写"。docstring 标注 deprecated。
- [ ] `chapter_commit_service.py:182-188`：amend proposal 的持久化挪到投影成功之后（或写入时带 `projection_run_id`，投影失败的 run 对应提案在 `projections retry` 成功前不进 pending 列表）。测试：投影全失败时断言 override_ledger 无新增 pending 提案。
- [ ] 提交 `fix: legacy commit path refuses to double-write mainline chapters`。

### Task 16: 清理危险死代码

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/state_manager.py:708-711`

- [ ] 删除 `_save_state`（全仓库无调用方、绕过 pending 合并语义）。grep 确认无引用后提交 `chore: remove dangerous dead _save_state`。

### Task 17: write SKILL blocking 死锁解除

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`（L162 Step 3、L245、L327-331）
- Test: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`（若有相关断言联动改）

- [ ] Step 3 改为：blocking 定点修复后**必须重跑 review-pipeline 重新生成 review_results.json**（清零已修复项），然后才进 Step 4；并补"作者裁决保留当前版本"出口：引用 `references/review/blocking-override-guidelines.md`，写明用 override ledger 命令记录后 commit 可带 `--override-ref` 通过。两条路径都要与 `chapter_commit_service.py:45` 的 `rejected = bool(review.blocking_count)` 判定自洽（override 路径需确认 service 支持，不支持则在 service 增加 override_ref 豁免逻辑——先读 `chapter_commit_service.py` 与 `override_ledger_service.py` 确认现有机制再动笔）。
- [ ] 提交 `fix(skill): unblock the blocking-fix path in write flow`。

### Task 18: 提示词中的错误命令修正

**Files:**
- Modify: `webnovel-writer/skills/webnovel-query/SKILL.md:78`、`webnovel-writer/agents/reviewer.md:30`

- [ ] `memory-contract query-rules --chapter {n}` → `--domain {domain}`（对照 `memory_cli.py:90` 实参）；reviewer.md 的 `index get-state-changes --limit 20` 补必填 `--entity "{entity_id}"`。逐条在本地实际执行一次验证不报 argparse 错。
- [ ] 提交 `fix(skill): correct CLI invocations in query skill and reviewer agent`。

### Task 19: 统一入口与 chapter_commit 参数口径对齐

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/webnovel.py:554-559` 或 `webnovel-writer/scripts/chapter_commit.py:23-26`
- Test: `webnovel-writer/scripts/data_modules/tests/test_webnovel_unified_cli.py`

- [ ] 统一为 required（推荐，强制契约）：`webnovel.py` 侧四个参数加 `required=True`，缺参时报错发生在统一入口层、信息面向作者。测试：缺 `--review-result` 调用，断言错误信息含参数名与示例。
- [ ] 提交 `fix: align chapter-commit arg contract between entrypoints`。

### Task 20: 修复 genre-profiles 死链（题材画像复活）

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/config.py`（新增 `references_dir` 解析）、`webnovel-writer/scripts/data_modules/context_manager.py:337-338`、`webnovel-writer/scripts/data_modules/memory_contract_adapter.py:245`
- Test: `webnovel-writer/scripts/data_modules/tests/test_context_manager.py`

- [ ] config 新增解析顺序：`{project_root}/.claude/references/`（用户覆盖）→ `{plugin_root}/references/`（默认，由 `Path(__file__).resolve().parents[2] / "references"` 推导）。两处读取点改用 `config.references_dir / "genre-profiles.md"`。
- [ ] 测试改造：现有手搓 `.claude/references` 的测试保留（验证覆盖优先级），新增"无项目级文件时回退插件目录"的测试。
- [ ] 提交 `fix: genre profiles resolve to plugin references by default`。

### Task 21: story_system_engine base_context 必空 bug

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/story_system_engine.py:125, 412-423`
- Test: `webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py`

- [ ] `_apply_reasoning` 的早退分支也为每行设置 `_priority_rank`：base_context 来源行设 0、dynamic 行设 1（保持 base 优先），保证 `build()` 的 `< 999` 过滤不再误杀。测试：用没有裁决规则行的题材跑 `build()`，断言 `master_setting.base_context` 非空。
- [ ] 提交 `fix: base_context survives the no-reasoning path`。

### Task 22: extract_chapter_context 载荷去重

**Files:**
- Modify: `webnovel-writer/scripts/extract_chapter_context.py:321-354`
- Test: `webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py`

- [ ] 顶层 `outline`/`previous_summaries`/`state_summary` 与 `core.*` 二选一：保留 `core.*`（ContextManager 已排序），顶层字段删除；消费方（context-agent.md 中引用了哪些键先 grep 确认）同步更新。测试断言 payload 中大纲文本只出现一次。
- [ ] 提交 `fix: dedupe chapter context payload`。

### Task 23: 伏笔紧急度量纲统一

**Files:**
- Modify: `webnovel-writer/skills/webnovel-query/references/advanced/foreshadowing.md`

- [ ] 公式改为 0-100 量纲：`紧急度 = min(100, (已过章节/目标章节) × 层级权重 × 33.3)` 或直接改为与 `urgency_utils` 的 high/medium/low≈100/60/20 对齐的阈值表；删除与"核心 50-300 章"矛盾的"核心 >50 章未回收即 Critical"行，改为"超过该伏笔自身 target 章节数即 Critical"。示例数值同步重算。
- [ ] 提交 `fix(ref): foreshadowing urgency uses runtime 0-100 scale`。

### Task 24: 散件正确性修复打包

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/rag_adapter.py:1477, 615-649`、`api_client.py`（9 处 print）、`knowledge_query.py:17,46`、`webnovel.py:127, 583`、`update_state.py:344-351,609-611`、`config.py:30-48,60`、`context_manager.py:790-829`
- Test: 各对应测试文件

- [ ] rag_adapter `index-chapter` 用 `adapter.config.project_root` 替代未定义 `config`；`vector_search` 行解包 `chapter` 改名 `row_chapter`。
- [ ] api_client 全部 `[WARN]/[ERR]/[WARMUP]` 改 `file=sys.stderr`。
- [ ] knowledge_query 连接前 `is_file()` 检查，缺失时输出含修复建议的友好错误。
- [ ] `webnovel.py` `int(e.code or 0)` 对非 int code 打印后返回 1；`knowledge` subparsers 加 `required=True`。
- [ ] update_state `update_strand_tracker` 失败累计并以非零退出。
- [ ] config `.env` 值 `strip().strip("\"'")`；`_load_dotenv` 从模块导入时移到 `from_project_root` 显式调用。
- [ ] context_manager CLI 失败路径 `sys.exit(1)`。
- [ ] 每修一处先在对应测试文件加探针测试。完成后提交 `fix: batch correctness fixes from audit`。

---

## Phase 2 — P2 安全与隐私

### Task 25: 嵌入出网需要显式配置

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/api_client.py`（embed/rerank 调用入口）、`vector_projection_writer.py:236-246`
- Test: `webnovel-writer/scripts/data_modules/tests/test_vector_projection_writer.py`
- Docs: `webnovel-writer/README.md`、`docs/guides/rag-and-config.md`

- [ ] `EMBED_API_KEY` 为空时 vector 投影直接返回 `{"status": "skipped", "reason": "no_api_key"}`，不发任何 HTTP 请求。测试：key 为空 + monkeypatch aiohttp 断言零请求。
- [ ] 文档新增"数据出网说明"小节：明确写出默认端点、发送内容（摘要/场景/事件文本）、如何关闭。
- [ ] 提交 `fix: no network egress without explicit api key`。

### Task 26: 写守卫 hook 加固

**Files:**
- Modify: `webnovel-writer/hooks/guard_runtime_write.py:61-67, 101-110`
- Test: `webnovel-writer/scripts/tests/test_hooks.py`

- [ ] 正则修复：`\b(>|out-file|...)` 中 `>` 单独处理（`(?:^|\s)>{1,2}(?:\s|$)|\b(out-file|set-content|add-content|copy-item|move-item|cp|mv|rm|tee|sed|python|python3)\b`）；测试用例覆盖 `echo x > .webnovel/state.json`、`mv a .webnovel/state.json`、`tee .webnovel/index.db`。
- [ ] `_deny` 的 JSON 决策输出改打 stdout（退出码 2 保留），`systemMessage` 才能被宿主解析。
- [ ] 提交 `fix(hooks): close redirect/unix-command bypass in write guard`。

### Task 27: dashboard 最小防护

**Files:**
- Modify: `webnovel-writer/dashboard/app.py`、`server.py`
- Test: `webnovel-writer/scripts/tests/test_dashboard_security.py`

- [ ] 加 `TrustedHostMiddleware(allowed_hosts=["localhost", "127.0.0.1"])`（防 DNS rebinding）；`--host` 非回环地址时打印醒目警告"整个项目将对网络可见"；支持 `WEBNOVEL_DASHBOARD_TOKEN` 环境变量，设置后所有 `/api/*` 校验 `Authorization: Bearer`。测试：伪 Host 头请求返回 400；带错误 token 返回 401。
- [ ] 顺手修 `app.py:175` `_inspect_vector_db` 连接泄漏（包 `closing()`）。
- [ ] 提交 `fix(dashboard): trusted host + optional token auth`。

### Task 28: CI 加固

**Files:**
- Modify: `.github/workflows/plugin-version.yml`、`.github/workflows/plugin-release.yml:43-51, 108`

- [ ] plugin-version.yml 顶部加 `permissions: contents: read`。
- [ ] release 的 `workflow_dispatch` version 输入加 `[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1` 前置校验；`softprops/action-gh-release@v2` pin 到具体 commit SHA；`git ls-remote` 区分查询失败（退出码非 0 且非"未找到"）与 tag 不存在。
- [ ] 注意：不要动 README 版本表相关检查（CI 硬约束）。提交 `ci: least privilege + input validation + pinned action`。

### Task 29: 首次运行体验

**Files:**
- Modify: `webnovel-writer/skills/webnovel-init/SKILL.md`（Step 0 预检）、`webnovel-writer/hooks/hooks.json`
- Test: 手动验证

- [ ] init SKILL 的 Step 0 增加一行指令：先运行 `python -X utf8 "{plugin_root}/scripts/webnovel.py" doctor --format json`，存在 blocker（缺 pydantic/aiohttp 等）时向作者展示一键安装命令 `python -m pip install -r "{plugin_root}/scripts/requirements.txt"` 并等待完成再继续（doctor 已有 `python.import.*` 检查，无需新代码）。
- [ ] hooks.json 保持 `python`，但 `session_start.py` 在 `webnovel.py` 调用失败（FileNotFoundError/非零退出）时输出一行"⚠️ Python 环境异常，运行 /webnovel-doctor 检查"——守卫 hook 的 fail-open 风险在 doctor 报告中体现（新增 check：`shutil.which("python")` 探测）。
- [ ] 提交 `feat: dependency preflight in init + doctor python check`。

---

## Phase 3 — P3 质量与卫生（可与 Phase 2 并行）

### Task 30: 提示词重复下沉

**Files:**
- Create: `webnovel-writer/references/shared/author-report-contract.md`
- Modify: `webnovel-writer/skills/{webnovel-init,webnovel-plan,webnovel-write,webnovel-review}/SKILL.md`、`webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`、`webnovel-writer/references/index/reference-loading-map.md`

- [ ] "作者友好过程提示与恢复契约"+"最终报告契约"两节（4 个 skill 重复约 60-70 行）抽到共享文件，各 SKILL 留一行引用 + stage 差异参数。SubagentRun JSON 模板同理只在共享文件保留一份。`test_prompt_integrity.py` 的文案断言按探针原则改为断言引用行存在。loading-map 登记新文件。SKILL 改动遵循"只写指令"原则——不留解释性注释。
- [ ] 提交 `refactor(skill): hoist author report contract to shared reference`。

### Task 31: 提示词过期内容清理

**Files:**
- Modify: `webnovel-writer/templates/genres/*.md`（34 个 XML 实体段 + 30 个 Pack 编号）、`webnovel-writer/references/index/reference-loading-map.md`、`webnovel-writer/references/genre-profiles.md`、`webnovel-writer/references/shared/core-constraints.md:6-7`、`webnovel-writer/references/review-schema.md:3`、`webnovel-writer/references/review/blocking-override-guidelines.md:3,8,39`、`webnovel-writer/skills/webnovel-write/references/style-adapter.md:9`、`webnovel-writer/skills/webnovel-write/references/anti-ai-guide.md`

- [ ] 批量删 genre 模板的 `<entity .../>` 扩展段与悬空 Pack 编号行（脚本化 sed/python 批改后抽查 3 个文件）。
- [ ] loading-map 对照 8 个 SKILL 重新核账步骤号；genre-profiles 为缺失题材补段或在 §2 头部写明 fallback 规则（命中失败 → 使用 shuangwen 基线段）；§3 删除 Checkers/`project.genre` 旧引用。
- [ ] anti-ai-guide 三方矛盾裁决：保留文件、头部"加载时机"改为"润色阶段按需"，与 polish-guide 重叠词条合并，登记进 loading-map 非直接调用表。
- [ ] 各文件头部步骤号修正（core-constraints/review-schema/blocking-override/style-adapter）。
- [ ] 提交 `docs(ref): purge stale protocol fragments and fix loading map drift`。

### Task 32: CLI 样板抽取

**Files:**
- Create: `webnovel-writer/scripts/data_modules/cli_runtime.py`
- Modify: `entity_linker.py`、`index_manager.py`、`rag_adapter.py`、`state_manager.py`、`sql_state_manager.py`、`style_sampler.py` 各 `main()`，`webnovel.py:306-381`

- [ ] 提供 `resolve_config(args) -> DataModulesConfig`（封装 normalize_global_project_root + resolve_project_root + from_project_root）与 `run_cli(fn)` 装饰器（统一 emit_success/emit_error + 退出码）。六个入口迁移；`webnovel.py` 的 run-ledger/run-log 复抄段改为转发。现有 CLI 测试全量回归。
- [ ] 提交 `refactor: extract cli_runtime, dedupe six entrypoints`。

### Task 33: 性能修复

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/rag_adapter.py:583-650, 721-758`、`webnovel-writer/scripts/status_reporter.py:370-460`

- [ ] vector 直连路径复用 hybrid 的 `vector_full_scan_max_vectors` 预筛；bm25 命中 chunk 改 `WHERE chunk_id IN (...)` 一次取回；status_reporter 开头一次性 `SELECT * FROM entities/chapters` 建 dict，删除循环内单查。用现有测试回归 + 千章模拟数据手测对比耗时（可选）。
- [ ] 提交 `perf: kill N+1 queries in rag and status reporter`。

### Task 34: 仓库与测试卫生

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py`（或其 fixture）、`sitecustomize.py`、`.github/workflows/plugin-version.yml`、根 `requirements.txt` 三份、`webnovel-writer/scripts/update_state.py:159-178`、`webnovel-writer/scripts/data_modules/summary_projection_writer.py:20`

- [ ] 找到向仓库根写 `.tmp_story_system_engine/case_*` 的测试，改用 pytest `tmp_path`；删除根目录现存 231 个残留目录。
- [ ] `sitecustomize.py`：移出仓库（或改名 `sitecustomize.py.example` + README 说明），避免影响分发用户。
- [ ] CI 增加 dist 同步校验 step：`npm ci && npm run build` 后 `git diff --exit-code webnovel-writer/dashboard/frontend/dist`（或对比构建哈希），防止前端源码与 dist 漂移。
- [ ] requirements 关键依赖加上界（`fastapi>=0.110,<1`、`pydantic>=2,<3` 等）；确认 dashboard 的 httpx 是否仅测试用，是则移到测试依赖。
- [ ] update_state 备份文件按数量滚动清理（保留最近 20 个）；summary 投影写改 tmp+replace。
- [ ] 提交 `chore: test/repo hygiene batch`。

---

## 验收清单（整体）

- [ ] `python -m pytest`（PYTHONUTF8=1）全绿，覆盖率 ≥90% 不回退
- [ ] 手动冒烟：新建 tmp 项目跑 init → 写一章 → review → chapter-commit → projections retry → dashboard 启动
- [ ] `git grep -n "checkout master"` 在 scripts 下零命中
- [ ] 无 key 环境跑一次 chapter-commit，抓包/日志确认零出网请求
- [ ] README 版本表未被改动（CI 硬约束）
