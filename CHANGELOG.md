# Changelog · DSH Scriptor (v8)

此处记录 DSH 工作台安装包版本。v6 的更新记录保留在 master 分支。

## Unreleased

## [0.1.0-preview.6] — 2026-09-25

修复作者保存后的重复设计调用、审核回写与快速设计流程，补齐新手图文教程。主包与完整版同步升级；嵌入提供方保持 0.0.8。升级不会自动改写旧书的占位设计或历史偏离，需按进度提示补充真实内容。

### Fixed

- **书房保存后反复更新契约**（#167）：保存通知收敛为核对并报告；六类设计工具明确区分成功无改动与提交失败，同一轮重复执行相同的成功空操作时结束轮次，保留下一轮作者继续修改的能力。同步约束失败补试与禁止自动滚窗。
- **npm 发布器的 `latest` 判定**：npm 会把包的首个版本同时标为 `latest`（无论是否指定 `--tag preview`），且不允许删除该标签。preview.5 首发时三个包均已成功上传，但发布器把这一固定行为当作污染而在上传后的校验阶段失败。现只在 registry 已有正式版本、而 `latest` 仍指向预览版时才拒绝；首发同时持有 `preview` 与 `latest` 视为正常。
- **审核回写的待办清单**（#162）：`novel_record_review_findings` 的「待回写模块」此前只从审核记录已有的模块键里筛，首轮与重置轮都返回空，与「完成: false」矛盾，主 Agent 看到「尚待回写模块：无」会提前停下。现与「完成」同源（注册模块全集减去已回写），并新增「待继承处置数」：重置后明示上一轮处置暂存待继承的条数与沿用规则。
- **不经 seed 建的书卡在「世界构建」**：开写门槛只认模块声明里登记过的模块，此前只有测试用 seed 会登记，经工具确认世界书条目的书过不了这一步。现建书时即在 `世界书/模块声明.md` 登记最小模块（人物档案、世界规则）。
- **确认细纲的窗口门槛提示**（#163）：章名与窗口条目对不上时，提示里列出当前可进入的条目名，不必反复试窗口。
- **空设计提示的段落边界**：未标注状态的同级标题也结束上一部，空子标题与 HTML 注释不再冒充正文；设计技能补充原生读取要求及快速/逐部路径的区别。

### Changed

- **seed 改为测试/走查专用**（#163、#165）：`novel_seed_min_design` 只写占位确认态（各部只有「已确认」标注、没有正文），此前却是作者的「快速开写」入口。现默认不注册：测试经 `testTools` 开启，走查设环境变量 `WEBNOVEL_TEST_TOOLS=1`。《定调设计》路径 A 改为 Agent 按构想快照一次起草全部设计，作者过目确认后经现有设计工具写入。
- **标出「已确认但无内容」**（#165）：进度卡逐行标「无内容」并在卡首汇总，`novel_get_story_status` 的设计面新增「已确认无内容」清单；只提示补内容，不改变推导。

### Documentation

- 新增新手图文教程、界面按钮参考和增强索引指南，补主模型逐字段配置；纠正后台索引、查询外发和重新识别场景的费用说明。教程使用本版安装命令并注明配图的演示版本，拍摄分镜移出读者正文。

## [0.1.0-preview.5] — 2026-09-21

preview.4 的发行构建在 Windows runner 上失败，本版只修发行链路，产品代码与 preview.4 相同。

### Fixed

- **发行验收的 Windows 权限**：隔离加载验收给 Node 的读取授权此前只有一拼写，托管 runner 的临时目录同时存在 8.3 短名（`RUNNER~1`）与规范长名，规范化后不匹配即被拒（`ERR_ACCESS_DENIED`）。现按读写分别授予短名、规范名、尾分隔符与临时目录通配四种拼写，普通权限与托管 runner 都能通过。
- **完整版卸载验收**：`pnpm remove` 没有 `--registry` 选项，移除 meta 包会重新解析依赖树，于是去 registry 找尚未发布的主包而失败。改为在隔离 profile 的 npmrc 中指向临时本地 registry。

## [0.1.0-preview.4] — 2026-09-21

准备首次 npm 发行的预览版，恢复完整版 meta 包发行并补齐安装验收。

### Added

