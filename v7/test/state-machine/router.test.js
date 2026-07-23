import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CacheManager } from '../../src/cache/index.js'
import { determineNextState } from '../../src/state-machine/index.js'
import { runHealthCheck } from '../../src/health-check/index.js'
import { minimalWorkContract } from './_helper.js'
import { designFixture } from '../knowledge/_design-fixture.js'

const execFileAsync = promisify(execFile)

// 造 git 书仓库 + 缓存。files = {相对路径: 内容}；committed=true 时初始全部提交
async function makeGitBook(files, { commit = true, includeContract = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-'))
  const git = (a) => execFileAsync('git', a, { cwd: root })
  await git(['init', '-q'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'test'])
  await fs.writeFile(path.join(root, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  const initialFiles = { ...files }
  if (includeContract && initialFiles['book.yaml'] && !initialFiles['作品契约/作品契约.md']) {
    initialFiles['作品契约/作品契约.md'] = minimalWorkContract()
    initialFiles['作品契约/知识选择记录.md'] = '# 知识选择记录\n'
  }
  for (const [rel, content] of Object.entries(initialFiles)) {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }
  if (commit) {
    await git(['add', '-A'])
    await git(['commit', '-q', '-m', 'init'])
  }
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  await cache.ensureReady(root)
  return {
    root,
    git,
    ctx: { repoPath: root, cache },
    cleanup: async () => {
      await cache.close()
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(dbDir, { recursive: true, force: true })
    },
  }
}

const ch = (n, vol = 1, pos = '推进', 收卷 = false) =>
  `---\n章号: ${n}\n标题: 第${n}章\n卷: ${vol}\n字数: 100\n章定位: ${pos}\n钩子: 危机钩-强\n情绪定位: 铺垫${收卷 ? '\n收卷: 是' : ''}\n---\n正文。`

const healthyBook = (extra = {}) => ({
  'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n',
  '大纲/总纲.md': '# 总纲\n## 结局\nx',
  '定稿/正文/0001-第1章.md': ch(1),
  ...extra,
})

test('序1：无 book.yaml → 建书引导', async () => {
  const { ctx, cleanup } = await makeGitBook({ '大纲/占位.md': 'x' })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 1)
    assert.equal(r.state, 'create-book')
  } finally {
    await cleanup()
  }
})

test('序6：健康书、无异常 → 起草新章细纲', async () => {
  const { ctx, cleanup } = await makeGitBook(healthyBook())
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6, `实际：${JSON.stringify(r)}`)
    assert.equal(r.state, 'draft-outline')
  } finally {
    await cleanup()
  }
})

test('序6：作品契约损坏时真实 next 阻断，状态机不进入 AI', async () => {
  const { ctx, cleanup } = await makeGitBook(healthyBook({
    '作品契约/作品契约.md': '---\n类型: 玄幻\n---\n坏契约',
  }))
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.ok, false)
    assert.equal(r.序, 6)
    assert.equal(r.state, 'draft-outline-blocked')
    assert.equal(r.needsAI, false)
    assert.match(r.message, /起草细纲停止.*作品契约结构不完整/)
  } finally {
    await cleanup()
  }
})

test('序0：源文件解析失败 → 修复确认', async () => {
  const { ctx, cleanup } = await makeGitBook(
    healthyBook({ '定稿/正文/0002-坏章.md': '---\n章号: 2\n标题: [未闭合\n卷: : :\n---\n正文' })
  )
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 0)
    assert.equal(r.state, 'repair-confirm')
  } finally {
    await cleanup()
  }
})

test('序0：计划对象损坏 → 启动先进入修复确认', async () => {
  const { ctx, cleanup } = await makeGitBook(healthyBook({
    '大纲/创作设计/人物/CHAR-001-林晚.md': designFixture().replace('## 一致性边界', '## 边界缺失'),
  }))
  try {
    const result = await determineNextState(ctx)
    assert.equal(result.序, 0, JSON.stringify(result))
    assert.ok(result.dto.failures.some((failure) => failure.file.includes('创作设计/人物')))
  } finally {
    await cleanup()
  }
})

