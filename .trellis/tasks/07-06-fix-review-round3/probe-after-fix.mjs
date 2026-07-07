// 第三轮 review 修复后探针：与 07-05 probe-m1-m7.mjs / probe-followup.mjs 同场景，
// 断言修复后语义（守卫拒绝/修复接受/角色可见/别名命中/ok 不改写/重号硬错）。
// 库级直调真实路径（persistCreateBook 建书）。跑完自删临时目录，全 PASS 即收口留档。
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V7 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'v7')
const m = (p) => import(`file:///${path.join(V7, p).replace(/\\/g, '/')}`)

const { persistCreateBook, persistRepair } = await m('src/state-machine/persist.js')
const { finalizeChapter } = await m('src/finalize/index.js')
const { stageChapter, readBatch } = await m('src/staging/index.js')
const { gotoChapter } = await m('src/state-machine/flows/goto-chapter.js')
const { determineNextState } = await m('src/state-machine/index.js')
const { CacheManager } = await m('src/cache/index.js')
const { EntityReader } = await m('src/storage/adapters/EntityReader.js')
const { migrateV6 } = await m('src/migrate/index.js')
const { run: listCharacters } = await m('src/commands/list-characters.js')
const { run: finalizeCmd } = await m('src/commands/finalize.js')
const { createGit } = await m('src/finalize/git.js')

const results = []
const P = (id, pass, detail) => {
  results.push({ id, pass })
  console.log(`${pass ? '【PASS】' : '【FAIL】'} ${id}: ${detail}`)
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-fix-probe-'))
let n = 0

async function makeBook(extraYaml = '') {
  const repo = path.join(tmpRoot, `book-${++n}`)
  await fs.mkdir(repo, { recursive: true })
  const r = await persistCreateBook({ repoPath: repo, cache: null }, {
    book: { spec_version: '7.0', 书名: `修复探针${n}`, 类型: '玄幻', 每章目标字数: 3000, 卷规模: 40 },
    总纲: '# 总纲\n\n## 结局\n主角胜。\n',
    卷纲: '# 第1卷\n\n第一卷纲要。\n',
  })
  if (!r.ok) throw new Error(`建书失败: ${r.error}`)
  if (extraYaml) {
    const p = path.join(repo, 'book.yaml')
    await fs.writeFile(p, (await fs.readFile(p, 'utf8')) + extraYaml, 'utf8')
  }
  const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
  await cache.ensureReady(repo)
  return { repoPath: repo, cache }
}

const payloadOf = (num, extra = {}) => ({
  chapterNum: num,
  frontMatter: {
    章号: num, 标题: `第${num}章题`, 卷: 1, 书内时间: `夏月初${num}`, 字数: 100,
    章定位: '推进', 钩子: '危机钩-强', 情绪定位: '铺垫',
  },
  body: `第${num}章正文内容，情节推进一格。`,
  summary: `第${num}章摘要。`,
  commitLines: {},
  workspaceFiles: [],
  ...extra,
})

async function stage(ctx, num, extra = {}) {
  await fs.mkdir(path.join(ctx.repoPath, '工作区'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '工作区', '审稿.md'), `# 第 ${num} 章审稿单\n\n> 共 0 个问题：0 阻断。\n`, 'utf8')
  const r = await stageChapter(ctx, { chapterNum: num, payload: payloadOf(num, extra) })
  if (!r.ok) throw new Error(`stage ${num} 失败: ${r.error}`)
}

// P-1 (R1)：批次在场 goto → 人话拒绝，批次原样；无批次时 goto 照常可用
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) {
    const r = await finalizeChapter(ctx, payloadOf(c))
    if (!r.ok) throw new Error(`定稿${c}: ${r.error}`)
  }
  await stage(ctx, 4)
  const g = await gotoChapter(ctx, { chapterNum: 2, confirm: true })
  const batch = await readBatch(ctx.repoPath)
  const humane = /finalize-batch|batch-discard/.test(g.error || '')
  P('P-1 goto×批次守卫(R1)', !g.ok && humane && batch.exists,
    `goto被拒=${!g.ok} 指引人话=${humane} 批次完好=${batch.exists} err=${(g.error || '').slice(0, 80)}`)
  await ctx.cache.close()
} catch (e) { P('P-1 goto×批次守卫(R1)', false, `探针异常: ${e.message}`) }

