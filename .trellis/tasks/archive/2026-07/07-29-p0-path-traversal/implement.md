# 实施计划：P0 路径穿越修复（F1-F5）

前置：基于 v7 分支最新（665 测试绿基线）。TDD：每步先写攻击样例红测再实现。全程 inline 或 trellis-implement 派发均可；提交按步骤分层。

## 步骤清单（按序）

### S1 单源工具 + 单测（design §2）
- [ ] `util/filename.js` 加 `isSafeFileStem`；`util/positive-int.js` 加 `parsePositiveInt`
- [ ] 单测：合法干（`信息差-021-血书真相`）通过；`../../x`、`..`、`a/b`、`a\b`、`C:\x`、空串、`.hidden`、`CON`、含 `\n` 全拒；`parsePositiveInt` 对 `"3"`/`3` 过，`"3.5"`/`"-1"`/`"0"`/`"1e3"`/`"abc"`/`" 3 "`(trim 后过) 按口径判
- 验证：`node --test test/util/`

### S2 F4 总闸（design §3-F4）
- [ ] 攻击红测：`writeAtomicBatch(repo, [{path:'../外部.md',...}])` 抛错、仓外零文件、tmp 清理
- [ ] `atomic.js` 加边界断言（mkdir 前）；核对 `workspaceRemovalIsContained` 是否可抽公共 helper（同构才抽，否则注释互指）
- 验证：`node --test test/storage/`

### S3 F1/F2 Writer 自卫 + payload 校验（design §3-F1/F2）
- [ ] 红测：SecretWriter `id='../../x'` 拒绝且零建目录；TimelineWriter `volumeNum='../../x'` / `0` / `'3.5'` 拒绝
- [ ] Writer 层校验；finalize payload 校验层加 `secretWrites[i].id` / `timelineRows[i].volumeNum` 检查（报错带索引定位）
- [ ] **R6 核对**：staging `stageChapter` 链路 import 同一校验函数（跑 staging 侧同款攻击测试确认）
- 验证：`node --test test/storage/ test/finalize/ test/staging/`

### S4 F3 卷复盘伏笔 id（design §3-F3）
- [ ] 红测：`persistVolumeReview` 伏笔条目 `id='../../x'` / `'悬念-1'`(非伏笔前缀) / `'伏笔-1/x'` 拒绝
- [ ] `state-machine/persist.js` 撞号检查前加逐条校验
- 验证：`node --test test/state-machine/`

### S5 F5 十站点章号/卷号（design §3-F5）
- [ ] 10 命令替换为 `parsePositiveInt`（清单见 prd Background；finalize-batch 是 `--until`）；文案补「正整数」
- [ ] 每站点至少一条 `"3.5"` 或 `"-1"` 拒绝测试（可合并成参数化用例）
- 验证：`node --test test/commands/`

### S6 全量回归 + 收尾
- [ ] 全量 `node --test`（预期 665+新增全绿）+ drift check
- [ ] 攻击样例端到端探针：`finalize --payload=<含三攻击字段的json>` 人话拒绝、`git status` 干净、仓外零残留（可仿 07-06 probe 形状留档 task 目录）
- 验证命令：`cd v7 && node --test && npm run drift-check`（以 package.json scripts 实名为准）

### S7 spec 回填 + 提交
- [ ] backend error-handling spec 加输入→路径白名单条目；story-repo spec 决策条目（design §6）
- [ ] 提交分层：S1-S2 一 commit（工具+总闸）、S3-S5 一 commit（三入口+十站点）、spec 一 commit；或按实际粒度合并，保持「测试与实现同 commit」
- [ ] 父任务 prd.md 勾选 F1-F5 复选框

## Review gates

- S2 后：总闸口径（startsWith + sep 的 Windows 行为）人工过目
- S6 后：探针输出贴任务目录，作者确认后进 S7

## 回滚点

每步独立可 revert；S5 若某站点文案争议可单独摘除不影响 S1-S4 安全性。
