import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { prepareSkeleton, prepareVolumeLayout } from '../src/design/skeleton'
import { prepareRecentWindow } from '../src/design/volume'
import { prepareEntry } from '../src/design/worldbook'
import { writeCandidate, confirmOutline } from '../src/outline/write'
import { 定位段小节, 单元字段 } from '../src/outline/template'
import { preparePack } from '../src/prepare/pack'
import { archiveChapter, archiveRetcon } from '../src/commit/archive'
import { ARCHIVE_RECEIPT_DIR, contentHash } from '../src/commit/receipt'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'

const temporary = fs.realpathSync.native(os.tmpdir())
const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '渡口' }
const draftDirectory = paths.草稿目录(key.卷, key.章名)
const source = `${draftDirectory}/稿1.md`
const staging = `${draftDirectory}/稿1.起草中.txt`
const risk = `${draftDirectory}/稿2.md`
const finalized = paths.定稿章(key.卷, key.章, key.章名)

function put(root: string, relative: string, content: string): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim()
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) result[file] = `link:${fs.readlinkSync(path.join(root, file))}`
      else if (entry.isDirectory()) { result[`${file}/`] = ''; walk(file) }
      else result[file] = contentHash(fs.readFileSync(path.join(root, file)))
    }
  }
  walk('')
  return result
}

function addRetained(root: string, kind: 'staging' | 'risk'): string {
  const relative = kind === 'staging' ? staging : risk
  put(root, relative, kind === 'staging' ? '来客走到渡口，半稿还没有写完。\n'
    : serializeDocument({ 身份: key, 版本: 2, 父版本: 1, 生成模块: '润色', 角色: '草稿', 选定: false, 保真风险: ['改动了交易条件'] }, '未选用的另一版交易。'))
  return relative
}

function book(): string {
  const root = fs.mkdtempSync(path.join(temporary, 'retention-opening-'))
  roots.push(root)
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '渡口来客寻找旧船票。', 题材与目标读者: '合成测试' }, { bookId: 'retention-opening' })
  for (const op of [
    prepareSkeleton(root, '# 故事骨架\n## 核心命题 〔暂定〕\n寻找记忆。\n'),
    prepareVolumeLayout(root, '# 分卷布局\n## 故事阶段分配 〔已确认〕\n- 卷01 〔已确认〕\n'),
    prepareRecentWindow(1, [{ 名称: key.章名, 状态: '已确认' }]),
    prepareEntry(root, '人物档案', '林舟', { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创' }),
  ]) put(root, op.relPath, op.content)
  const outline = ['# 章细纲', '## 定位段', ...定位段小节.flatMap(name => [`### ${name}`, name === '章节功能' ? '核对船票。\n- 〔软〕平缓叙述。' : '已核对本章前提。']),
    '## 细纲段', '### 单元 1', ...单元字段.map(name => `- ${name}：来客在渡口核对船票。`)].join('\n')
  writeCandidate(root, { ...key, 来源引用: ['来源:对谈共创'], body: outline })
  expect(confirmOutline(root, key)).toMatchObject({ ok: true })
  put(root, source, serializeDocument({ 身份: key, 版本: 1, 父版本: null, 生成模块: '写稿', 角色: '待审稿', 选定: true, 保真风险: [] },
    '来客在渡口找到了旧船票。\n\n## 草稿候选事实\n- 事实：来客找回船票。'))
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'core.hooksPath', '.git/hooks')
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'vol: 留档开章合成夹具')
  return root
}

function archive(root: string): void {
  const prepared = preparePack(root, key, { 章摘要: '来客找回船票，留在渡口。' })
  expect(prepared.ok, prepared.reason).toBe(true)
  const result = archiveChapter({ bookRoot: root, packageDir: prepared.dir, summary: '渡口收尾',
    settlement: { 章节: key, 批准: true, 裁决记录: '合成作者批准正文及所列留档工件' } })
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(git(root, 'status', '--porcelain=v1')).toBe('')
}

function inspect(root: string) {
  const before = snapshot(root)
  const opening = inspectChapterOpening(root)
  const documents = inspectBookDocuments(root)
  const upgrade = previewBookUpgrade(root)
  expect(snapshot(root)).toEqual(before)
  return { opening, documents, upgrade }
}

