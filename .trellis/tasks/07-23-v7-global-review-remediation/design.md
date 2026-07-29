# 技术设计：v7 全局评审整改

## 1. 设计边界

本任务横跨文档真源、CLI 入口、宿主壳生成、体检策略和发布元数据。行为变更遵守“先改 PRD/spec，再改代码”的项目规则；纯历史/措辞修订不扩大运行时行为。

执行分为两条可并行轨道：确定性的文档/元数据/CLI/SKILL 序号修复不等待策略决策；基线、重试、hook 和 spec 分发只在各自决策完成后进入行为实现。GPL v3 已由 owner 确认，不再属于待决策略。

安全闭环是不可变约束：

`契约更新 → 全部未发布工件待重做 → 重做后原始定稿包 hash 证明 → commit confirmed 精确释放`

以及：

`完整 ReviewInput → 确定性令牌 → sidecar/两审/外层同令牌 → 锁内重组复核 → 暂存/定稿再次复核`

评审提出的“只用版本号”或“有批次就禁止契约更新”会改变产品能力和安全保证，本任务不采用。

## 2. 真源与同步矩阵

| 主题 | 真源 | 派生/消费者 | 处理方式 |
|---|---|---|---|
| 批次周期 | PRD + story-repo-spec + `book-config` 默认值 | state-machine/staging/SKILL | 先统一术语和默认值，再跑状态机/批次测试 |
| 缓存表与实体类型 | story-repo-spec + cache-design | cache schema/rebuilder/注释/实施计划 | 代码行为保持 `organization`/六表，清理误导性文字 |
| 宿主提示 | `v7/skills`、`roles`、registry | `dist`、installer | 只改源，生成器重渲染，不手改 dist |
| 文体基线 | owner 决策 + book.yaml/spec | health-check/staging/mechanical-check/tests | 完整配置区间才建基线；消费者只读精确区间 |
| 重试/hook | owner 决策 + multi-agent spec | 重试预算脚本/SKILL/installer/状态机 | 每章持久计数；alpha 不安装 PreToolUse |
| 许可证/版本 | 根 `LICENSE` 现行 GPL v3 + package metadata | README/npm pack/lockfile | GPL v3 已确认；不建立独立授权口径，`v7/LICENSE` 使用根许可证的等值副本随包分发 |

## 3. 文档整改

1. 搜索所有批次周期表述，不只改第 85 行；把手动 `体检周期` 与自动 `连写批次大小` 的关系写成“自动模式按批次体检”，不声称两个默认值相等。
2. cache-design 的 DDL 注释、重建清单和校验清单与六表/`organization` 对齐；`v7/src/cache/index.js` 和现行实施计划中的旧“五表”文字要更新或显式加历史标签。
3. story-repo-spec 如实记录同一个 `批次.json` 章状态枚举：`待审收/打回/受影响/契约变更`。污染传播只使用前三态；`契约变更` 由契约失效机制赋予（`v7/src/staging/index.js:70`），不是第二套平行状态机；同时更新决策 57 索引。
4. 评审历史只作为证据，不在产品法律文本形成第二份当前答案；历史摘要可以保留，但必须标明版本和失效范围。

## 4. CLI 与壳生成

`v7/bin/webnovel-writer.js` 使用 `pathToFileURL(commandPath).href`，保留现有命令白名单、动态导入和中文错误处理。新增测试应通过真实子进程覆盖 `#`、`%`、空格、中文和不存在命令路径，确认编码与退出行为。

SKILL 的序 4/5 展示顺序属于无条件修复，可以立即改源并生成所有宿主壳。重试说明、hook 声明和 spec 分发文字属于决策相关修复，只在对应选择确认后修改；若再次改动源文件，必须再次生成宿主壳。所有变更都只改源文件，随后检查 TOML/Markdown 角色和安装器输入。

`build-host-shells --check` 只验证生成器确定性与 validator，不宣称它能比较被忽略的磁盘 dist；如要保留 dist 作为开发便利产物，另加显式 compare 脚本，不把它作为 npm 发布真源。

## 5. 基线与重试设计

### 基线

- `文体基线起/止` 必须是正整数且起不大于止；配置的闭区间每章都存在才建立基线。
- 不完整时体检明确报告“尚未建立基线”，不写部分前缀；机检、批次质检和漂移报告都静默跳过基线比较。
- 所有消费者按当前配置的精确起止查询，不能用“最大的历史基线”。作者改区间时移除旧活动基线，完整后建立新基线。
- 冻结的是章段而不是数据库快照；`fingerprints` 仍是可删派生物，缓存刷新后由下一次体检从同一章段确定性重算。

### 重试

- 机器记录固定为书仓库 `工作区/重试预算.json`，schema 版本化并按章号保存，跨宿主和会话共享；畸形记录 fail closed，不猜测剩余额度。
- 机检首次失败只开启修复循环；之后每次重检代表消耗一轮自动修复，最多两轮。第三次仍失败时返回“自动修复已用完”，SKILL 必须停下交作者，不能继续自动改稿。
- 每次 `review-input` 签发代表一轮两审：完整模式一轮两次 AI 调用，兼容模式一轮一个顺序审上下文。自动额度为初审一轮加重审一轮；第三轮自动签发必须拒绝。
- 作者裁决冲突/歧义后，使用原报告和同一 ReviewInput 重新 `save-review` 不计新一轮。确需再次调用两审时必须使用显式作者批准参数；该轮单独记账且不恢复自动额度。
- 章节提交确认后清该章记录；丢弃批次时清该批全部章。计数写入与 ReviewInput 签发共用作品状态锁，避免并发超发。

### Hook 与包边界

- alpha 不生成或安装 `PreToolUse`。`SessionStart` 只注入书单上下文；`next` 序 2 是事后自愈兜底。未来 hook 仍只能 ask，不能 deny。
- npm `files` 不使用宽泛 `docs/`；只列 `docs/knowledge/` 与 `docs/migration-guide.md`。pack、install 和 init 后目录都做负向断言，禁止 `story-repo-spec` 或 `docs/architecture/` 进入产物。

## 6. 发布与回滚

- 发布前以 `npm pack --dry-run --json` 检查包白名单、版本、与根 `LICENSE` 等值的随包许可证文件和 docs；包内不应出现 v6 树。
- 文档修改可单独回滚；CLI 修复必须和回归测试同批回滚；GPL v3 元数据与打包文件作为一批同步和回滚，禁止留下根仓库与 v7 授权不一致的中间状态。
- 若基线/重试策略实现导致现有 635 条测试或契约 guard 回归，优先回退行为代码，保留决策与证据文档，重新规划。