// P-2 (R2)：批次在场手动 finalize（命令层）→ 双文案人话拒绝；finalizeChapter 本体不带守卫（finalizeBatch 内部要用）
try {
  const ctx = await makeBook()
  await finalizeChapter(ctx, payloadOf(1))
  await stage(ctx, 2)
  const inBatch = await finalizeCmd(['2'], { payload: '不会被读到.json' }, ctx)
  const outBatch = await finalizeCmd(['9'], { payload: '不会被读到.json' }, ctx)
  const okIn = !inBatch.ok && /finalize-batch/.test(inBatch.error || '')
  const okOut = !outBatch.ok && /章号错位|finalize-batch/.test(outBatch.error || '')
  P('P-2 手动finalize守卫(R2)', okIn && okOut,
    `批内被拒=${okIn} 批外被拒=${okOut} errIn=${(inBatch.error || '').slice(0, 60)}`)
  await ctx.cache.close()
} catch (e) { P('P-2 手动finalize守卫(R2)', false, `探针异常: ${e.message}`) }

// P-3 (R3)：book.yaml 坏 → 序0；合法修复被接受；修复后序离开 0
try {
  const ctx = await makeBook('卷规模: 40\n') // 追加重复键 → YAML 解析失败
  const next = await determineNextState(ctx)
  const failures = next.dto?.failures?.map((f) => f.file) || []
  const good = 'spec_version: "7.0"\n书名: 探针修复\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n'
  const rep = await persistRepair(ctx, { repairs: [{ file: 'book.yaml', content: good }] }, { allowedFiles: failures })
  const after = await determineNextState(ctx)
  P('P-3 修复分派校验(R3)', next.序 === 0 && failures.includes('book.yaml') && rep.ok && after.序 !== 0,
    `序0=${next.序 === 0} 修复接受=${rep.ok} 修复后序=${after.序} err=${(rep.error || '').slice(0, 60)}`)
  await ctx.cache.close()
} catch (e) { P('P-3 修复分派校验(R3)', false, `探针异常: ${e.message}`) }

// P-4 (B1)：坏 front matter 章 → rebuild warning 不再静默；主链由序0 拦（上轮 REFUTED 主链保持）
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) await finalizeChapter(ctx, payloadOf(c))
  const chDir = path.join(ctx.repoPath, '定稿', '正文')
  const f3 = (await fs.readdir(chDir)).find((f) => f.startsWith('0003-'))
  await fs.writeFile(path.join(chDir, f3), '---\n章号: [broken\n---\n正文', 'utf8')
  const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
  const next = await determineNextState(ctx)
  P('P-4 解析失败有warning(B1)', (rb.warnings || []).length > 0 && next.序 === 0,
    `rebuild.ok=${rb.ok} warnings=${(rb.warnings || []).length} 条 next序=${next.序}（序0 修复确认拦住重抄）`)
  await ctx.cache.close()
} catch (e) { P('P-4 解析失败有warning(B1)', false, `探针异常: ${e.message}`) }

// P-4b (B2)：同章号两个合法文件 → UNIQUE 硬错冒泡人话报错，不再静默丢章
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) await finalizeChapter(ctx, payloadOf(c))
  const chDir = path.join(ctx.repoPath, '定稿', '正文')
  const f3 = (await fs.readdir(chDir)).find((f) => f.startsWith('0003-'))
  await fs.copyFile(path.join(chDir, f3), path.join(chDir, '0003-旧稿备份.md'))
  const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
  const errText = (rb.errors || []).join('；') // rebuild 返回 errors 数组（非 error 单数）
  P('P-4b 重号硬错冒泡(B2)', rb.ok === false && /重复档案|同章号/.test(errText),
    `rebuild.ok=${rb.ok} err=${errText.slice(0, 80)}`)
  await ctx.cache.close()
} catch (e) { P('P-4b 重号硬错冒泡(B2)', false, `探针异常: ${e.message}`) }

