# Bug Analysis: CLI 特殊路径动态导入失败

## 1. Root Cause Category

- **Category**：E（隐式假设）+ D（测试覆盖缺口）。
- **Specific Cause**：入口把 Windows/本地文件路径通过字符串替换拼成 `file:///` URL，隐含假设路径不含 URL 保留字符；`#` 会成为 fragment，`%` 会参与转义。原子进程测试只从普通临时路径运行，没有穿过真实“路径 → URL → 动态 import”边界。

## 2. Why Fixes Failed

此前没有修复尝试；问题一直未触发，是因为中文路径测试覆盖了文件 IO，却没有让**包自身路径**同时包含 `#`、`%` 和空格。只测工作目录中文不等于测命令模块 URL。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | 统一用 Node `pathToFileURL(commandPath).href`，删除手拼 URL | DONE |
| P0 | Test Coverage | 真实复制包到含四类特殊字符的路径，子进程执行已知与未知命令 | DONE |
| P1 | Code Spec | 后端质量规范 §7 固化签名、错误矩阵、pack 边界和测试断言 | DONE |
| P1 | Thinking Guide | 跨层 guide 增加文件路径与 URL 边界检查清单 | DONE |

## 4. Systematic Expansion

- **Similar Issues**：全仓运行时代码扫描未发现第二个手拼 `file:///` 的入口；现有 `fileURLToPath(import.meta.url)` 用法属于标准反向转换。
- **Design Improvement**：这里无需再造 URL helper，Node 标准 API 已是单一正确抽象。
- **Process Improvement**：跨平台测试必须区分“用户工作目录特殊字符”和“已安装包路径特殊字符”；发布内容必须检查 tarball，不检查工作树猜测结果。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/quality-guidelines.md`
- [x] 更新 `.trellis/spec/backend/directory-structure.md` 与索引版本
- [x] 更新 `.trellis/spec/guides/cross-layer-thinking-guide.md`
- [x] 添加 CLI 特殊路径回归与包元数据测试
- [x] 确认仓库没有 `src/templates/markdown/spec/` 镜像，因此无需同步模板
- [ ] 提交与归档等待四项 owner 策略决策完成后统一执行
