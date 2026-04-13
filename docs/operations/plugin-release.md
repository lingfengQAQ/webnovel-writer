# 插件发版指南

## 版本同步

发版前，先在本地同步 `plugin.json`、`marketplace.json` 和 `README.md` 中的版本号：

```bash
python -X utf8 webnovel-writer/scripts/sync_plugin_version.py --version X.Y.Z --release-notes "本次版本说明"
```

该命令会自动更新以下文件中的版本信息：

- `webnovel-writer/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `README.md` 中的版本标记

## 通过 GitHub Actions 发版

推荐使用 `Plugin Release` 工作流统一发版：

1. 在本地执行版本同步（见上方命令）
2. 提交并推送版本变更
3. 打开仓库 Actions 页面，选择 `Plugin Release`
4. 输入 `version`（如 `6.0.0`）和 `release_notes`
5. 工作流自动执行：
   - 校验 `plugin.json`、`marketplace.json` 与 README 版本一致
   - 校验输入版本与仓库元数据一致
   - 创建并推送 `vX.Y.Z` Tag
   - 创建 GitHub Release

## 自动版本校验

`Plugin Version Check` 工作流会在每次 Push / PR 时自动检查版本一致性。

触发文件变更：

- `.claude-plugin/marketplace.json`
- `webnovel-writer/.claude-plugin/plugin.json`
- `webnovel-writer/scripts/sync_plugin_version.py`
- `README.md`
