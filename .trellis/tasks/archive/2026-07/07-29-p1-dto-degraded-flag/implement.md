# 实施计划：DTO 静默降级显式标记（F6）

前置：v7 分支 397b133 之后；695 测试绿基线。TDD。

- [x] **S0 降级点普查（必须先做）**：全量列 adapters/prep/review/dto/state-machine 的 catch 站点（实测 85 站，非规划期粗扫 21 处），逐处标三分类（有损 11+3 锚点/良性 3/合理吞错 44/透传 28/范围外 193）+ 判定理由，留档 `research/degradation-sites.md`。清单交作者过目（签收：全收 + adapter 第三参 + 良性零处理）后才动代码（review gate 1 已过）。
- [x] **S1 收集器**：`util/degradation.js` + 单测 3 例。
- [x] **S2 ctx 挂载 + 有损点接入**：S0 发现「ctx 不达 adapter」（Reader 签名全部 `(repoPath, cache)`），按签收口径改构造函数第三参（SecretReader/ThreadLedgerReader/EntityReader）；组装层 7 处直报；A1-A3 锚点同接；bin ctx 挂收集器。
- [x] **S3 DTO 收口**：备料材料文本段 + 返回值 / assembleReviewInput **bind 前注入**（令牌覆盖）/ mk() 统一兜底三处 drain；dto.js 序4/序6 期望产物说明同步（R4 实指 dto.js 文案，persist.js 无此文案）。
- [x] **S4 故障注入集成测试**：AC 三场景（有损→带标记含定位；良性→不带且数据不缺；无故障→键不存在）9 例全绿，输出留档 `fault-injection-output.txt`。
- [x] **S5 SKILL/角色消费约定** + 重渲染四宿主壳（四壳均含 degraded 段）+ drift check 绿。
- [x] **S6 全量回归**（704/704 绿）+ spec 回填（story-repo-spec 0.20 决策 63）+ 提交（待作者确认）。

Review gates：S0 清单签收；S6 前故障注入输出贴任务目录。

回滚点：每步独立；S2 接入点可按清单逐项摘除。
