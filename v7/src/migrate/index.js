import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readV6Project } from './read-v6.js'
import { transformV6 } from './transform.js'
import { createGit } from '../finalize/git.js'
import { CacheManager } from '../cache/index.js'
import { bookAgentsMd } from '../state-machine/persist.js'
import { registerBook, setCurrentBook } from '../session/index.js'
import { sanitizeFileName } from '../util/filename.js'

const TMP_PREFIX = '.migrate-tmp-'

/**
 * v6 → v7 一次性迁移（design §3.3）：源只读；临时目录建仓（写文件 → git 初始
 * commit → 缓存重建验证格式自洽）→ 同盘 rename 落位 → books.jsonl 登记。
 * 任一步失败删临时目录整树，工作目录零残留——"整体回退"即"没发生"。
 * @param {{workdir: string}} ctx
 * @param {string} v6PathArg v6 项目根（相对路径相对 cwd）
 * @param {{dir?: string, _faultBeforeRename?: boolean}} opts _faultBeforeRename 仅测试注入用
 */
export async function migrateV6(ctx, v6PathArg, opts = {}) {
  const v6Path = path.resolve(v6PathArg)
  const read = await readV6Project(v6Path)
  if (!read.ok) return { ok: false, error: read.error }
  if (!read.facts.chapters.length && !read.facts.outlines.master) {
    return { ok: false, error: `「${v6Path}」里没有正文也没有总纲，没有可迁移的内容。` }
  }

  const plan = transformV6(read.facts)
  const dirName = sanitizeFileName(opts.dir || plan.bookName)
  const target = path.join(ctx.workdir, dirName)
  if (await exists(target)) {
    return { ok: false, error: `工作目录里已有「${dirName}」，不覆盖既有目录。想另起名字用 --dir=<目录名>。` }
  }

  await sweepStaleTmp(ctx.workdir) // 上次进程中断的残留，幂等清扫

  const tmp = path.join(ctx.workdir, `${TMP_PREFIX}${process.pid}`)
  try {
    // 1. 写全部映射产物 + 工程三件（AGENTS 指路 / .gitignore）
    const written = []
    for (const f of plan.files) {
      const full = path.join(tmp, f.path)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, f.content, 'utf8')
      written.push(f.path)
    }
    for (const [rel, content] of [
      ['AGENTS.md', bookAgentsMd(plan.bookName)],
      ['.gitignore', '.cache/\n工作区/\n'],
    ]) {
      await fs.writeFile(path.join(tmp, rel), content, 'utf8')
      written.push(rel)
    }

    // 2. git 初始 commit（v6 提交链压成一个 init，spec §12）
    const git = createGit(tmp)
    await git.init()
    await git.setQuotepathFalse()
    await git.ensureIdentity()
    await git.add(written)
    await git.commit(`init: 迁移自 v6《${plan.bookName}》`)

    // 3. 缓存重建 = 格式自洽验证（重建器即参考实现，database 规范 §2.3）
    const cache = new CacheManager(path.join(tmp, '.cache', 'index.db'))
    try {
      await cache.ensureReady(tmp)
      const rebuilt = await cache.rebuildFromSource(tmp)
      if (rebuilt && rebuilt.ok === false) {
        throw new Error(`迁移产物没通过格式校验：${rebuilt.error}`)
      }
    } finally {
      await cache.close()
    }

    // 4. 迁移报告（工作区不入 git，作者看完可删）
    await fs.mkdir(path.join(tmp, '工作区'), { recursive: true })
    await fs.writeFile(path.join(tmp, '工作区', '迁移报告.md'), renderReport(plan, v6Path, dirName), 'utf8')

    if (opts._faultBeforeRename) throw new Error('注入故障（测试）')

    // 5. 同盘 rename 落位
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: `迁移没有完成，工作目录已恢复原样（v6 项目未被改动）。原因：${err.message}` }
  }

  // 6. 登记书单并设为当前书（失败不回滚——书已落位，书单可扫描自愈）
  let registryNote = ''
  try {
    await registerBook(ctx.workdir, { 书名: plan.bookName, 目录: dirName })
    await setCurrentBook(ctx.workdir, plan.bookName)
  } catch (err) {
    registryNote = `\n书单登记没写上（${err.message}）：跑一次 list-books 会自动扫描重建，不影响已迁移内容。`
  }

  const c = plan.report.counts
  return {
    ok: true,
    target,
    output:
      `《${plan.bookName}》迁移完成：正文 ${c.章数} 章、伏笔 ${c.伏笔} 条、角色卡 ${c.角色卡} 张、` +
      `章摘要 ${c.摘要} 篇、卷纲 ${c.卷纲} 卷，已设为当前书。\n` +
      `迁移报告在 ${dirName}/工作区/迁移报告.md——先看「待校对」一节（${plan.report.待校对.length} 项），` +
      `v6 项目原样未动，确认无误前别删。${registryNote}`,
    error: '',
  }
}

function renderReport(plan, v6Path, dirName) {
  const { counts, 待校对, 丢弃, form } = plan.report
  const 形态 = { inline: 'state.json 全量内联（老版）', sqlite: 'state.json 精简 + index.db（5.4+）', mixed: '内联与数据库混合' }[form] || form
  const lines = [
    `# 迁移报告：《${plan.bookName}》`,
    '',
    `迁移自：${v6Path}（数据形态：${形态}；源目录只读未动）`,
    `落位：工作目录/${dirName}`,
    '',
    '## 迁了什么',
    '',
    ...Object.entries(counts).map(([k, v]) => `- ${k}：${v}`),
    '',
    '## 待校对（建议按序过一遍）',
    '',
    ...(待校对.length ? 待校对.map((t, i) => `${i + 1}. ${t}`) : ['（没有需要校对的项）']),
    '',
    '## 如实丢弃（未迁移）',
    '',
    ...(丢弃.length ? 丢弃.map((t) => `- ${t}`) : ['（无）']),
    '',
    '> 校对完成后本报告可删；「迁移待校对-」开头的文件处理完也一并删掉。',
    '> v6→v7 有哪些变化、迁移映射了什么，见 npm 包内 docs/migration-guide.md。',
    '',
  ]
  return lines.join('\n')
}

// 残留临时目录的陈旧线（F-5）：只清超过 24h 的 .migrate-tmp-*——
// 同工作目录并行 migrate 时，别的进程正在写的活跃临时目录不得误删
const TMP_STALE_MS = 24 * 60 * 60 * 1000

async function sweepStaleTmp(workdir) {
  try {
    for (const ent of await fs.readdir(workdir)) {
      if (!ent.startsWith(TMP_PREFIX)) continue
      const full = path.join(workdir, ent)
      try {
        const st = await fs.stat(full)
        if (Date.now() - st.mtimeMs < TMP_STALE_MS) continue
        await fs.rm(full, { recursive: true, force: true })
      } catch {
        // 单个残留读不了/删不掉不拦整体
      }
    }
  } catch {
    // 工作目录读不了让后续步骤报错，这里不拦
  }
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
