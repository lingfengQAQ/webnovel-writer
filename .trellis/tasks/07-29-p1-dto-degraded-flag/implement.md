# 实施计划：DTO 静默降级显式标记（F6）

前置：v7 分支 397b133 之后；695 测试绿基线。TDD。

- [ ] **S0 降级点普查（必须先做）**：全量列 adapters/prep/review/dto/state-machine 的 catch 站点（规划期粗扫 21 处），逐处标三分类（有损/良性/合理吞错）+ 判定理由，留档本任务 `research/degradation-sites.md`。产出清单交作者过目后才动代码（review gate 1）。
- [ ] **S1 收集器**：`util/degradation.js` + 单测。
- [ ] **S2 ctx 挂载 + 有损点接入**：按 S0 清单只接「有损」点；良性点按 S0 裁决（诊断日志或不动）。
- [ ] **S3 DTO 收口**：备料 / assembleReviewInput / state-machine dto 三处 drain 写 `degraded`；persist.js 期望产物说明同步（R4）。
- [ ] **S4 故障注入集成测试**：AC 三场景（有损→带标记；良性→不带；无故障→键不存在）。
- [ ] **S5 SKILL/角色消费约定** + 重渲染四宿主壳 + drift check。
- [ ] **S6 全量回归** + spec 回填（story-repo 决策条目 + DTO 契约节）+ 提交。

Review gates：S0 清单签收；S6 前故障注入输出贴任务目录。

回滚点：每步独立；S2 接入点可按清单逐项摘除。