function healthy(root: string) {
  const result = inspect(root)
  expect(result.opening, JSON.stringify(result.opening)).toMatchObject({ 状态: '边界已核对', 问题: [], 在途项: [] })
  expect(result.documents, JSON.stringify(result.documents.问题)).toMatchObject({ 结论: '未发现已知问题', 问题: [] })
  expect(result.upgrade, JSON.stringify(result.upgrade.issues)).toMatchObject({ state: 'unchanged', issues: [] })
  return result
}

function receiptFile(root: string): string {
  const directory = path.join(root, ARCHIVE_RECEIPT_DIR)
  const files = fs.readdirSync(directory)
  expect(files).toHaveLength(1)
  return path.join(directory, files[0]!)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== temporary || !path.basename(root).startsWith('retention-opening-')) throw new Error('Unsafe opening fixture cleanup')
    removeSync(root)
  }
})

describe('archive retention versus new work at chapter opening', { timeout: 120000 }, () => {
  it.each(['staging', 'risk'] as const)('accepts %s present before preparation, while preserving its original bytes', kind => {
    const root = book(), relative = addRetained(root, kind)
    const original = fs.readFileSync(path.join(root, relative))
    archive(root)
    expect(fs.readFileSync(path.join(root, relative))).toEqual(original)
    healthy(root)
  })

  it.each(['staging', 'risk'] as const)('rejects the same %s when created only after the clean archive', kind => {
    const root = book()
    archive(root)
    healthy(root)
    const relative = addRetained(root, kind), result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.opening.问题).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_NEW_FILE', 路径: relative }))
    expect(result.upgrade.state).toBe('blocked')
    expect(git(root, 'status', '--porcelain=v1')).toBe('')
  })

  it.each(['changed', 'renamed'] as const)('does not hide %s evidence under the historical inventory', change => {
    const root = book()
    addRetained(root, 'staging'); addRetained(root, 'risk'); archive(root)
    if (change === 'changed') fs.appendFileSync(path.join(root, risk), '\n后来新增的正文。')
    else fs.renameSync(path.join(root, staging), path.join(root, draftDirectory, '稿3.起草中.txt'))
    const result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.opening.问题.some(item => item.代码.startsWith('DRAFT_RETENTION_'))).toBe(true)
    expect(result.upgrade.state).toBe('blocked')
  })

  it.each(['staging', 'risk'] as const)('reports stable missing non-source %s only as notices across all three inspections', kind => {
    const root = book(), relative = addRetained(root, kind)
    archive(root)
    fs.unlinkSync(path.join(root, relative))
    const result = healthy(root)
    expect(result.opening.提示).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_ABSENT', 路径: relative }))
    expect(result.documents.提示).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_ABSENT', 路径: relative }))
    expect(result.upgrade.notices).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_ABSENT', 路径: relative }))
  })

  // Drafts are not in Git; once the archive is trusted, deleting the source or the whole chapter directory cannot be undone
  // and hides no new work, so it is reported separately instead of blocking every later chapter.
  it.each(['source', 'directory'] as const)('reports a deleted %s of a trusted archive only as notices', gone => {
    const root = book()
    addRetained(root, 'staging'); archive(root)
    removeSync(path.join(root, gone === 'source' ? source : draftDirectory))
    const result = healthy(root)
    const expected = gone === 'source' ? [source] : [source, staging]
    for (const relative of expected) for (const notices of [result.opening.提示, result.documents.提示, result.upgrade.notices]) {
      expect(notices).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_ABSENT', 路径: relative }))
    }
    fs.mkdirSync(path.join(root, draftDirectory), { recursive: true })
    put(root, `${draftDirectory}/稿3.md`, serializeDocument({ 身份: key, 版本: 3, 父版本: 1, 生成模块: '写稿', 角色: '草稿', 选定: false }, '删除后新写的稿。'))
    expect(inspect(root).opening.问题).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_NEW_FILE', 路径: `${draftDirectory}/稿3.md` }))
  })

  // Receipts live in the Git-ignored draft area. A fresh clone or a cleaned draft area keeps only the committed digest;
  // the chapter must still open under the pre-retention rules instead of blocking forever.
  it.each(['receipts', 'draft-area'] as const)('falls back to pre-retention rules with a notice when the local %s is gone', gone => {
    const root = book()
    archive(root)
    removeSync(path.join(root, gone === 'receipts' ? ARCHIVE_RECEIPT_DIR : '草稿区'))
    const result = healthy(root)
    const notice = expect.objectContaining({ 代码: 'DRAFT_RETENTION_RECEIPT_ABSENT', 路径: finalized })
    expect(result.opening.提示).toContainEqual(notice)
    expect(result.documents.提示).toContainEqual(notice)
    expect(result.upgrade.notices).toContainEqual(notice)
  })

  it('treats a malformed committed digest without a receipt as unverifiable in opening and document inspection alike', () => {
    const root = book()
    archive(root)
    removeSync(path.join(root, ARCHIVE_RECEIPT_DIR))
    const text = fs.readFileSync(path.join(root, finalized), 'utf8')
    put(root, finalized, text.replace(/^草稿留档摘要:.*$/m, '草稿留档摘要: "abc"'))
    git(root, 'add', '--', finalized); git(root, 'commit', '--quiet', '-m', 'fix: hand-edited digest')
    const result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.documents.结论).not.toBe('未发现已知问题')
    expect(result.documents.问题).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_UNPROVEN', 路径: finalized }))
    expect(result.documents.提示 ?? []).not.toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_RECEIPT_ABSENT' }))
    expect(result.upgrade.state).toBe('blocked')
  })

  it('applies the stricter pre-retention draft rules once the receipt is gone', () => {
    const root = book(), relative = addRetained(root, 'staging')
    archive(root)
    removeSync(path.join(root, ARCHIVE_RECEIPT_DIR))
    const result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.opening.问题).toContainEqual(expect.objectContaining({ 代码: 'OPENING_STAGING_UNPROVEN', 路径: relative }))
    expect(result.upgrade.state).toBe('blocked')
  })

  it('does not accept an enlarged manifest when its local receipt checksum is recomputed', () => {
    const root = book()
    archive(root)
    const file = receiptFile(root), envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
    const relative = addRetained(root, 'risk')
    expect(envelope.receipt.schema).toBe(3)
    envelope.receipt.retention.files.push({ relPath: relative, kind: 'draft', sha256: contentHash(fs.readFileSync(path.join(root, relative))) })
    envelope.checksum = contentHash(JSON.stringify(envelope.receipt))
    fs.writeFileSync(file, JSON.stringify(envelope))
    const result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.upgrade.state).toBe('blocked')
    expect(git(root, 'status', '--porcelain=v1')).toBe('')
  })

  it.each(['receipt', 'manifest', 'marker'] as const)('refuses a missing %s instead of falling back to draft-number heuristics', missing => {
    const root = book()
    addRetained(root, 'staging'); archive(root)
    const file = receiptFile(root)
    if (missing === 'receipt') fs.unlinkSync(file)
    else if (missing === 'manifest') {
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
      delete envelope.receipt.retention
      envelope.checksum = contentHash(JSON.stringify(envelope.receipt))
      fs.writeFileSync(file, JSON.stringify(envelope))
    } else {
      const text = fs.readFileSync(path.join(root, finalized), 'utf8')
      put(root, finalized, text.replace(/^草稿留档摘要:.*\r?\n/m, ''))
      git(root, 'add', '--', finalized)
      git(root, 'commit', '--quiet', '-m', 'fix: 合成丢失留档摘要')
    }
    const result = inspect(root)
    expect(result.opening.状态).toBe('无法核实')
    expect(result.upgrade.state).toBe('blocked')
    expect(git(root, 'status', '--porcelain=v1')).toBe('')
  })

  it('preserves the original retention evidence after a legitimate later retcon', () => {
    const root = book()
    addRetained(root, 'staging'); addRetained(root, 'risk'); archive(root)
    const originalSource = fs.readFileSync(path.join(root, source))
    const previous = parseDocument(fs.readFileSync(path.join(root, finalized), 'utf8'))
    if (!previous.ok) throw new Error('Invalid fixture final')
    const changed = serializeDocument({ ...previous.data.fields, 版本: 2, 父版本: 1, 生成模块: '吃书补偿' }, '来客没有找回旧船票，改为留在渡口等待。')
    expect(archiveRetcon({ bookRoot: root, files: [{ 目标: finalized, 内容: changed }], summary: '更正渡口结果' })).toMatchObject({ ok: true })
    healthy(root)
    expect(fs.readFileSync(path.join(root, source))).toEqual(originalSource)
  })
})
