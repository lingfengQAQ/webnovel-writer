# Implement：知识库十维集成审计

> 当前状态：in_progress。作者已批准续做并完成 `task.py start`；批次 1–5 的实现、审计与最终质量门已完成，作者于 2026-07-23 签收，进入提交与归档。

## 门 0：启动前检查

- [x] 0.1 核对父任务 PRD A1–A32、design、implement 阶段 6 与五个归档子任务的完成状态。
- [x] 0.2 汇总挂账清单成 `research/挂账清算表.md`:S1–S3/S5–S7、终测卡点 2 项、转交项(诊断族/人物候选 3 条/TR-073)、codex review Minor 2 项、文风纪律(真源=策展规则.md 第 7 节)覆盖范围。
- [x] 0.3 作者审核规划后 `task.py start 07-10-knowledge-integration-audit`。

## 批次 1：全库结构审计

- [x] 1.1 脚本扫描:十维 286 条名称唯一性、文件名与 FM 名称一致、路由.csv 与题材/流派目录对齐、FM 字段严格匹配各维白名单(章级/故事对象白名单见 knowledge-runtime.md;书级作品契约白名单以 `src/knowledge/contract.js` 校验器为准,spec 已补录)。
- [x] 1.2 跨维近重复抽样:重点对 创意约束↔设定(不可逆代价/能力代价)、创意约束↔节拍、技法↔场景/节拍边界带;每处给保留/合并/锐化结论。
- [x] 1.3 文风抽样:书级与故事对象维度(未过文风整改)各抽 10 条,按策展规则第 7 节核查工程词;命中面大则单列小批整改。
- [x] 1.4 产出 `research/结构审计报告.md`。

## 批次 2：全链行为审计

- [x] 2.1 以测试清单盘点调用覆盖:建书(pack/query/契约)、对象(design/factChanges)、章级(声明/注入/历史)、审稿、finalize、卷末复盘;列出无测试覆盖的调用点并补最小行为测试。
- [x] 2.2 降级路径核对:空目录/未命中/自定义/契约缺失全部不阻断或明确报错,与 spec 错误矩阵一致。
- [x] 2.3 负向断言测试:无评分/章后反馈/作者扩库命令、无作品契约旧路径回读、无知识条目旧标题 fallback、无解析而无人读的字段。
- [x] 2.4 产出 `research/行为审计报告.md`。
- [x] 2.5 二次对抗纠偏：卷复盘写边界重验契约；确认细纲时冻结来源快照；事实选项 `applyChange` 与 false no-op；契约失效“待重做→待提交原包 hash 证明→commit confirmed 精确释放”，覆盖包篡改、批次状态洗回、提交未知、打回/restage/discard 和二次更新；完整 ReviewInput 令牌阻断契约更新前旧两审结果延迟回流。证据见 `research/行为审计报告.md`、`research/一致性核对.md` 与父 A22/A26/A27 映射。

## 批次 3：反同质化实测

- [x] 3.1 同题材两书样例：固定路由重复执行保持确定性且不含创意答案；同一分类下两套机制不同的作品契约均通过真实校验，证明不收敛到唯一方案。
- [x] 3.2 复合题材样例:主+副题材融合协议生成可执行且不同组合各异。
- [x] 3.3 明确作者样例:已定构想不被强制发散;空白作者获得少量方向包而非全量菜单。
- [x] 3.4 同章任务候选两次实测 + 近期历史软降权行为核对(合法复用不硬禁)。
- [x] 3.5 产出 `research/反同质化实测.md`。

## 批次 4：挂账清算与一致性对齐

- [x] 4.1 挂账清算表逐项落定:本轮修复(小修直接做)或登记后续任务与触发条件;转交项(人物候选 3 条、诊断族、TR-073)明确去向。
- [x] 4.2 README/治理文档/spec/技能/installer/fixture 与最终状态一致性核对;未决清单清零。
- [x] 4.3 产出 `research/父AC证据映射.md`:A1–A32 逐条给证据路径或缺口说明。

## 批次 5：收口

- [x] 5.1 全量验证:format 10/10、全量测试 635/635、e2e:install、宿主壳生成/漂移、59 个 JS/MJS 语法检查、`git diff --check` 与父子 task validate 全部通过；详见 `research/质量门记录.md`。
- [x] 5.2 作者审阅审计报告与 AC 映射并于 2026-07-23 签收；提交、归档按“先子任务、后父任务”执行，父任务已按映射回写 AC。

## 验证命令

```powershell
node v7/scripts/build-host-shells.mjs
node v7/scripts/build-host-shells.mjs --check
node --test v7/test/references/format.test.js
npm --prefix v7 test
npm --prefix v7 run e2e:install
python ./.trellis/scripts/task.py validate 07-10-knowledge-integration-audit
python ./.trellis/scripts/task.py validate 07-10-knowledge-taxonomy-governance
git diff --check
```

## 风险与回滚点

审计只修明确错误并保持单点可逆。A22 纠偏跨 `review / staging / finalize / state-machine`，须作为一个行为闭环提交与回退，不能只撤守卫或只撤审稿绑定；章级来源快照也须连同持久化、清理、失效和测试一起回退。其余内容修复按批次分组，回退单批不影响审计记录。
