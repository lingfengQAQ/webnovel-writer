import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { archiveChapter, archiveRetcon } from '../src/commit/archive'
import { ARCHIVE_RECEIPT_DIR } from '../src/commit/receipt'
import { emptyContractBody } from '../src/book/scaffold'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import * as gitModule from '../src/commit/git'
import { assembleMaterials, computeMaterials } from '../src/assembly/assemble'
import type { SupplementEdit } from '../src/assembly/sections'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '初见' }
const finalPath = paths.定稿章(key.卷, key.章, key.章名)
const summaryPath = paths.章摘要(key.卷, key.章, key.章名)
const draftPath = `${paths.草稿目录(key.卷, key.章名)}/稿1.md`
const summaryText = '# 章摘要\n\n初见铜铃。\n'

function put(root: string, relative: string, content: string): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function book(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-opening-'))
  roots.push(root)
  git(root, 'init')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  put(root, '.gitignore', '草稿区/\n.webnovel/\n')
  put(root, paths.契约(), emptyContractBody('opening-test'))
  put(root, '账本/时间线.md', '# 时间线\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'vol: 初始化')
  return root
}

function finalizedText(body = '铜铃响起。'): string {
  return serializeDocument({ 身份: key, 章号: 1, 状态: '已定稿', 版本: 1, 生成模块: '定稿入档', 恢复信息: { 来源草稿: draftPath } }, body)
}

function finish(root: string, extraPaths: readonly string[] = []): void {
  put(root, draftPath, serializeDocument({ 身份: key, 角色: '待审稿', 版本: 1 }, '铜铃响起。'))
  expect(archiveChapter({
    bookRoot: root,
    files: [{ 目标: finalPath, 内容: finalizedText() }, { 目标: summaryPath, 内容: summaryText }],
    summary: '初见收尾', extraPaths,
  })).toMatchObject({ ok: true })
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (relative: string): void => {
    const absolute = path.join(root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) { result[relative] = `link:${fs.readlinkSync(absolute)}`; return }
    if (stat.isDirectory()) {
      const children = fs.readdirSync(absolute).sort()
      result[relative] = `directory:${JSON.stringify(children)}`
      for (const name of children) visit(relative ? `${relative}/${name}` : name)
    } else result[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  visit('')
  return result
}

function checkedWithoutWrites(root: string): ReturnType<typeof inspectChapterOpening> {
  const before = snapshot(root)
  const result = inspectChapterOpening(root)
  expect(snapshot(root)).toEqual(before)
  return result
}

function removeReceipts(root: string): void {
  for (const name of fs.readdirSync(path.join(root, ARCHIVE_RECEIPT_DIR))) fs.unlinkSync(path.join(root, ARCHIVE_RECEIPT_DIR, name))
}

function supplementedBook(): { root: string; directory: string; source: string } {
  const root = book()
  const source = '世界书/人物档案/参考.md'
  put(root, source, '# 参考原文\n保留这段原文。\n')
  put(root, paths.确认细纲(key.卷, key.章, key.章名), serializeDocument({ 身份: key, 状态: '已确认', 版本: 1 }, '# 章细纲\n\n初见铜铃。'))
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'design: 备料来源')
  saveSupplementEdit(root, [{ 操作: '设置', 编号: 'registered', 标题: '参考原文', 理由: '核对原文', 性质: '原文', 来源: { 域: '本书', 路径: source } }])
  finish(root)
  return { root, directory: paths.材料包目录(key.卷, key.章名), source }
}

function saveSupplementEdit(root: string, edits: SupplementEdit[]): void {
  const preview = computeMaterials(root, { ...key, 仅预览: true, 补充操作: edits })
  expect(preview.ok, preview.gaps.join(';')).toBe(true)
  const saved = assembleMaterials(root, { ...key, 材料清单哈希: preview.已有清单哈希, 补充操作: preview.补充预览!.map(item => item.操作) })
  expect(saved.ok, saved.gaps.join(';')).toBe(true)
}

afterEach(() => { vi.restoreAllMocks() })
afterAll(() => {
  for (const root of roots.reverse()) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(root).startsWith('maintenance-opening-')).toBe(true)
    removeSync(root)
  }
})

