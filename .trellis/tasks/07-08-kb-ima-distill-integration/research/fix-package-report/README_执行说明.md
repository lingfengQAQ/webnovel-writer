# v7 知识库 修正包 —— 执行说明（写给操作 AI）

## 0. 你要做什么
把本包 `fixes/` 目录下的 **14 个文件**，按相同相对路径**覆盖**到用户本地 v7 知识库的 `references/` 目录中。
**只覆盖这 14 个文件，其余文件一律不要动。** 这是纯文件替换操作，不需要改写任何文件内容。

## 1. 目标根目录
用户本地 v7 知识库 references 根目录（请先向用户确认实际路径，已知为）：
```
D:\wk\novel skill\webnovel-writer\v7\references
```
下文用 `<ROOT>` 指代该目录。

## 2. 覆盖映射表（包内路径 → 目标路径）
将下方左侧每个文件，复制/覆盖到右侧路径。**直接覆盖同名文件即可。**

| 包内文件 | 覆盖到目标 |
|---|---|
| `fixes/题材/玄幻.md` | `<ROOT>/题材/玄幻.md` |
| `fixes/流派/扮猪吃虎流.md` | `<ROOT>/流派/扮猪吃虎流.md` |
| `fixes/流派/无敌流.md` | `<ROOT>/流派/无敌流.md` |
| `fixes/流派/稳健流.md` | `<ROOT>/流派/稳健流.md` |
| `fixes/流派/重生流.md` | `<ROOT>/流派/重生流.md` |
| `fixes/流派/追妻火葬场.md` | `<ROOT>/流派/追妻火葬场.md` |
| `fixes/流派/系统流.md` | `<ROOT>/流派/系统流.md` |
| `fixes/场景/秘境探险.md` | `<ROOT>/场景/秘境探险.md` |
| `fixes/场景/谈判对峙.md` | `<ROOT>/场景/谈判对峙.md` |
| `fixes/节拍/PA-001-压抑蓄力爆发.md` | `<ROOT>/节拍/PA-001-压抑蓄力爆发.md` |
| `fixes/节拍/PA-002-微反转补刀.md` | `<ROOT>/节拍/PA-002-微反转补刀.md` |
| `fixes/节拍/PA-056-多线轮转汇聚.md` | `<ROOT>/节拍/PA-056-多线轮转汇聚.md` |
| `fixes/节拍/PA-107-微兑现.md` | `<ROOT>/节拍/PA-107-微兑现.md` |
| `fixes/references/路由.csv` | `<ROOT>/references/路由.csv` |

## 3. 最简执行方式（命令行）
在解压后的 `v7_fix_package` 目录下运行（请先把 `<ROOT>` 替换为真实绝对路径）：
```bat
@echo off
set ROOT=D:\wk\novel skill\webnovel-writer\v7\references
xcopy fixes\* %ROOT% /E /Y /I
```
（`/E` 保留目录结构，`/Y` 静默覆盖，`/I` 视为目录）

或在 PowerShell 中：
```powershell
$ROOT = "D:\wk\novel skill\webnovel-writer\v7\references"
Copy-Item -Path "fixes\*" -Destination $ROOT -Recurse -Force
```

> 注意：`fixes/` 下只有上述 14 个文件，目录结构正是 `题材/ 流派/ 场景/ 节拍/ references/`，与 `<ROOT>` 一致，递归复制即可精准覆盖，不会引入多余文件。

## 4. 覆盖后校验（建议，非必须）
- `references/路由.csv`：应比原版多 7 行（末世、诡秘、洪荒流、扮猪吃虎流、无敌流、稳健流、重生流）。
- 任意被覆盖的 .md：front matter 的 `毒点` 条数 应与正文 `## 毒点展开` 条数一致（玄幻=5，其余不变）。
- 若用户本地有 git，建议提交一次 commit 以便回滚。

## 5. 未包含 / 需用户另行决策的事项（不要自行处理）
以下为「可选项」，本报告未生成修正文件，**请勿凭猜测修改**：
- PA-037 / PA-040 节拍编号缺口是否补齐
- PA-065 / PA-067 毒点句式统一
- 画面感单场戏.md 毒点4 微调
- PA-071（含幻言）、PA-110（适用题材偏宽）是否收紧

## 6. 包内其他目录说明
- `report/`：完整变更报告 `v7_change_report.md` + 审计结果 `v7_content_audit.json` + 审计脚本 `audit_content.py`
- `originals/`：14 个文件改动前的原版正文，仅用于 diff 核对，无需复制到 `<ROOT>`
