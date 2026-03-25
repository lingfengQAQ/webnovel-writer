# F02 写作上下文抽取闭环计划

## 1. 闭环目标
- `extract-context` 输出内容稳定、字段语义正确，能直接供写作代理消费。
- 主角位置等关键字段在扁平/嵌套两种 state 格式下都正确呈现。

## 2. 模块范围
- `webnovel-writer/scripts/extract_chapter_context.py`
- `webnovel-writer/scripts/data_modules/webnovel.py`
- `webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py`

## 3. 接口清单
### CLI
- `webnovel extract-context --chapter <N> --format text|json [--project-root ...]`

### 输出契约
- 文本模式: 包含进度、主角状态、伏笔、上下文摘要等段落。
- JSON 模式: 字段结构稳定，可被后续 Agent 直接解析。

## 4. 问题与改造点
- 问题 P1: `protagonist_state.location` 在字典结构场景下显示错误。
- 问题 P2: 文本/JSON 输出字段一致性不足，易导致下游解析分叉。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F02-T1 | 实现 location 兼容读取（字符串与对象均支持） | `scripts/extract_chapter_context.py` | 无 | `当前位置` 输出不再出现对象原始串；缺失时回退到 `?` |
| F02-T2 | 统一 text/json 模式字段映射规则 | `scripts/extract_chapter_context.py` | 无 | 两种模式字段同源，字段名与语义一致 |
| F02-T3 | 增加回归测试（location 扁平/嵌套、异常输入） | `scripts/data_modules/tests/test_extract_chapter_context.py` | T1,T2 | 新增测试全绿，覆盖错误分支 |
| F02-T4 | CLI 帮助与错误提示补全（章节不存在、state 缺失） | `scripts/data_modules/webnovel.py`, `scripts/extract_chapter_context.py` | 无 | 错误消息可定位问题文件与章节号 |

## 6. 验收用例
- 用例 A: `location: "宗门"` 输出 `当前位置: 宗门`。
- 用例 B: `location: {"current": "玄星城", "last_chapter": 12}` 输出 `当前位置: 玄星城`。
- 用例 C: 缺失 `state.json` 时返回可读警告，不抛非结构化异常。

## 7. 风险与回滚
- 风险: 文本模板调整可能影响既有 prompt 依赖。
- 回滚策略: 保留旧模板开关 1 个版本窗口，灰度后移除。
