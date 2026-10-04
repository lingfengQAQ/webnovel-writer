# CI 维护与失败排查

## 检查分工

- `v8-policy` 在 Linux 执行完整公开历史扫描、版本、audit、lint 和发行脚本测试。
- Windows 的 Node 22.19.0、24.15.0 各执行两个互不重叠的测试分片，每个版本仍覆盖全部包测试。每个 worker 保持文件隔离，单台最多两个测试进程；构建、类型和实包检查在各版本的第一个分片执行。
- `v8-required` 必须同时等待 policy 和全部 Windows 分片成功。Linux 运行时观察任务继续保留。
- 标签发行运行一次完整根测试，再打包并验收同一批安装包。根测试覆盖所有包，不能再次串行跑相同的包测试。`ci-workflows.test.mjs` 使用真实 Vitest 文件发现与分片器核对完整性。

## 历史失败复盘（2026-10-04）

审查范围为当时可获取的 56 次 v8 CI、14 次 Release、7 次 npm 工作流，并检查失败后重跑成功的早期 attempt。

| 类别 | 证据与处理 |
| --- | --- |
| 补偿测试超过 15 秒 | [8.1.0 发布](https://github.com/lingfengQAQ/webnovel-writer/actions/runs/37133126010) 两次 attempt，以及 [preview.7](https://github.com/lingfengQAQ/webnovel-writer/actions/runs/36428968244) 都命中 `retcon-retry-receipt.spec.ts`。现复用一次真实建书准备，各用例完整复制为独立书仓和 Git 历史；断言、用例数和超时保持原值。 |
| Windows 测试进程意外退出 | [8.1.1 首次发行测试](https://github.com/lingfengQAQ/webnovel-writer/actions/runs/37191335305) 与历史三次 attempt 出现 `Worker exited unexpectedly`。日志不足以证明具体原生崩溃原因；不把重跑成功当作根治。新增父进程检查点与 Node fatal report，继续保留失败语义。 |
| npm 接收上传但版本尚不可见 | [8.1.1 npm 发布](https://github.com/lingfengQAQ/webnovel-writer/actions/runs/37192544632) 与多次历史发布均超过原来的短轮询窗口。现把提交和验证分阶段；尚未就绪保留 draft，待可见后使用 `phase=verify`，不重传原件。 |
| 旧路径、权限、包名或错误契约 | 早期包括 Windows 短路径、隔离安装权限、未发布依赖名、旧宿主错误格式和许可证行尾。对应修复已进入基线；相关检查继续保留，不能把这些真实错误一概归为超时。 |

## 诊断材料

Windows CI 和发行测试保存 `.tmp/ci/` 为带 Node 版本、分片及 attempt 标识的 artifact，保留 14 天：

- `results.json`：具体用例、失败与耗时。
- `progress.json`：父进程记录已完成、正在运行和尚未启动的文件；worker 意外退出时仍可定位最后文件。
- `loader.json`：真实宿主夹具的阶段及检查结果。
- Node fatal report：仅在 Node 能捕获的致命错误时生成，启用 `--report-exclude-env`，不记录环境变量。没有报告不能证明没有原生崩溃。

失败时先看具体断言及最后活动文件，再确定是否是测试进程异常或外部服务等待。不要全局提高超时、跳过失败断言或自动重试整个测试套件。需要重跑时保留原 attempt 的材料。

## 提速证据与边界

同机、同一公开树（643 文件、48 个提交）的完整历史扫描，批量读取 Git 对象后约从 92.6 秒降到 4.8 秒；仍逐提交检查所有路径、模式，并校验每个唯一 blob。每批约 8 MiB、单个对象保留原 16 MiB 上限，二进制按 Git 声明的字节数解析。

补偿测试的 30 个用例同机约从 112 秒降到 75 秒，最慢单项约从 7.1 秒降到 4.6 秒。测量包含本机负载，不保证每次 CI 都有相同比例；最终耗时以工作流记录与 artifact 对比为准。

PR、合入及 tag 的事件级检查仍保留；尚未引入跨提交的成功结果复用。减少重复的发行测试和单次扫描，不等于省略实际安装、包完整性或跨版本检查。
