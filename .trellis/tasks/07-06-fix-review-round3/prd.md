# M1-M7 第三轮 review 修复（P1×12 / P2×18 / S×10）

## Goal

把 07-05 第三轮全量 review 的修复 backlog 全部落地（真源：`.trellis/tasks/07-05-m1-m7-review/review-m1-m7.md`）。三个病根一次收口：

1. **互斥不变量只写在 spec 没写进代码**——goto / 手动 finalize 对进行中批次零感知（R1/R2）。
2. **"防呆"序列化器有系统性漏网**——写出的 front matter / book.yaml / 表格自己读不回（R7/R8/R9/R11）。
3. **迁移书实体在缓存里隐身**——类型值中英文断裂、别名分隔三源分裂、一对多别名硬回滚（R5/R6/R10）。

外加 P2×18 稳健性清扫、S×10 卫生项、3 条 spec 条款回填（G-3/E7/B-S）、测试基建补缺（G-1 gitBookCtx 对齐真实建书、G-6 bin spawn 冒烟）。

## 范围与批次（按 backlog 三批 + 基建前置）

- **批 0（测试基建前置）**：G-1 gitBookCtx 对齐 persistCreateBook 真实仓库形态——R1/R2 的回归测试依赖"工作区不被 git 跟踪"这一真实形态，必须先修脚手架。
- **批 1（数据安全 + 互斥守卫）**：R1 R2 R3 R4 R7 R8 R12，顺带同文件的 C2/G-4（finalize 清理 `..` 守卫与前缀归一）、C4（stageChapter `..` 判定统一）。
- **批 2（迁移链）**：R5(+G-3 规范落点) R6(+A13) R9 R10 R11(+A7/A8/A11 表格解析读写对称)。
- **批 3（P2/S 清扫）**：A6 A9/C3 A10/F-7 A12 A14 A15 A16 A17 B1 B2 B-S E3 E4 E5 E6 E7 E8 E9 D3 D4 D5 D6 F-4 F-5 F-6 F-8 F-9 F-10 G-5 G-7 G-8 G-9 B(imagery_top) + G-6 spawn 冒烟。
- **收尾**：上轮探针场景固化为回归测试 + 全量测试 + spec/PRD 版本回填。

## Acceptance Criteria

- [x] AC1 上轮 11 条 CONFIRMED P1 的探针场景全部按修复后语义通过：P-1/P-2（goto/手动 finalize 被守卫人话拒绝）、P-3（合法 book.yaml/名册修复被接受）、P-5（迁移书 list-characters 可见）、P-6（全角分隔别名全部命中）、P-7b（commit 后清理失败不改写 ok）、A/F 区序列化器往返用例全绿。
- [x] AC2 每条 P1（R1-R12）至少一条针对性回归测试进正式测试套件；R12 附故障注入用例。
- [ ] AC3 全量测试绿（存量 429 + 新增；过时的文案级断言按「测试是探针不是约束」修正），CI 六 job 绿。
- [x] AC4 spec 侧收口：G-3 名册「类型」列取值约定、E7 批次.json 持久字段口径、B-S 重建事务边界（解析失败=跳过+warning / 完整性违反=硬错回滚）写入 story-repo-spec / database-guidelines，spec 版本号 + 决策表更新。
- [x] AC5 修复不引入新功能、不改命令面（除新增守卫的人话拒绝路径）；REFUTED 4 条不动。

## Out of Scope

- ❌ 批次 git 分支化 / PR 式审稿 / 本地 web 服务（用户已裁决：另行再议）
- ❌ 批次审稿总单等体验增强（未裁决）
- ❌ v6 遗产代码（webnovel-writer/ 冻结）
- ❌ 性能优化（除非构成正确性问题）
