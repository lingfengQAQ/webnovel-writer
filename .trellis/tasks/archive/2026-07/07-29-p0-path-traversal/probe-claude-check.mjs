// claude 独立检查探针（区别于 kimi 的 probe-p0-attack.mjs 样例集）：
// 反斜杠/盘符/绝对路径/保留名/控制字符变体、总闸前缀兄弟目录陷阱、混合批次整批回滚、payload 形状。
import { SecretWriter } from '../../../v7/src/storage/adapters/SecretWriter.js'
import { TimelineWriter } from '../../../v7/src/storage/adapters/TimelineWriter.js'
import { writeAtomicBatch } from '../../../v7/src/storage/atomic.js'
import { validateFinalizePayloadPaths } from '../../../v7/src/knowledge/payload-guards.js'
import { isSafeFileStem } from '../../../v7/src/util/filename.js'
import { parsePositiveInt } from '../../../v7/src/util/positive-int.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-check-'))
const repo = path.join(tmp, '仓')
await fs.mkdir(repo, { recursive: true })
let fails = 0
const t = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails++ }

// 1. SecretWriter 变体
const sw = new SecretWriter(repo)
const badIds = ['..\\..\\x', 'C:\\evil', '/etc/x', '..', 'CON', '信息差\n021', 'a/b', '']
for (const id of badIds) {
  const r = await sw.write(id, {}, 'x')
  t('SecretWriter 拒绝 ' + JSON.stringify(id), r.ok === false)
}
t('SecretWriter 拒绝后零建目录', !(await fs.readdir(repo)).includes('定稿'))
const okw = await sw.write('信息差-001-测试', { 强度: '高' }, '## 描述')
t('SecretWriter 合法 id 通过', okw.ok === true)

// 2. TimelineWriter 变体
const tw = new TimelineWriter(repo)
for (const v of ['..\\..\\x', 3.5, -1, 0, '03', '1e3', Infinity, NaN]) {
  const r = await tw.appendRow(v, { 章: 1 })
  t('TimelineWriter 拒绝 ' + JSON.stringify(String(v)), r.ok === false)
}
t('TimelineWriter 合法卷号通过', (await tw.appendRow(2, { 章: 1, 一句话事件: 'x' })).ok === true)

// 3. 总闸：前缀兄弟目录陷阱 + 混合批次整批回滚
const sibling = repo + '-evil'
let threw = false
try { await writeAtomicBatch(repo, [{ path: '../' + path.basename(sibling) + '/x.md', content: 'evil' }]) } catch { threw = true }
t('总闸拒绝写前缀兄弟目录', threw)
t('兄弟目录未被创建', !(await fs.readdir(tmp)).includes(path.basename(sibling)))
threw = false
try { await writeAtomicBatch(repo, [{ path: 'ok.md', content: 'a' }, { path: '../逃逸.md', content: 'b' }]) } catch { threw = true }
t('总闸混合批次整批拒绝', threw)
t('混合批次 ok.md 未落盘(整批回滚)', !(await fs.readdir(repo)).includes('ok.md'))
t('混合批次零 tmp 残留', !(await fs.readdir(repo)).some((f) => f.includes('wnwtmp')))
t('仓外逃逸.md 不存在', !(await fs.readdir(tmp)).includes('逃逸.md'))

// 4. payload 校验层形状
t('payload secretWrites 非数组拒', validateFinalizePayloadPaths({ secretWrites: 'x' }).ok === false)
t('payload 缺 id 拒', validateFinalizePayloadPaths({ secretWrites: [{}] }).ok === false)
t('payload 合法通过', validateFinalizePayloadPaths({ secretWrites: [{ id: '信息差-001-测试' }], timelineRows: [{ volumeNum: 1 }] }).ok === true)

// 5. 单元口径抽查
t('isSafeFileStem 拒双空格(净化折叠)', isSafeFileStem('a  b') === false)
t('parsePositiveInt 拒 "+3"', parsePositiveInt('+3') === null)
t('parsePositiveInt 拒 true', parsePositiveInt(true) === null)

await fs.rm(tmp, { recursive: true, force: true })
console.log(fails === 0 ? '=== claude 独立探针全过 ===' : '=== 挂 ' + fails + ' 项 ===')
process.exit(fails === 0 ? 0 : 1)
