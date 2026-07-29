# 执行计划：v7 全局评审整改

## Phase 1：决策与证据（与确定性修复并行；策略实现不得先行）

- [x] 1.1 阅读 `research/评审核验基线.md`，确认当前 HEAD、评审裁定和删除边界。
- [x] 1.2a 记录 owner 已确认的 GPL v3 选择。
- [x] 1.2b 收敛基线策略、重试预算、PreToolUse 和 spec 分发四项选择；未决项只阻断各自的策略实现，不阻断下列确定性修复。
- [x] 1.3 更新 PRD/spec 的已决行为条款，确保实现者不需要从评审原稿猜测语义。

并行边界：2.1-2.4、3.1-3.3 都不依赖剩余四项策略决策，可以与 Phase 1 并行；Phase 4 以及 3.4 中对应的策略文字必须等待相关决策落定。

## Phase 2：确定性文档与元数据修复

- [x] 2.1 `[可并行]` 全量修订 PRD 批次口径（85/258/372 等所有命中点）。
- [x] 2.2 `[可并行]` 修订 cache-design、cache 注释和现行实施计划的五表/`faction` 旧口径；历史材料加版本边界。
- [x] 2.3 `[可并行]` 修订 story-repo-spec：`章状态` 的完整枚举包含 `待审收/打回/受影响/契约变更`；其中污染传播流程使用前三态，`契约变更` 是同一 `批次.json` 章状态枚举中的取值，由契约失效机制赋予（`v7/src/staging/index.js:70`），不是第二套平行状态机；同时核对决策 57 记录。
- [x] 2.4 `[可并行，GPL v3 已决]` 以根 `LICENSE` 的现行 GPL v3 授权为真源，同步 README、PRD、v7/package.json 和 package-lock，并在 `v7/LICENSE` 放置根许可证的等值副本供 npm 包分发；不得建立独立授权口径，也不得扩大或缩小现有授权范围。

## Phase 3：运行时与宿主链

- [x] 3.1 `[可并行]` 用 `pathToFileURL` 修复 CLI 动态导入。
- [x] 3.2 `[可并行]` 添加特殊字符路径真实子进程回归测试。
- [x] 3.3 `[可并行，无条件]` 修正 SKILL 的序 4/5 展示顺序，重新生成所有宿主壳；禁止直接编辑 dist。
- [x] 3.4 `[决策已完成]` 按已确认的基线/重试/hook/spec 分发决策更新 SKILL、multi-agent spec 和包边界；角色任务书不含这些编排策略，无需伪造改动。如源文件改变，再次生成所有宿主壳。
- [x] 3.5 运行 host-shell tests、生成器 `--check` 和安装 e2e。

## Phase 4：策略实现（各项在对应决策完成后分别执行）

- [x] 4.1 按选定基线策略同步 health-check、staging、mechanical-check、配置默认值、报告和测试。
- [x] 4.2 按选定重试策略实现计数/呈报/降级行为；分别覆盖机检、两审重跑和作者裁决重提。
- [x] 4.3 按 hook 决定更新 installer/spec 或写明确的 deferred 声明；不得让关键能力只依赖 hook。

## Phase 5：后置项转交

- [x] 5.1 在 `research/后置债务清单.md` 登记 staging 拆分、SQL 去重、字数容差、650 章压测、语义检索 RFC 和仓库清理，且各有负责角色、触发条件和独立验收入口。
- [x] 5.2 迁移文档只补 Dashboard/实体图谱尚未解释的能力回退，不重复改已存在的“迁了什么/没迁什么”。

## Validation Gate

- [x] `npm --prefix v7 test`：638/638
- [x] `node --test v7/test/references/format.test.js`：10/10
- [x] `npm --prefix v7 run e2e:install`
- [x] `node v7/scripts/build-host-shells.mjs --check`
- [x] 所有受影响 JS/MJS `node --check`：5/5
- [x] `python ./.trellis/scripts/task.py validate .trellis/tasks/07-23-v7-global-review-remediation`
- [x] `git diff --check`，另对新建任务文档做未跟踪文件空白检查
- [x] 复核契约 guard、ReviewInput 令牌、批次状态洗回、提交未知和旧审稿回流测试未回归

## Risk / Rollback Points

- 文档真源改错：回退同一文档批次，不改运行时代码。
- CLI URL 修复：必须与回归测试同批；失败时回退两者。
- 基线或重试策略：先回退行为实现，再保留已批准决策，禁止通过放宽 guard 让测试变绿。
- 许可证：GPL v3 已由 owner 确认；同步出错时整批回退相关元数据和打包变更，不留下根仓库与 v7 授权不一致的中间状态。
