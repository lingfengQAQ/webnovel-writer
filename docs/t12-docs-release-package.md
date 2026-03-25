# T12 发布文档包清单（M-G Docs Alignment）

- 任务：T12 `worker-docs`
- 日期：2026-03-25
- 目标：统一 Codex 叙事与命令说明，清理过时 Claude 主链路文档描述（保留迁移说明）

## 1) 发布文档包（本次更新）

1. `README.md`
2. `docs/README.md`
3. `docs/architecture.md`
4. `docs/commands.md`
5. `docs/codex.md`
6. `docs/operations.md`
7. `docs/rag-and-config.md`
8. `docs/t12-docs-release-package.md`

## 2) 关键对齐项

1. 命令主入口统一为：`python -X utf8 webnovel-writer/scripts/webnovel.py <tool> ...`
2. `preflight` 示例统一为 `--format json`。
3. 文档主叙事改为 Codex 单链路（`.codex` 指针 + `~/.codex/...` registry）。
4. 保留迁移说明：历史 `.claude` 仅作为 `migrate codex` 的一次性迁移输入。
5. 修正失效链接：移除 `docs/codex-exclusive-implementation-plan.md` 引用，统一指向 OpenSpec 文档集。

## 3) 可执行性抽查证据

命令：

```powershell
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "D:/code/webnovel-writer/webnovel-project" preflight --format json
```

结果（节选）：

```json
{
  "ok": true,
  "project_root": "D:\\code\\webnovel-writer\\webnovel-project",
  "checks": [
    {"name": "scripts_dir", "ok": true},
    {"name": "entry_script", "ok": true},
    {"name": "extract_context_script", "ok": true},
    {"name": "skill_root", "ok": true},
    {"name": "project_root", "ok": true}
  ]
}
```

结论：`preflight --format json` 可执行，且关键检查项均为 `ok=true`。
