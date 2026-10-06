# GitHub Pages 站点维护

公开仓库的产品站点由 `site/build.mjs` 生成：一个介绍首页（含视频、工作流程、安装步骤）加上由 `docs/user/*.md` 渲染的文档页。生成器复用 `packages/bundle` 已锁定的 markdown-it，不引入新依赖；版本号与配套宿主版本分别取自 `packages/bundle/package.json` 和 `dsh-baseline.json`，不在站点源码中硬编码。

## 本地构建与预览

```powershell
pnpm pages:build            # 输出到 .tmp/pages，缺失链接/图片直接失败
node site/build.mjs --strict  # 缺失锚点也视为失败（默认只警告）
npx serve .tmp/pages        # 或任何静态服务器
```

链接规则：文档间的 `*.md` 链接改写为对应 `.html`；指向 `docs/user/` 之外仓库文件的链接改写为 GitHub `blob/v8` 地址；图片与媒体复制到相同相对位置。标题锚点沿用 GitHub slug 规则，已有 `#锚点` 不需要改。

文档侧栏顺序在 `site/build.mjs` 的 `NAV` 中维护；新增用户文档若不在清单内，会自动追加到最后一组，但新文档应考虑显式归组。

## 部署

`.github/workflows/v8-pages.yml` 在推送到 v8 且站点相关路径变化时构建并用官方 Pages Actions 部署；对 v8 的 PR 只构建不上传。Actions 全部固定到 commit，部署 job 只持有 `pages: write` 与 `id-token: write`。

首次启用需要维护者在仓库设置中完成（一次性）：

1. **Settings → Pages → Build and deployment**，Source 选 **GitHub Actions**（不是 "Deploy from a branch"）。
2. **Settings → Environments → github-pages → Deployment branches and tags**，默认只允许默认分支（master）；站点从 v8 发布，需要添加 **v8** 到允许部署的分支。
3. 推送 v8 触发部署后，站点地址为 `https://<owner>.github.io/webnovel-writer/`。构建全部使用相对链接，地址变化无需改配置。
4. 可选：把仓库 **About → Website** 设为站点地址。

部署只发布构建产物（首页、文档 HTML、图片、介绍视频与字幕）；私有开发内容不会进入产物——生成器只读取公开白名单内文件，且构建后对全部文本产物执行与公开树一致的凭据/个人路径扫描。

## 与发行流程的关系

站点内容是纯文档，不随 npm 包发行，也不需要为站点单独发包。版本相关文字（安装标识、下载链接、配套宿主）构建时从真源注入，`pnpm check:version` 仍负责文档示例的一致性。文档在 PR 中更新后，合入 v8 即自动重新发布。

## 站外入口与上线顺序

统一站点地址为 `https://lingfengqaq.github.io/webnovel-writer/`。对外分享使用此地址，不使用本机预览的 `127.0.0.1`。

| 来源 | 入口 | 生效时间 |
| --- | --- | --- |
| v8 仓库 README | 标题下的“产品主页 / 新手教程 / 下载正式版” | 与站点一同合入后 |
| 仓库 About | Website 设置为站点首页 | 首次部署成功后设置 |
| 默认 master 分支 | README 首屏加入 v8 站点入口，保留原 v6 内容 | 首次部署成功后单独同步 |
| npm 与插件信息 | 四个公开包的 `homepage`，以及各包 README 顶部入口 | 下一次正式包发布后 |
| GitHub 提交问题页 | “产品主页与使用文档”联系链接 | Issue 模板在默认分支生效后 |
| Release / 社区介绍 | 正文开头附产品主页和新手教程链接 | 后续发布或维护介绍时 |

先启用 Pages 并完成部署，确认首页及 `docs/beginner.html` 返回成功，再设置 About 和分发入口。仓库默认分支目前是 v6 的 master，因此只修改 v8 README 不能覆盖直接访问仓库首页的用户。

master README 可在标题后加入：

```markdown
使用 DeepSeek Harness 写作工作台（v8）？[访问产品主页](https://lingfengqaq.github.io/webnovel-writer/) · [查看新手教程](https://lingfengqaq.github.io/webnovel-writer/docs/beginner.html)。本分支保留 Claude Code 版（v6）。
```