test('序2：定稿有未登记手改 → 提议补登', async () => {
  const { ctx, root, cleanup } = await makeGitBook(healthyBook())
  try {
    // 提交后手改一个已跟踪文件（不提交）
    await fs.writeFile(path.join(root, '定稿/正文/0001-第1章.md'), ch(1) + '\n手改了一句。', 'utf8')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 2)
    assert.equal(r.state, 'relink-manual-edits')
  } finally {
    await cleanup()
  }
})

test('序3：工作区有未完成草稿 → 断点续跑', async () => {
  const { ctx, root, cleanup } = await makeGitBook(healthyBook())
  try {
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区/草稿-A.md'), '半成品草稿', 'utf8')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 3)
    assert.equal(r.state, 'resume')
  } finally {
    await cleanup()
  }
})

test('序4：最新定稿章声明收卷 → 卷复盘（声明制）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1),
    '定稿/正文/0002-第2章.md': ch(2, 1, '推进', true),
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 4, `实际：${JSON.stringify(r)}`)
    assert.equal(r.state, 'volume-review')
    assert.equal(r.dto.卷, 1)
    assert.match(r.dto.作品契约, /## 差异化点/)
  } finally {
    await cleanup()
  }
})

test('序4：作品契约缺失时真实 next 阻断，状态机不进入 AI', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1, 1, '推进', true),
  }, { includeContract: false })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.ok, false)
    assert.equal(r.序, 4)
    assert.equal(r.state, 'volume-review-blocked')
    assert.equal(r.needsAI, false)
    assert.match(r.message, /卷复盘停止.*作品契约.*不存在/)
    assert.equal(r.dto.作品契约, undefined)
  } finally {
    await cleanup()
  }
})

test('序4 反例：章号为卷规模整数倍但未声明收卷 → 不触发卷复盘（旧整除行为消失）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 2\n体检周期: 50\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1),
    '定稿/正文/0002-第2章.md': ch(2),
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6, `实际：${JSON.stringify(r)}`)
  } finally {
    await cleanup()
  }
})

test('序4：收卷但该卷卷摘要已存在（复盘已做）→ 不再触发', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1, 1, '推进', true),
    '定稿/摘要/卷摘要/第01卷.md': '# 第一卷摘要\n收束。',
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6, `实际：${JSON.stringify(r)}`)
  } finally {
    await cleanup()
  }
})

test('序5：距上次体检满周期 → 体检', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 3\n体检周期: 2\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1),
    '定稿/正文/0002-第2章.md': ch(2),
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 5, `实际：${JSON.stringify(r)}`)
    assert.equal(r.state, 'health-check')
  } finally {
    await cleanup()
  }
})

test('序5：体检执行后记录章号，未到下个周期不再触发（体检不卡主循环）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 2\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-第1章.md': ch(1),
    '定稿/正文/0002-第2章.md': ch(2),
  })
  try {
    const first = await determineNextState(ctx)
    assert.equal(first.序, 5)
    const hc = await runHealthCheck(ctx)
    assert.equal(hc.ok, true, hc.error)
    const second = await determineNextState(ctx)
    assert.equal(second.序, 6, `实际：${JSON.stringify(second)}`)
  } finally {
    await cleanup()
  }
})

test('序0：book.yaml 解析失败 → 修复确认（不得静默用默认值）', async () => {
  const { ctx, cleanup } = await makeGitBook(
    healthyBook({ 'book.yaml': '书名: [未闭合\n卷规模: : :\n' })
  )
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 0, `实际：${JSON.stringify(r)}`)
    assert.ok(r.dto.failures.some((f) => f.file === 'book.yaml'))
  } finally {
    await cleanup()
  }
})

test('序0：文风铁律 front matter 解析失败 → 修复确认', async () => {
  const { ctx, cleanup } = await makeGitBook(
    healthyBook({ '文风/文风铁律.md': '---\n禁词: [未闭合\n---\n## 铁律\nx' })
  )
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 0)
    assert.ok(r.dto.failures.some((f) => f.file === '文风/文风铁律.md'))
  } finally {
    await cleanup()
  }
})

test('序0：名册/时间线表解析失败 → 修复确认', async () => {
  const { ctx, cleanup } = await makeGitBook(
    healthyBook({
      '定稿/设定/名册.md': '## 名册\n没有表格',
      '定稿/设定/时间线/第01卷.md': '不是表格的内容',
    })
  )
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 0)
    const files = r.dto.failures.map((f) => f.file)
    assert.ok(files.includes('定稿/设定/名册.md'), `实际：${files}`)
    assert.ok(files.includes('定稿/设定/时间线/第01卷.md'), `实际：${files}`)
  } finally {
    await cleanup()
  }
})

