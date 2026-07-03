<!-- WEBNOVEL:START -->
# webnovel-writer 工作目录

webnovel-writer 长篇写作工作目录。每本书是 `<书名>/` 子目录，各自一个 git 仓库。

## 入口
对 agent 说「继续 / 写下一章 / 建书 / 换书 / 回到第N章 / 吃书」。
脚本入口：`node .webnovel/bin/webnovel-writer.js <命令>`——`next --json` 判定下一步；`list-books` / `switch-book <书名>` 管多本书；`prepare-chapter` / `mechanical-check` / `review-input` / `save-review` / `finalize` 走写章八阶段；全部命令看 `--help`。

## 布局
- `.webnovel/`：脚本运行时、角色任务书、`books.jsonl` 书目登记、模板哈希清单
- `<书名>/`：书仓库（定稿 / 大纲 / 文风 / 工作区，含可重建的 `.cache`）

事实变更只经定稿流程入 git。传给命令的 JSON 一律先写成文件再走 `--file`/`--payload`。
<!-- WEBNOVEL:END -->