包主页字段的本地修改不会自动更新已发布的 npm 8.2.0 页面，也不需要为网站重传已有版本。随下一次正式发行更新包元数据即可。

## 配色

三套配色的唯一来源是 `site/palettes.mjs` 的 `PALETTES`（A 黛蓝宣纸、B 墨与朱印、C 松烟竹青，各有 `light` / `dark`）。`site/build.mjs` 据此生成 `assets/theme.css`，选择器为 `:root[data-palette]`、显式 `data-theme="dark"`，以及 `prefers-color-scheme: dark` 且未锁定浅色时的深色块。`site/assets/style.css` 只引用这些变量；阴影和遮罩可以用 `rgba(0,0,0,…)`，不要再写 `#rrggbb`。浅色底之类的派生色用 `color-mix`，不新增 token。

改颜色时只改 `palettes.mjs`，然后跑 `node --test scripts/release/tests/pages.test.mjs`。测试按 WCAG 相对亮度检查正文、次要字、链接、按钮字、点缀色和五种语义色；任一组低于 4.5:1 即失败。浏览器标签页的 `favicon.svg` 固定为 A 的浅色（黛蓝底、白书页）；页头图标用当前配色的 `--accent` / `--on-accent`。

## 外观设置

页头「外观」按钮同时选择配色和明暗。生成的 HTML 默认 `data-palette="A"`，且不写 `data-theme`，因此无脚本时是 A + 跟随系统。`<head>` 里、样式表之前的内联脚本只接受白名单：

- `localStorage['scriptor-palette']`：`A` / `B` / `C`，异常值忽略。
- `localStorage['scriptor-theme']`：`light` / `dark`。跟随系统时删除该键。老访客只保存过明暗时，配色仍是 A，明暗保持原样。

## 共享 Markdown 约定

`docs/user/*.md` 在 GitHub 上保持原样；站点在 `createMarkdown` 里额外渲染。未知的 `[!…]` 类型会使构建失败，错误形如 `Unknown alert type in <file>: [!X]`。

| 写法 | 站点结果 |
| --- | --- |
| `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`，标记单独一行 | `.callout`，中文标签为说明、提示、重要、警告、注意 |
| 不带 `[!…]` 的顶层引用块 | 「发给工作台」气泡，带复制按钮 |
| 顶层有序列表 | `.steps` 步骤条；使用原生列表计数器保留 `start` 续号；嵌套列表保持普通列表 |
| 行内代码为修饰键组合、命名按键或 `/` | `<kbd>`。单独的字母或数字仍是 `<code>` |
| 段落里只有一张图片 | `.shot`，alt 作为图注；点击后在对话框中放大，Esc 或点击遮罩关闭 |

侧栏短标题在 `NAV` 的 `label` 中配置，不使用文档的一级标题。正文栏 `max-width` 为 `40em`（约 40 个汉字）。

## 站点地址

`og:url` 与 `og:image` 使用 `https://<owner 小写>.github.io/<repo>/`，从 `packages/bundle/package.json` 的 `repository.url` 推导。自定义域名时要改 `readContext` 里的这条规则，并同步检查分享卡片。页面里的文档链接、样式和脚本仍然用相对路径；`404.html` 继续使用仓库根路径（`/webnovel-writer/`），因为它会被任意地址引用。

## 首页与截图

首页保留短句和必要操作入口。平台、许可、视频下载等图标带说明和可访问名称；细节放进对应文档。客户端入口使用 DeepSeek 官网。Windows、Linux 和 macOS 的验证范围以安装页为准。

2026-10-06 更新了工作台、书房文件树和编辑器菜单、建议、批注共五张截图。它们来自 DSH 0.2.0-rc.2 Web 端与 npm Scriptor 8.2.0，原文是[《河埠旧事》](examples/河埠旧事.md)。编辑建议和批注来自 DeepSeek 官方 API，保存操作实际产生稿2；示例不是固定响应。

截图只裁去无关区域，不修改界面内容。模型曾把“靠窗”写成“墙角”，编辑器教程保留这个例子并说明人工修正，避免把调用成功当作内容正确。旧截图未更新的部分仍由相应文档标明。

“赞助与交流”提供公开讨论与邮件入口；README 的合作说明明确区分赞助商展示和广告，不自动代表产品推荐。