test('序3：工作区仅存细纲 → 断点续跑，细纲不被改写（AC5）', async () => {
  const { ctx, root, cleanup } = await makeGitBook(healthyBook())
  try {
    const 细纲内容 = '# 第 2 章细纲\n## 本章要写到的事\n- [ ] 已确认的事'
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区/细纲.md'), 细纲内容, 'utf8')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 3, `实际：${JSON.stringify(r)}`)
    assert.equal(r.state, 'resume')
    assert.equal(await fs.readFile(path.join(root, '工作区/细纲.md'), 'utf8'), 细纲内容)
  } finally {
    await cleanup()
  }
})

test('命中即停：手改(序2) + 工作区草稿(序3) 同时存在 → 先报序2', async () => {
  const { ctx, root, cleanup } = await makeGitBook(healthyBook())
  try {
    await fs.writeFile(path.join(root, '定稿/正文/0001-第1章.md'), ch(1) + '\n手改。', 'utf8')
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区/草稿-A.md'), '草稿', 'utf8')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 2)
  } finally {
    await cleanup()
  }
})

// 决策 D6：跟踪面扩为 定稿/大纲/文风/book.yaml——文风铁律/book.yaml 的修复回写
// 由序 2 补登入档，不再长期漂在未提交区（随后 goto reset 会抹掉）
test('序2 跟踪面（D3 区）：文风铁律与 book.yaml 手改都被检出待补登', async () => {
  const { ctx, root, cleanup } = await makeGitBook(
    healthyBook({ '文风/文风铁律.md': '---\n条数: 1\n---\n- 短句为主。\n' })
  )
  try {
    await fs.writeFile(path.join(root, '文风/文风铁律.md'), '---\n条数: 2\n---\n- 短句为主。\n- 忌堆形容词。\n', 'utf8')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 2, JSON.stringify(r))
    assert.deepEqual(r.dto.变更文件, ['文风/文风铁律.md'])

    await ctx.cache.query('SELECT 1') // 确保缓存活着（下一步复用 ctx）
    // 追加新键（healthyBook 已有 体检周期，重复键会触发序0 解析失败而非序2）
    await fs.appendFile(path.join(root, 'book.yaml'), '每章目标字数: 2500\n', 'utf8')
    const r2 = await determineNextState(ctx)
    assert.equal(r2.序, 2)
    assert.ok(r2.dto.变更文件.includes('book.yaml'), JSON.stringify(r2.dto.变更文件))
  } finally {
    await cleanup()
  }
})

// D6：待定稿目录里只有杂项文件（无章目录、无有效 meta）≠ 批次——
// 现存判定与 readBatch.exists 同口径，不出「续跑」却无批次可跑的自相矛盾 DTO
test('序3 口径（D6）：待定稿/ 只有杂项文件不算批次，不触发批次续跑', async () => {
  const { ctx, root, cleanup } = await makeGitBook(healthyBook())
  try {
    await fs.mkdir(path.join(root, '工作区/待定稿'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区/待定稿/notes.txt'), '杂项', 'utf8')
    const r = await determineNextState(ctx)
    assert.notEqual(r.序, 3, JSON.stringify(r))
    assert.equal(r.序, 6)
  } finally {
    await cleanup()
  }
})

// D7：章号查询失败不裸抛、也不降级成「第 1 章」引导重抄——人话报错 + 自愈指引
test('序4-6 前章号查询失败 → ok:false 人话（不裸抛、不误导起草第 1 章）', async () => {
  const { ctx, cleanup } = await makeGitBook(healthyBook())
  try {
    const broken = {
      repoPath: ctx.repoPath,
      cache: {
        query: async (sql) => {
          if (sql.includes('FROM chapters ORDER BY')) throw new Error('database disk image is malformed')
          return ctx.cache.query(sql)
        },
      },
    }
    const r = await determineNextState(broken)
    assert.equal(r.ok, false)
    assert.equal(r.state, 'cache-error')
    assert.match(r.message, /缓存查询失败/)
    assert.match(r.message, /\.cache/)
  } finally {
    await cleanup()
  }
})
