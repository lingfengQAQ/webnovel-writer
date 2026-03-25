# F07 设定词典（文件树/抽离/冲突处理）闭环计划

## 1. 闭环目标
- 词典抽离结果可用于生产写作，不再出现大量脏词条。
- 冲突处理形成真实闭环：前端拿到 `conflict_id`，后端真实落盘。
- API 失败时显式错误，不再静默本地“假更新”。

## 2. 模块范围
- `webnovel-writer/dashboard/routers/settings.py`
- `webnovel-writer/dashboard/models/settings.py`
- `webnovel-writer/dashboard/services/dictionary/service.py`
- `webnovel-writer/dashboard/frontend/src/api/settings.js`
- `webnovel-writer/dashboard/frontend/src/pages/SettingsPage.jsx`
- `webnovel-writer/dashboard/tests/test_settings_dictionary_api.py`
- `webnovel-writer/dashboard/frontend/src/api/settings.test.js`

## 3. 接口清单
- `GET /api/settings/files/tree`
- `GET /api/settings/files/read`
- `POST /api/settings/dictionary/extract`
- `GET /api/settings/dictionary`
- `POST /api/settings/dictionary/conflicts/{id}/resolve`
- 新增建议: `GET /api/settings/dictionary/conflicts`

## 4. 问题与改造点
- 问题 P1: 列表项缺少 `conflict_id`，前端无法绑定真实冲突。
- 问题 P2: 解析未剥离 markdown 列表标记，产生大量脏词条。
- 问题 P3: 前端在无 `conflict_id` 时本地改状态，形成假成功。
- 问题 P4: API 失败自动 fallback mock，掩盖真实错误。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F07-T1 | 在词典条目模型与返回体中补齐 `conflict_id` 字段 | `dashboard/models/settings.py`, `dashboard/services/dictionary/service.py`, `dashboard/routers/settings.py` | 无 | `GET /dictionary` 冲突条目可稳定返回 `conflict_id` |
| F07-T2 | 增加冲突列表接口（便于前端直接拉冲突） | `dashboard/models/settings.py`, `dashboard/routers/settings.py`, `dashboard/services/dictionary/service.py` | 无 | `GET /dictionary/conflicts` 可按状态分页 |
| F07-T3 | 词条解析质量修复（去列表符号 + 最小质量阈值） | `dashboard/services/dictionary/service.py` | 无 | 新项目抽离脏词比例显著下降（目标 <20%） |
| F07-T4 | 移除前端 `no_conflict_id(local_apply)` 本地假更新 | `frontend/src/pages/SettingsPage.jsx`, `frontend/src/api/settings.js` | T1 或 T2 | 无 `conflict_id` 时强制错误态，不做本地提交 |
| F07-T5 | 关闭生产静默 mock fallback，补测试 | `frontend/src/api/settings.js`, `frontend/src/api/settings.test.js`, `dashboard/tests/test_settings_dictionary_api.py` | 无 | 生产模式请求失败时显示错误态；测试覆盖失败分支 |

## 6. 验收用例
- 用例 A: 冲突条目点击“处理冲突”后真实调用后端，刷新后状态一致。
- 用例 B: 输入标准 markdown 模板，不再生成大量 `- ` 前缀脏词条。
- 用例 C: 后端 500 时前端显示错误，不回落 mock 数据。

## 7. 风险与回滚
- 风险: 提高质量阈值可能过滤掉边缘但有效词条。
- 回滚策略: 阈值配置化并记录被过滤样本，逐步调参。