- **npm 发行流程**：为 `@linfengqaqtat/dsh-scriptor@0.1.0-preview.4`、`webnovel-embedding-provider@0.0.8`、`@linfengqaqtat/dsh-scriptor-full@0.1.0-preview.4` 增加 Release 发布后的自动上传（dist-tag `preview`）。校验全部包与 SHA256 后上传同一 tarball；重跑只跳过 registry 字节完全一致的版本。npm 工作流成功后可执行 `dsh plugin add @linfengqaqtat/dsh-scriptor@preview`，GitHub Release 保留同字节 tarball。
- **完整版恢复**：增加 DSH 组合配置，`dsh plugin add @linfengqaqtat/dsh-scriptor-full@preview` 同时安装并启用主插件与可选嵌入提供方；增加独立 profile 的加载与卸载重装验收。

### Changed

- **构建工具升级**：源码构建与宿主插件管理统一为 pnpm 11.27.1，消除 pnpm 9.x 25 个未修复安全公告（含锁文件完整性绕过）的构建环境暴露；`allowBuilds` 仅放行 esbuild/koffi。
- **Windows 测试**：按真实路径连接各个依赖，普通权限可运行宿主集成测试，不再要求创建目录 symlink。
- **嵌入设置客户端**：模块注册名从实际包名读取，修复改名后仍注册到旧内部名称的问题。

## [0.1.0-preview.3] — 2026-09-21

首个面向公开安装的开发预览版。`scriptor-v0.1.0-preview.1` 与 `scriptor-v0.1.0-preview.2` 标签存在但没有对应 Release：前者的发行构建在 GitHub Windows runner 上因 `core.autocrlf` 把生成的许可证文本签出为 CRLF 而被干净树检查拒绝；后者在同一 runner 上安装隔离 DSH 宿主超过 4 分钟被验收脚本自身的超时中止。本版仅修正发行流程，产品代码与 preview.1 相同。

### Changed

- **包命名统一**：可选嵌入提供方由 `@webnovel/embedding-provider` 更名为 `webnovel-embedding-provider`，公开分发包不再使用内部 scope
- **完整版 meta 包暂缓提供**：`@linfengqaqtat/dsh-scriptor-full` 的依赖（主包与嵌入包）尚未发布到 npm，本地 tarball 安装会被 pnpm 解析到 registry 而 404；待包发布到 registry 后再随发行提供

### Migration

如已安装旧的 `@webnovel/embedding-provider`：
1. 卸载：`pnpm remove @webnovel/embedding-provider`
2. 安装新版：`pnpm add path/to/webnovel-embedding-provider-0.0.8.tgz`


### Fixed

- `.gitattributes` 覆盖 `.txt`、`.css`、`LICENSE` 与点文件，生成的第三方许可证文本在任何 Git 行尾设置下与仓库一致。
- 发行工作流签出前禁用 `core.autocrlf`；安装验收对宿主安装步骤放宽到 15 分钟。
- 死亡租约恢复测试在书仓锁外中断子进程；夹具清理超时放宽到 60 秒。
- 备份指南补充 Windows 上整目录恢复与只读 Git 对象的处理。

### Added

- 本地小说书仓、作品设计、章细纲、写稿、审读、改稿、定稿与记忆流程。
- 原生书房编辑、定稿检索、章节/关联视图和定稿导出。
- 卷摘要候选、卷末核对及暂停后的文件状态恢复。
- 公开源码构建、自动化检查、安装包校验、贡献规范与使用教程。

### Packaging

- 主包 `@linfengqaqtat/dsh-scriptor`，运行技能与脚本随包交付。
- 可选 `@webnovel/embedding-provider` 0.0.8：嵌入、场景识别与重排；首次安装默认停用。
- 继承 GPL-3.0-only，补齐实际内联依赖的许可证与源码材料。

### Compatibility

- Windows；Node 22.19.0 起的 22.x 或 24.x，推荐 24.15.0；pnpm 11.27.1（源码构建与宿主插件管理统一）；DSH 0.1.5-rc.2。
- 预览期配置与书仓契约可能变化，升级前备份。v6/v7 书仓没有自动迁移承诺。
- tarball 使用无空格安装路径；主包保留 npm 发布保护，通过 GitHub Release 分发。

### Known limitations

- Linux/macOS 尚未完成产品安装和浏览器验收。
- API 连接、模型效果、速率限制和账单由所选服务决定；单元测试不代表真实模型质量。
- 不支持把 Web 工作台未经保护地直接暴露到公网。

## [0.1.0-preview.2] — 2026-09-21

未产生 Release（见 preview.3 说明）。

## [0.1.0-preview.1] — 2026-09-20

未产生 Release（见 preview.3 说明）。