// P-5 (R5)：sqlite v6 迁移书 → list-characters 可见、entities.type 为英文 machine 值
try {
  const workdir = path.join(tmpRoot, 'workdir-g2')
  await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
  const { tempV6Sqlite } = await m('test/migrate/_v6.js')
  const v6 = await tempV6Sqlite()
  const mig = await migrateV6({ workdir }, v6.v6Path)
  const repo = path.join(workdir, '潮汐之下')
  const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
  await cache.ensureReady(repo)
  const lc = await listCharacters([], {}, { repoPath: repo, cache })
  const rows = await cache.query('SELECT type FROM entities', [])
  const machineTypes = rows.every((r) => /^[a-z]+$/.test(r.type))
  P('P-5 迁移书角色可见(R5)', mig.ok && lc.ok && (lc.output || '').includes('江遥') && machineTypes,
    `migrate.ok=${mig.ok} 含江遥=${(lc.output || '').includes('江遥')} type全machine值=${machineTypes} [${rows.map((r) => r.type).join(',')}]`)
  await cache.close()
  await v6.cleanup()
} catch (e) { P('P-5 迁移书角色可见(R5)', false, `探针异常: ${e.message}`) }

// P-6 (R6)：名册全角/顿号混合分隔别名 → resolveAlias 全命中（英文类型恒等收纳兼验）
try {
  const ctx = await makeBook()
  await fs.mkdir(path.join(ctx.repoPath, '定稿', '设定'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '定稿', '设定', '名册.md'),
    '| 正名 | 别名 | 类型 | 首现章 |\n|---|---|---|---|\n| 林晚 | 阿晚，晚儿、小晚 | character | 1 |\n', 'utf8')
  await ctx.cache.rebuildFromSource(ctx.repoPath)
  const er = new EntityReader(ctx.repoPath, ctx.cache)
  const hits = []
  for (const a of ['阿晚', '晚儿', '小晚']) hits.push((await er.resolveAlias(a)).ok)
  P('P-6 别名中文分隔全命中(R6)', hits.every(Boolean), `resolveAlias(阿晚/晚儿/小晚)=[${hits}]`)
  await ctx.cache.close()
} catch (e) { P('P-6 别名中文分隔全命中(R6)', false, `探针异常: ${e.message}`) }

// P-7/P-7b (R4)：workspaceFiles 含目录（带/不带 工作区/ 前缀）→ ok:true + commit 在 + 目录清掉
try {
  for (const [id, rel] of [['P-7 目录带前缀', '工作区/评审报告'], ['P-7b 目录裸名', '评审报告']]) {
    const ctx = await makeBook()
    await fs.mkdir(path.join(ctx.repoPath, '工作区', '评审报告'), { recursive: true })
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '评审报告', 'a.md'), 'x', 'utf8')
    const r = await finalizeChapter(ctx, payloadOf(1, { workspaceFiles: [rel] }))
    const committed = await createGit(ctx.repoPath).findChapterCommit(1)
    const dirLeft = await fs.access(path.join(ctx.repoPath, '工作区', '评审报告')).then(() => true, () => false)
    P(`${id}(R4)`, r.ok && !!committed && !dirLeft,
      `finalize.ok=${r.ok} commit=${committed ? '在' : '无'} 目录残留=${dirLeft} warnings=${(r.warnings || []).length}`)
    await ctx.cache.close()
  }
} catch (e) { P('P-7 finalize清理(R4)', false, `探针异常: ${e.message}`) }

console.log('\n===== 修复后探针汇总 =====')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.id}`)
const failed = results.filter((r) => !r.pass).length
console.log(failed ? `\n${failed} 项未过` : '\n全部通过')
await fs.rm(tmpRoot, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
