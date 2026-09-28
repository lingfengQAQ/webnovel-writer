import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { authorDocumentPath, documentHash, readAuthorSave, saveAuthorDocument } from '../src/revise/document'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { listChapterDrafts, nextDraftFileName } from '../src/repo/drafts'
import { scanChapter } from '../src/derive/scan'
import { removeSync } from '../src/repo/remove'

let root: string
const provenance = { sessionId: 'author-test', agentId: 'author-test', toolName: 'author-editor' }
const operationId = 'author-operation-0001'
const draftKey = { 卷: 1, 章: 1, 章名: '开篇' }
function put(relative: string, text: string) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text)
  return text
}
function git(...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }) }
function initGit() {
  git('init', '--quiet'); git('config', 'user.name', 'Author Test'); git('config', 'user.email', 'author@example.invalid')
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false')
  put('.gitignore', '草稿区/\n.webnovel/\n'); git('add', '.'); git('commit', '--quiet', '-m', 'design: fixture')
}
function draft(role = '待审稿', version = 1, file = '稿1.md') {
  const relative = path.posix.join(paths.草稿目录(1, '开篇'), file)
  const text = put(relative, serializeDocument({ 身份: draftKey, 版本: version, 父版本: version > 1 ? version - 1 : null, 角色: role, 选定: role === '待审稿', 来源快照: { 细纲: 1 } }, '原来的正文。\n\n## 草稿候选事实\n\n- 人物：林舟到港。'))
  return { relative, text }
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-author-')) })
afterEach(() => { removeSync(root) })

describe('作者文档保存边界', () => {
  it('拒绝穿越、隐藏文件、盘符、备用数据流和目录别名', () => {
    for (const relative of ['../secret.md', '/absolute.md', 'C:/book.md', '.webnovel/x.md', 'a/node_modules/x.md', 'a/file.md:stream', 'a./x.md', 'a//x.md']) expect(() => authorDocumentPath(root, relative)).toThrow()
    fs.mkdirSync(path.join(root, '定稿'))
    fs.symlinkSync(path.join(root, '定稿'), path.join(root, '别名'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => authorDocumentPath(root, '别名/正文.md')).toThrow(/链接或别名/)
    fs.unlinkSync(path.join(root, '别名'))
  })

  it('保护定稿、冻结构想、机器结构工件', () => {
    for (const relative of ['定稿/正文.md', '构想/初稿.md', '草稿区/审核/记录.md', '草稿区/材料包/说明.md', '世界书/机器.json']) {
      const text = put(relative, '原稿\n')
      expect(() => saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: '改动', provenance })).toThrow(/只读|补偿|冻结/)
      expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(text)
    }
  })

  it('在写入前比较原始哈希，冲突不落盘', () => {
    put('大纲/骨架.md', '他人的最新修改\n')
    expect(() => saveAuthorDocument(root, { path: '大纲/骨架.md', expectedHash: documentHash('旧稿'), body: '我的修改', provenance })).toThrow(/已被修改/)
    expect(fs.readFileSync(path.join(root, '大纲/骨架.md'), 'utf8')).toBe('他人的最新修改\n')
  })

  it('待审稿新版本与降级在一次事务里，元数据和候选事实保留', () => {
    const { relative, text } = draft()
    const before = parseDocument(text)
    if (!before.ok) throw new Error(before.detail)
    const result = saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: before.data.body.replace('原来的正文', '作者的新正文'), provenance, operationId })
    const drafts = listChapterDrafts(root, draftKey)
    expect(result.path).toMatch(/稿2\.md$/)
    expect(result.version).toBe(2)
    expect(drafts.filter(item => item.角色 === '待审稿')).toHaveLength(1)
    expect(drafts.find(item => item.file === '稿1.md')?.body).toBe(before.data.body)
    expect(drafts.find(item => item.file === '稿2.md')?.body).toContain('人物：林舟到港')
    const saved = parseDocument(fs.readFileSync(path.join(root, result.path), 'utf8'))
    expect(saved.ok && saved.data.fields).toMatchObject({ 身份: draftKey, 父版本: 1, 生成模块: '作者手改', 来源快照: { 细纲: 1 } })
  })

  it('实际大写扩展名在 Windows 仍是草稿，POSIX 保持区分大小写', () => {
    const { relative, text } = draft('待审稿', 1, '稿1.MD')
    expect(fs.readdirSync(path.dirname(path.join(root, relative)))).toContain('稿1.MD')
    if (process.platform !== 'win32') {
      expect(listChapterDrafts(root, draftKey)).toEqual([])
      expect(nextDraftFileName(root, draftKey)).toBe('稿1.md')
      expect(scanChapter(root, draftKey).有草稿).toBe(false)
      return
    }
    expect(nextDraftFileName(root, draftKey)).toBe('稿2.md')
    expect(scanChapter(root, draftKey).唯一待审稿).toBe(true)
    const input = { path: relative.replace('.MD', '.md'), expectedHash: documentHash(text), body: '大写旧稿之后的新正文', provenance, operationId }
    const saved = saveAuthorDocument(root, input)
    expect(saved).toMatchObject({ path: relative.replace('稿1.MD', '稿2.md'), previousPath: relative, version: 2 })
    const previous = parseDocument(fs.readFileSync(path.join(root, relative), 'utf8'))
    expect(previous.ok && previous.data.body).toContain('原来的正文')
    expect(previous.ok && previous.data.fields['角色']).toBe('草稿')
    expect(listChapterDrafts(root, draftKey).filter(item => item.角色 === '待审稿')).toHaveLength(1)
    expect(scanChapter(root, draftKey).唯一待审稿).toBe(true)
    expect(saveAuthorDocument(root, { ...input, path: relative })).toEqual(saved)
    expect(fs.readdirSync(path.dirname(path.join(root, relative))).sort()).toEqual(['稿1.MD', '稿2.md'])
  })

  it('Windows 大写新稿参与版本冲突检查，不能被旧稿保存忽略', () => {
    const { relative, text } = draft('草稿', 1)
    const later = draft('待审稿', 2, '稿2.MD')
    if (process.platform !== 'win32') {
      expect(listChapterDrafts(root, draftKey).map(item => item.file)).toEqual(['稿1.md'])
      return
    }
    expect(() => saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: '不应写入的新正文', provenance })).toThrow(/更新版本/)
    expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(text)
    expect(fs.readFileSync(path.join(root, later.relative), 'utf8')).toBe(later.text)
  })

  it('进程重试同一编号不重复生成新稿，保留原差异供通知使用', () => {
    const { relative, text } = draft()
    const input = { path: relative, expectedHash: documentHash(text), body: '作者修改。', provenance, operationId }
    const saved = saveAuthorDocument(root, input)
    const replay = saveAuthorDocument(root, input)
    expect(replay).toEqual(saved)
    expect(listChapterDrafts(root, draftKey)).toHaveLength(2)
    expect(readAuthorSave(root, operationId, provenance.sessionId).previousBody).toContain('原来的正文')
    expect(() => readAuthorSave(root, operationId, 'other-session')).toThrow(/当前会话/)
    expect(() => saveAuthorDocument(root, { ...input, body: '冒用编号' })).toThrow(/另一份修改/)
  })

  it('保存后又被外部改动，重放拒绝覆写新内容', () => {
    const { relative, text } = draft()
    const input = { path: relative, expectedHash: documentHash(text), body: '第一份修改', provenance, operationId }
    const result = saveAuthorDocument(root, input)
    put(result.path, '后续新内容\n')
    expect(() => saveAuthorDocument(root, input)).toThrow(/后来又有变动/)
    expect(fs.readFileSync(path.join(root, result.path), 'utf8')).toBe('后续新内容\n')
  })

  it('旧草稿即使原文件未变也不覆盖更新版本', () => {
    const { relative, text } = draft('草稿')
    draft('待审稿', 2, '稿2.md')
    expect(() => saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: '旧稿修改', provenance })).toThrow(/更新版本/)
    expect(listChapterDrafts(root, draftKey)).toHaveLength(2)
  })

  it('多份待审稿如实拒绝，不按文件名猜来源', () => {
    const { relative, text } = draft()
    draft('待审稿', 2, '稿2.md')
    expect(() => saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: '修改', provenance })).toThrow(/待审稿不唯一/)
  })

  it('暂存记录不能写入时，原稿和角色均保持原样', () => {
    const { relative, text } = draft()
    put('草稿区/.author-edits', '阻挡暂存目录')
    expect(() => saveAuthorDocument(root, { path: relative, expectedHash: documentHash(text), body: '不应落位', provenance })).toThrow()
    expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(text)
    expect(listChapterDrafts(root, draftKey)).toHaveLength(1)
  })

  it('真源修改生成 fix 提交，重放不产生新版本或空提交', () => {
    const relative = '大纲/骨架.md'
    const text = put(relative, serializeDocument({ 版本: 2, 书id: 'test-book' }, '原规划'))
    initGit()
    const input = { path: relative, expectedHash: documentHash(text), body: '作者规划', provenance, operationId }
    const saved = saveAuthorDocument(root, input)
    expect(saved.commit?.ok).toBe(true)
    expect(git('log', '-1', '--format=%s')).toMatch(/^fix:/)
    const head = git('rev-parse', 'HEAD')
    expect(saveAuthorDocument(root, input).version).toBe(3)
    expect(git('rev-parse', 'HEAD')).toBe(head)
  })

  it('提交失败仍有已保存结果，可补提交且不重写正文', () => {
    const relative = '大纲/骨架.md'
    const text = put(relative, serializeDocument({ 版本: 1 }, '原规划'))
    const input = { path: relative, expectedHash: documentHash(text), body: '作者规划', provenance, operationId }
    const saved = saveAuthorDocument(root, input)
    expect(saved.changed).toBe(true)
    expect(saved.commit?.ok).toBe(false)
    initGit()
    expect(saveAuthorDocument(root, input).commit?.ok).toBe(true)
    expect(saveAuthorDocument(root, input).version).toBe(2)
  })

  it('共享资料只保存正文，不产生书仓版本或提交，可清空便签', () => {
    const text = put('知识库/便签.txt', '原便签\n')
    const saved = saveAuthorDocument(root, { path: '知识库/便签.txt', expectedHash: documentHash(text), body: '', shared: true, provenance, operationId })
    expect(saved.commit).toBeUndefined()
    expect(saved.version).toBeNull()
    expect(fs.readFileSync(path.join(root, saved.path), 'utf8')).toBe('\n')
  })
})
