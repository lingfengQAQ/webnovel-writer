# References

本目录存放 `webnovel-writer` 的所有参考资料，供 skills 和 scripts 在运行时读取。

## 目录结构

| 子目录/文件 | 职责 | 消费方式 |
|-------------|------|----------|
| `csv/` | 结构化知识条目（9 张表） | `reference_search.py` BM25 检索 |
| `csv/README.md` | CSV schema 规范与录入规则 | 人工参考 |
| `csv/genre-canonical.md` | 题材权威枚举（canonical + platform_tag 映射） | 人工参考 + 代码常量对照 |
| `genre-profiles.md` | 题材 profile（fallback，高频题材已迁入 Story Contracts） | `ContextManager` 直接读取 |
| `reading-power-taxonomy.md` | 追读力分类学 | skills 直接读取 |
| `review-schema.md` | 审查输出格式定义 | `webnovel-review` 读取 |
| `index/` | 元数据索引（loading-map、gap-register） | 人工参考 |
| `outlining/` | 大纲相关参考 | `webnovel-plan` 读取 |
| `review/` | 审查相关参考 | `webnovel-review` 读取 |
| `shared/` | 跨 skill 共享参考 | 多 skill 读取 |

## md vs CSV 边界

- `md`: 流程规范、方法论、审查 schema、硬约束、润色指导
- `CSV`: 可条目化的写作知识、命名规则、场景技法、桥段模板

md 是写给大模型当行为闸门的，CSV 是写给搜索引擎当知识库的。

## 消费链路

`init -> plan -> write -> review` 的完整 reference 消费路径见 `index/reference-loading-map.md`。

## 校验

```bash
cd webnovel-writer/scripts
python validate_csv.py
python validate_csv.py --format json
```