describe('开章只读事实核对', () => {
  it('第一章无前章也无需运行目录，检查不创建 Git exclude 或 runtime', () => {
    const root = book()
    const result = checkedWithoutWrites(root)
    expect(result).toMatchObject({ 状态: '边界已核对', 规则版本: 1, 问题: [], 在途项: [], 快照: { 稳定: true } })
    expect(result.前章).toBeUndefined()
    expect(fs.existsSync(path.join(root, '.webnovel'))).toBe(false)
  })

  it('完整归档后留存来源稿和一致的起草暂存，不误报未完成', () => {
    const root = book()
    finish(root)
    put(root, draftPath.replace('.md', '.起草中.txt'), '铜铃响起。\n')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 前章: key, 问题: [], 在途项: [] })
  })

  it('未来窗口与候选细纲不是已开始写稿，不预选下一个章号', () => {
    const root = book()
    put(root, '大纲/卷规划/卷02/近期窗口.md', '# 近期窗口\n- 下一章 〔已确认〕\n')
    git(root, 'add', '大纲')
    git(root, 'commit', '-m', 'design: 规划未来')
    put(root, '草稿区/章细纲/卷02-下一章.md', '# 候选细纲\n')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
  })

  it('旧收据的共享账本后来正常提交变化，不按旧输出哈希误阻断', () => {
    const root = book()
    put(root, '账本/时间线.md', '# 时间线\n\n第一章事实。\n')
    finish(root, ['账本/时间线.md'])
    put(root, '账本/时间线.md', '# 时间线\n\n第一章事实。\n第二章事实。\n')
    git(root, 'add', '账本/时间线.md')
    git(root, 'commit', '-m', 'ch: 后续合法沉淀')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
  })

  it('无新收据的已支持历史归档，可由真实同次 ch 提交和产物证明', () => {
    const root = book()
    finish(root)
    removeReceipts(root)
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
  })

  it('后续正式吃书改变定稿，原来源稿仍可通过历史原稿关联', () => {
    const root = book()
    finish(root)
    const parsed = parseDocument(finalizedText())
    if (!parsed.ok) throw new Error('fixture')
    const changed = serializeDocument({ ...parsed.data.fields, 版本: 2, 生成模块: '吃书补偿' }, '铜铃没有响起。')
    expect(archiveRetcon({ bookRoot: root, files: [{ 目标: finalPath, 内容: changed }], summary: '修正初见' })).toMatchObject({ ok: true })
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
  })

  it.each(['稿1.md', '稿1.起草中.txt'])('新章只有 %s 时仍识别真实在途，不要求先有 Markdown 成稿', (name) => {
    const root = book()
    put(root, `草稿区/草稿/卷01-初见/${name}`, '铜铃响起。\n')
    const result = checkedWithoutWrites(root)
    expect(result.状态).toBe('需恢复')
    expect(result.在途项).toContainEqual(expect.objectContaining({ 路径: `草稿区/草稿/卷01-初见/${name}` }))
  })

  it('归档 Git 失败时文件和收据存在也不算完成，检查不补交', () => {
    const root = book()
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
    fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
    expect(archiveChapter({ bookRoot: root, files: [{ 目标: finalPath, 内容: finalizedText() }, { 目标: summaryPath, 内容: summaryText }], summary: '初见收尾' })).toMatchObject({ ok: false, written: true })
    const result = checkedWithoutWrites(root)
    expect(result.状态).toBe('需恢复')
    expect(result.在途项).toContainEqual(expect.objectContaining({ 种类: '归档尚未提交' }))
  })

  it('当前真源未提交但历史归档存在时，仍报告需要恢复核对', () => {
    const root = book()
    finish(root)
    put(root, '账本/时间线.md', '# 尚未保存到 Git 的事实\n')
    const result = checkedWithoutWrites(root)
    expect(result.状态).toBe('需恢复')
    expect(result.在途项).toContainEqual(expect.objectContaining({ 路径: '账本/时间线.md', 种类: '真源尚未提交' }))
  })

  it('无关未跟踪笔记不冒充未收尾真源', () => {
    const root = book()
    put(root, '私人笔记.txt', '笔记。\n')
    expect(checkedWithoutWrites(root).状态).toBe('边界已核对')
  })

  it.each(['book.lock', 'acquire.lock', 'writer.lock', '.writer-test.stage'])('读取 %s 只报告，不收锁或恢复', (name) => {
    const root = book()
    if (name === 'writer.lock' || name.endsWith('.stage')) put(root, `.webnovel/${name}/owner-test.json`, JSON.stringify({ pid: 99999999, hostname: 'old-machine' }))
    else put(root, `.webnovel/${name}`, JSON.stringify({ pid: 99999999, hostname: 'old-machine' }))
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '需恢复', 在途项: [expect.objectContaining({ 路径: `.webnovel/${name}` })] })
  })

  it.each(['transactions/task', 'transactions/task.done', 'quarantine/task'])('%s 未清理时不触发已有恢复器', (relative) => {
    const root = book()
    put(root, `.webnovel/${relative}/manifest.json`, '{"phase":"committed"}\n')
    expect(checkedWithoutWrites(root).状态).toBe('需恢复')
  })

  it.each(['index.lock', 'MERGE_HEAD'])('Git 内部 %s 也进入待处理结果且保持原字节', (name) => {
    const root = book()
    put(root, `.git/${name}`, name === 'MERGE_HEAD' ? `${git(root, 'rev-parse', 'HEAD')}\n` : '')
    expect(checkedWithoutWrites(root).状态).toBe('需恢复')
  })

  it('不能把父目录 Git 仓库当成书仓自己的归档证据', () => {
    const root = book()
    const nested = path.join(root, '子书')
    put(nested, paths.契约(), emptyContractBody('child'))
    expect(checkedWithoutWrites(nested)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_GIT_UNAVAILABLE' })]) })
  })

  it('只有 ch 标题和定稿、缺章摘要时不通过', () => {
    const root = book()
    put(root, finalPath, finalizedText())
    git(root, 'add', '定稿')
    git(root, 'commit', '-m', 'ch: 声称完成')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('只有已提交章摘要但没有定稿，不误认为第一章空仓', () => {
    const root = book()
    put(root, summaryPath, summaryText)
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'ch: 缺失正文')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_ORPHAN_SUMMARY' })]) })
  })

  it('定稿与摘要在两个提交中分开保存不伪装为完整旧归档', () => {
    const root = book()
    put(root, finalPath, finalizedText())
    git(root, 'add', '定稿')
    git(root, 'commit', '-m', 'ch: 部分归档')
    put(root, summaryPath, summaryText)
    git(root, 'add', '大纲')
    git(root, 'commit', '-m', 'design: 后补摘要')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_ARCHIVE_UNPROVEN' })]) })
  })

  it('已有产物后来改用 ch 标题提交不倒造首次归档证明', () => {
    const root = book()
    put(root, finalPath, finalizedText())
    put(root, summaryPath, summaryText)
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'design: 暂存产物')
    put(root, finalPath, finalizedText('另一个版本。'))
    put(root, summaryPath, '# 章摘要\n另一个版本。\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'ch: 只有文案')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('没有收据且定稿头无法证明已支持形态时，不只凭路径和正文放行', () => {
    const root = book()
    put(root, finalPath, '只有正文。\n')
    put(root, summaryPath, summaryText)
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'ch: 不明来源')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('后来补上当前头也不能把不明旧正文倒推为已支持旧归档', () => {
    const root = book()
    put(root, finalPath, '不明旧正文。\n')
    put(root, summaryPath, summaryText)
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'ch: 不明来源')
    put(root, finalPath, finalizedText())
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'retcon: 后补当前头')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('来源稿在定稿后被改写时，保留修改并报告无法核实', () => {
    const root = book()
    finish(root)
    put(root, draftPath, serializeDocument({ 身份: key, 角色: '待审稿' }, '后来重新写的正文。'))
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_DRAFT_SOURCE_CHANGED' })]) })
  })

  it('来源草稿指向另一章时不能靠相同正文借用其历史身份', () => {
    const root = book()
    const final = serializeDocument({ 身份: key, 状态: '已定稿', 恢复信息: { 来源草稿: '草稿区/草稿/卷02-另一章/稿1.md' } }, '相同正文。')
    expect(archiveChapter({ bookRoot: root, files: [{ 目标: finalPath, 内容: final }, { 目标: summaryPath, 内容: summaryText }], summary: '错误来源' })).toMatchObject({ ok: true })
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_DRAFT_SOURCE' })]) })
  })

  it.each(['稿2.md', '稿1.起草中.txt'])('历史目录中新的或不匹配的 %s 不被当成留档', (name) => {
    const root = book()
    finish(root)
    put(root, `草稿区/草稿/卷01-初见/${name}`, '新内容。\n')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('损坏收据不变成缺失或健康', () => {
    const root = book()
    finish(root)
    const receipt = fs.readdirSync(path.join(root, ARCHIVE_RECEIPT_DIR))[0]!
    put(root, `${ARCHIVE_RECEIPT_DIR}/${receipt}`, '{"receipt":{}}\n')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_RECEIPT_INVALID' })]) })
  })

  it('重复全书章号不能靠目录排序挑选前章', () => {
    const root = book()
    finish(root)
    put(root, '定稿/卷02/0001-另章.md', finalizedText())
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'ch: 矛盾归档')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_CHAPTER_CONFLICT' })]) })
  })

  it.each(['材料包', '审核', '定稿准备'])('新章只有%s工件时也不能继续正常开章链', (kind) => {
    const root = book()
    const relative = kind === '审核' ? '草稿区/审核/卷01-初见.json' : `草稿区/${kind}/卷01-初见/${kind === '材料包' ? '材料清单.json' : '清单.json'}`
    put(root, relative, '{"schemaVersion":1}\n')
    expect(checkedWithoutWrites(root).状态).toBe('需恢复')
  })

  it('没有已提交收据的 retcon 准备包单独呈报', () => {
    const root = book()
    put(root, `草稿区/提案/retcon-${'a'.repeat(64)}/正文.md`, '待补偿。\n')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '需恢复', 在途项: [expect.objectContaining({ 种类: '补偿准备待核对' })] })
  })

  it('未实现批次工件不能被检查器忽略', () => {
    const root = book()
    put(root, '草稿区/批次/待处理.json', '{}\n')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })

  it('不可读取的草稿目录不是没有草稿', () => {
    const root = book()
    fs.mkdirSync(path.join(root, '草稿区/草稿'), { recursive: true })
    const original = fs.readdirSync.bind(fs)
    vi.spyOn(fs, 'readdirSync').mockImplementation(((target: fs.PathLike, options?: unknown) => {
      if (String(target) === path.join(root, '草稿区/草稿')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return original(target, options as never)
    }) as typeof fs.readdirSync)
    expect(inspectChapterOpening(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'READ_FAILED' })]) })
  })

  it('读取期间新增稿件使快照不稳定，不复用先前的空目录结论', () => {
    const root = book()
    fs.mkdirSync(path.join(root, '草稿区/草稿'), { recursive: true })
    const original = fs.readdirSync.bind(fs)
    let inserted = false
    vi.spyOn(fs, 'readdirSync').mockImplementation(((target: fs.PathLike, options?: unknown) => {
      const result = original(target, options as never)
      if (!inserted && String(target) === path.join(root, '草稿区/草稿')) {
        inserted = true
        put(root, draftPath, '读取期间的新稿。\n')
      }
      return result
    }) as typeof fs.readdirSync)
    expect(inspectChapterOpening(root)).toMatchObject({ 状态: '无法核实', 快照: { 稳定: false } })
  })

  it('Git 状态在检查期间变化时不能给出稳定结论', () => {
    const root = book()
    const original = gitModule.runGit
    let changed = false
    vi.spyOn(gitModule, 'runGit').mockImplementation((directory, args, env) => {
      const result = original(directory, args, env)
      if (!changed && args.includes('status')) {
        changed = true
        put(root, '账本/时间线.md', '# 外部修改\n')
      }
      return result
    })
    expect(inspectChapterOpening(root)).toMatchObject({ 状态: '无法核实', 快照: { 稳定: false }, 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_GIT_CHANGED' })]) })
  })

  it('不存在的书根只返回错误，不创建目录', () => {
    const root = book()
    const missing = path.join(root, '不存在')
    expect(inspectChapterOpening(missing).状态).toBe('无法核实')
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('Git worktree 的共享元数据也保持零写入', () => {
    const root = book()
    const linked = path.join(root, 'linked')
    git(root, 'worktree', 'add', '--detach', linked, 'HEAD')
    const before = snapshot(root)
    expect(inspectChapterOpening(linked)).toMatchObject({ 状态: '边界已核对', 问题: [] })
    expect(snapshot(root)).toEqual(before)
  })

  it('关闭可选 Git 锁仍可能运行 clean 程序；开章检查在 status 前拒绝该路径', () => {
    const root = book()
    put(root, '.gitattributes', '账本/*.md filter=openingProbe\n')
    git(root, 'add', '.gitattributes')
    git(root, 'commit', '-m', 'design: 测试属性')
    git(root, 'config', 'filter.openingProbe.clean', 'node -e "require(\'fs\').writeFileSync(\'filter-ran.txt\',\'ran\');process.stdout.write(require(\'fs\').readFileSync(0))"')
    // Equal-sized content makes status compare blobs instead of only file size.
    put(root, '账本/时间线.md', '# 节拍线\n')
    git(root, '--no-optional-locks', 'status', '--porcelain')
    expect(fs.existsSync(path.join(root, 'filter-ran.txt'))).toBe(true)
    fs.unlinkSync(path.join(root, 'filter-ran.txt'))
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_EXTERNAL_FILTER', 路径: '账本/时间线.md' })]) })
    expect(fs.existsSync(path.join(root, 'filter-ran.txt'))).toBe(false)
  })

  it('配置但未应用到任何文件的过滤器不阻断正常书仓', () => {
    const root = book()
    git(root, 'config', 'filter.unused.clean', 'node -e "require(\'fs\').writeFileSync(\'filter-ran.txt\',\'ran\')"')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
    expect(fs.existsSync(path.join(root, 'filter-ran.txt'))).toBe(false)
  })

  it('process 过滤器与 clean 过滤器采用同一拒绝边界', () => {
    const root = book()
    put(root, '.gitattributes', '账本/*.md filter=openingProcess\n')
    git(root, 'add', '.gitattributes')
    git(root, 'commit', '-m', 'design: 测试属性')
    git(root, 'config', 'filter.openingProcess.process', 'node -e "require(\'fs\').writeFileSync(\'filter-ran.txt\',\'ran\')"')
    put(root, '账本/时间线.md', '# 变更\n')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_EXTERNAL_FILTER' })]) })
    expect(fs.existsSync(path.join(root, 'filter-ran.txt'))).toBe(false)
  })

  it('只读 Git 参数屏蔽签名验证、外部差异程序和隐式补取，不修改配置', () => {
    const root = book()
    finish(root)
    removeReceipts(root)
    git(root, 'config', 'log.showSignature', 'true')
    const original = gitModule.runGit
    const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = []
    vi.spyOn(gitModule, 'runGit').mockImplementation((directory, args, env) => {
      calls.push({ args, env })
      return original(directory, args, env)
    })
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.args).toEqual(expect.arrayContaining(['--no-optional-locks', '--no-lazy-fetch', '--no-pager', 'core.fsmonitor=false', 'log.showSignature=false']))
      expect(call.env).toMatchObject({ GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' })
    }
    const diffs = calls.filter(call => call.args.includes('diff-tree'))
    expect(diffs.length).toBeGreaterThan(0)
    for (const call of diffs) expect(call.args).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv']))
    expect(git(root, 'config', '--get', 'log.showSignature')).toBe('true')
  })

  it('promisor 缺失对象时报告无法核实，不从本地远端补取或写入 objects', () => {
    const root = book()
    finish(root)
    const remote = path.join(root, '.git', 'promisor-fixture')
    git(root, 'clone', '--bare', '--no-hardlinks', root, remote)
    git(root, 'config', 'remote.origin.url', remote)
    git(root, 'config', 'remote.origin.promisor', 'true')
    git(root, 'config', 'remote.origin.partialclonefilter', 'blob:none')
    git(root, 'config', 'core.repositoryformatversion', '1')
    git(root, 'config', 'extensions.partialClone', 'origin')
    const blob = git(root, 'rev-parse', `HEAD:${finalPath}`)
    expect(blob).toMatch(/^[a-f0-9]{40}$/)
    const object = path.join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2))
    expect(fs.existsSync(object)).toBe(true)
    fs.unlinkSync(object)
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_HISTORY_UNAVAILABLE' })]) })
    expect(fs.existsSync(object)).toBe(false)
  })

  it('旧 Git 不支持安全参数时说明能力不可用，不误报书根冲突', () => {
    const root = book()
    const original = gitModule.runGit
    vi.spyOn(gitModule, 'runGit').mockImplementation((directory, args, env) => args.includes('--version')
      ? { status: 129, stdout: '', stderr: 'unknown option: --no-lazy-fetch' }
      : original(directory, args, env))
    const result = checkedWithoutWrites(root)
    expect(result).toMatchObject({ 状态: '无法核实', 问题: expect.arrayContaining([expect.objectContaining({ 代码: 'OPENING_GIT_READONLY_UNAVAILABLE' })]) })
    expect(result.问题.some(item => item.代码 === 'OPENING_GIT_ROOT')).toBe(false)
    expect(result.问题.find(item => item.代码 === 'OPENING_GIT_READONLY_UNAVAILABLE')?.说明).toContain('--no-lazy-fetch')
  })

  it.each([
    ['spawnSync git ENOENT', 'ENOENT'],
    ['spawnSync git EACCES', '没有执行 Git 的权限'],
    ['fatal: private/path/secret-value', '退出码 129'],
  ])('能力失败仅呈报安全分类，原始错误不泄漏：%s', (stderr, hint) => {
    const root = book(), original = gitModule.runGit
    vi.spyOn(gitModule, 'runGit').mockImplementation((directory, args, env) => args.includes('--version')
      ? { status: 129, stdout: '', stderr }
      : original(directory, args, env))
    const result = checkedWithoutWrites(root)
    expect(result.问题.find(item => item.代码 === 'OPENING_GIT_READONLY_UNAVAILABLE')?.说明).toContain(hint)
    expect(JSON.stringify(result)).not.toContain('private/path/secret-value')
  })

  it('真实备料保存补充后完成归档，合法补充目录不被误判未知', () => {
    const { root, directory } = supplementedBook()
    expect(fs.existsSync(path.join(root, directory, '补充/registered.md'))).toBe(true)
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [], 在途项: [] })
  })

  it('已收尾历史补料来源后来变化，不把过期摘录当作尚未归档', () => {
    const { root, source } = supplementedBook()
    put(root, source, '# 来源后来变化\n后续章节的新事实。\n')
    git(root, 'add', source)
    git(root, 'commit', '-m', 'design: 后续来源变化')
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
  })

  it('真实移除补充只退役清单，残留附件不成为新的在途证据', () => {
    const { root, directory } = supplementedBook()
    saveSupplementEdit(root, [{ 操作: '移除', 编号: 'registered' }])
    expect(fs.existsSync(path.join(root, directory, '补充/registered.md'))).toBe(true)
    expect(checkedWithoutWrites(root)).toMatchObject({ 状态: '边界已核对', 问题: [], 在途项: [] })
  })

  it('未登记普通附件不参与材料或收尾证明', () => {
    const { root, directory } = supplementedBook()
    put(root, `${directory}/补充/unregistered.md`, '未登记内容不能变成自动确认的事实或在途指令。\n')
    const result = checkedWithoutWrites(root)
    expect(result).toMatchObject({ 状态: '边界已核对', 问题: [], 在途项: [] })
    expect(JSON.stringify(result)).not.toContain('未登记内容不能')
  })

  it.each(['changed', 'missing', 'wrong-chapter', 'unknown-directory'])('补充的%s仍明确拒绝，不借合法目录放宽全部工件', (kind) => {
    const { root, directory } = supplementedBook()
    if (kind === 'changed') put(root, `${directory}/补充/registered.md`, '已登记附件被改。\n')
    if (kind === 'missing') fs.unlinkSync(path.join(root, directory, '补充/registered.md'))
    if (kind === 'wrong-chapter') {
      const manifestPath = path.join(root, directory, '材料清单.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { 段: Array<Record<string, unknown>> }
      manifest.段.find(item => item['类型'] === '补充')!['适用章上限'] = 2
      fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    }
    if (kind === 'unknown-directory') put(root, `${directory}/补充/unknown/nested.md`, '未知嵌套。\n')
    expect(checkedWithoutWrites(root).状态).toBe('无法核实')
  })
})
