# 技术设计：P0 路径穿越修复（F1-F5）

## 1. 总体形状：两层防线

```
入口校验（源头，人话拒绝）            总闸兜底（机械，最后防线）
─────────────────────────           ─────────────────────────
finalize payload 校验    ──┐
staging payload（同函数）──┼──→ Writer 适配器自卫 ──→ writeAtomicBatch / fs.writeFile
persist-volume-review    ──┘        (F1/F2 内建校验)     (F4 repo 边界检查)
```

- **源头层**给 AI 人话报错（它能改 payload 重试）；**总闸层**是不信任任何调用方的机械断言（防未来新调用点再漏接）。
- 与现有 `factPath` 防线（`isFactPath` + `normalizePosixRelative`）同哲学，不发明新机制。

## 2. 新增单源工具（不重复造轮子）

### 2.1 `util/filename.js` 增加 `isSafeFileStem(value)`

```js
/** 文件名干校验：非空、无路径分隔符/非法字符/控制字符、非 . 开头、非 Windows 保留名。
 * 判定基准=「净化后与原值相同」，与 sanitizeFileName 单源，不另建黑名单。 */
export function isSafeFileStem(value) {
  const s = String(value ?? '')
  return s !== '' && !s.startsWith('.') && s === sanitizeFileName(s)
}
```

理由：`sanitizeFileName` 已覆盖 `<>:"/\|?*`、控制字符、保留设备名；`s === sanitize(s)` 等价于「不含任何会被净化的字符」，天然拒绝 `/` 与 `\`（穿越必需）；`.` 开头拒绝 `..`/隐藏文件。**校验拒绝而非静默净化**——AI 给的 id 是语义标识，改写会造成 id 与文件名漂移。

### 2.2 `util/positive-int.js`（或并入现有 util）`parsePositiveInt(value)`

```js
/** 章号/卷号统一口径：十进制正整数字符串或 number，否则返回 null。拒绝 "3.5"/"1e3"/"-1"/"0"/前后杂字符。 */
export function parsePositiveInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  const s = String(value ?? '').trim()
  return /^[1-9][0-9]*$/.test(s) ? Number(s) : null
}
```

## 3. 逐点接线

### F1 SecretWriter（`storage/adapters/SecretWriter.js`）

`write(id, ...)` 开头：`if (!isSafeFileStem(id)) return { ok:false, error: '信息差编号「…」含非法字符，不能用作文件名' }`。校验在 `mkdir` 之前（AC：零建目录）。finalize/staging 的 payload 校验层同步加同款检查（报错带 `secretWrites[i].id` 定位），让错误在写盘前暴露。

### F2 TimelineWriter（`storage/adapters/TimelineWriter.js`）

`appendRow(volumeNum, row)` 开头：`parsePositiveInt(volumeNum)` 为 null 即拒绝（'时间线卷号必须是正整数'）；通过后用解析后的数字 `padStart`。payload 校验层同步检查 `timelineRows[i].volumeNum`。

### F3 卷复盘伏笔条目（`state-machine/persist.js:301-310` 一带）

撞号检查前逐条：`typeof e.id === 'string' && e.id.startsWith('伏笔-') && isSafeFileStem(e.id)`，否则 `'伏笔条目编号「…」不合法，应为 伏笔-NNN 形式'`。与 `ThreadLedgerWriter.createThread` 的既有文案风格对齐。命令层（`commands/persist-volume-review.js`）已查数组类型，逐项校验放 persist 层（staging 侧如有同路径复用同函数）。

### F4 writeAtomicBatch（`storage/atomic.js`）

循环内 `path.join` 之后：

```js
const resolvedRoot = path.resolve(repoPath)
const resolved = path.resolve(full)
if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
  throw new Error(`批量写入路径越界：${f.path}`)
}
```

放在 `fs.mkdir` 之前（越界时零建目录）。抛错走既有 catch → 逆序回滚，语义不变。参照 `staging/contract-invalidation.js` 的 `workspaceRemovalIsContained` 前缀判定口径（Windows 大小写：`path.resolve` 后同盘符即可比较，与该函数保持一致的实现方式，必要时抽公共 helper——若两处逻辑完全同构则抽到 util 单源，否则各自保留但注释互指）。

### F5 十站点替换

`const chapterNum = parsePositiveInt(args[0])`，null 即用各命令原报错文案（补「正整数」字样）。站点清单见 prd.md Background。**不改** `persist-volume-review.js:13`（已正确）。

## 4. 边界与兼容

- **不碰数据格式**：全部是校验前置，合法输入行为零变化；无迁移。
- **staging 链**：`stageChapter` 的 payload 与手动 finalize 共用校验函数（R6），确认 `staging/index.js:295` 一带的 threadCreates/secretWrites 处理是否复用 finalize 的校验入口，若是独立代码路径则把校验函数抽到共享位置（候选：`knowledge/fact-changes.js` 旁新建 `knowledge/payload-guards.js`，或直接放 util——以「两链路 import 同一函数」为硬要求）。
- **错误范式**：Writer 层 `{ok:false, error}` 返回、命令层人话中文、不抛栈——沿用全链路现状。
- **测试形状**：镜像 src 目录树；攻击样例用 `path.join(仓外临时目录)` 断言目标不存在；atomic 越界测试断言 tmp 清理（现有回滚测试同款）。

## 5. 回滚方案

纯增量校验，单 commit 可 revert；不动 schema/存储格式，revert 后无数据残留问题。

## 6. Spec 回填点

- backend error-handling spec：新增「外部输入进文件路径必须过 isSafeFileStem/normalizePosixRelative/parsePositiveInt 三选一白名单；writeAtomicBatch 持有 repo 边界断言」条目（具体编号排版入库时定）。
- story-repo spec 决策条目：记录「payload 路径类字段校验口径」+ F3 伏笔 id 形式约束。
