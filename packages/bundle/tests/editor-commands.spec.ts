import { describe, expect, it } from 'vitest'
import { EditorState, type StateCommand } from '@codemirror/state'
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { countChars, insertRule, minimalChange, outlineOf, setLineKind, toggleWrap } from '../src/client/editor/commands'
import { readableDiff } from '../src/client/editor/diff'
import { EditorMemory } from '../src/client/editor/memory'
import { isOwnSaveEcho } from '../src/client/editor/sync'
import { nextSaveToast, type SaveToastSource } from '../src/client/editor/save-toast'
import { fileKey } from '../src/client/store'
import type { StudyDocument } from '../src/study/types'

function apply(doc: string, command: StateCommand, selection?: { anchor: number; head: number }) {
  let state = EditorState.create({
    doc,
    extensions: [markdown()],
    ...(selection ? { selection } : {}),
  })
  const ran = command({ state, dispatch(transaction) { state = transaction.state } })
  return { ran, text: state.doc.toString(), state }
}

const draft = (path: string): StudyDocument => ({
  ref: { space: 'book:one', path }, owner: '作品', name: path, absolutePath: '/作品/' + path, body: '正文', hash: 'h', version: 1,
})

describe('编辑命令', () => {
  it('只读文档的格式命令不派发修改，也不增加撤销历史', () => {
    for (const command of [toggleWrap('**'), toggleWrap('*'), ...(['h1', 'h2', 'h3', 'p', 'quote', 'list'] as const).map(setLineKind), insertRule]) {
      let state = EditorState.create({ doc: '# 不可修改', selection: { anchor: 2, head: 6 }, extensions: [markdown(), history(), EditorState.readOnly.of(true)] })
      const initial = state
      let dispatched = 0
      expect(command({ state, dispatch(transaction) { dispatched++; state = transaction.state } })).toBe(false)
      expect(dispatched).toBe(0)
      expect(state).toBe(initial)
      expect(undoDepth(state)).toBe(0)
    }
  })

  it('切换行类型，再次执行同一级标题会去掉标记', () => {
    expect(apply('正文', setLineKind('h1')).text).toBe('# 正文')
    expect(apply('# 正文', setLineKind('h1')).text).toBe('正文')
    expect(apply('正文', setLineKind('h2')).text).toBe('## 正文')
    expect(apply('## 小节', setLineKind('h1')).text).toBe('# 小节')
    expect(apply('正文', setLineKind('quote')).text).toBe('> 正文')
    expect(apply('正文', setLineKind('list')).text).toBe('- 正文')
    expect(apply('# 正文', setLineKind('p')).text).toBe('正文')
  })

  it('可编辑文档的格式命令仍可撤销重做', () => {
    for (const command of [toggleWrap('**'), toggleWrap('*'), ...(['h1', 'h2', 'h3', 'p', 'quote', 'list'] as const).map(setLineKind), insertRule]) {
      let state = EditorState.create({ doc: '# 原文段落', selection: { anchor: 2, head: 6 }, extensions: [markdown(), history()] })
      const run = (cmd: StateCommand) => cmd({ state, dispatch(transaction) { state = transaction.state } })
      expect(run(command)).toBe(true)
      const formatted = state.doc.toString()
      expect(formatted).not.toBe('# 原文段落')
      expect(undoDepth(state)).toBe(1)
      expect(run(undo)).toBe(true)
      expect(state.doc.toString()).toBe('# 原文段落')
      expect(run(redo)).toBe(true)
      expect(state.doc.toString()).toBe(formatted)
    }
  })

  it('包裹与取消加粗', () => {
    const wrapped = apply('文字', toggleWrap('**'), { anchor: 0, head: 2 })
    expect(wrapped.ran).toBe(true)
    expect(wrapped.text).toBe('**文字**')
    const undone = apply(wrapped.text, toggleWrap('**'), { anchor: 2, head: 4 })
    expect(undone.text).toBe('文字')
  })

  it('空行插入分隔线，非空行另起一段', () => {
    expect(apply('', insertRule).text).toBe('---')
    expect(apply('段落', insertRule).text).toBe('段落\n\n---\n')
  })

  it('计数字数时去掉标记和空白', () => {
    expect(countChars('# 标题\n\n他**说**过 *好* `码`')).toBe(7)
    expect(countChars('')).toBe(0)
  })

  it('从 Markdown 语法树抽出标题', () => {
    const state = EditorState.create({ doc: '# 来信\n\n正文\n\n## 渡口\n', extensions: [markdown()] })
    expect(outlineOf(state).map(entry => [entry.level, entry.text])).toEqual([[1, '来信'], [2, '渡口']])
  })

  it('最小差异只替换中间变化的一段', () => {
    expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
    expect(minimalChange('相同', '相同')).toEqual({ from: 2, to: 2, insert: '' })
    expect(minimalChange('', '新增')).toEqual({ from: 0, to: 0, insert: '新增' })
    expect(minimalChange('删掉', '')).toEqual({ from: 0, to: 2, insert: '' })
  })

  it('词级差异能还原原文和建议，并标出改动', () => {
    const parts = readableDiff('他慢慢走来', '他轻轻走来')
    const before = parts.filter(part => part.type !== 'ins').map(part => part.text).join('')
    const after = parts.filter(part => part.type !== 'del').map(part => part.text).join('')
    expect(before).toBe('他慢慢走来')
    expect(after).toBe('他轻轻走来')
    expect(parts.some(part => part.type === 'del' && part.text.includes('慢慢'))).toBe(true)
    expect(parts.some(part => part.type === 'ins' && part.text.includes('轻轻'))).toBe(true)
  })
})

describe('isOwnSaveEcho', () => {
  it('只有保存返回的同一份文档才算自己的回写', () => {
    const document = { body: '正文\n' }
    expect(isOwnSaveEcho({ document }, document)).toBe(true)
    expect(isOwnSaveEcho(undefined, document)).toBe(false)
    expect(isOwnSaveEcho({ document: { body: '正文\n' } }, document)).toBe(false)
  })
})

describe('nextSaveToast', () => {
  const saved = (patch: Partial<SaveToastSource> = {}): SaveToastSource => ({
    operationId: 'op-1', changed: true, previousPath: '知识库/写作笔记.md', path: '知识库/写作笔记.md',
    commit: 'saved', notification: 'delivered', ...patch,
  })

  it('首次保存同时提示保存、提交和通知', () => {
    const first = nextSaveToast(saved(), new Map())
    expect(first.text).toBe('文件已保存 · 版本已提交 · 已交给主控，处理结果见对话')
  })

  it('新稿重新挂载时仍提示已生成新稿', () => {
    const draft = saved({ previousPath: '草稿区/稿1.md', path: '草稿区/稿2.md' })
    const first = nextSaveToast(draft, new Map())
    expect(first.text).toBe('文件已保存 · 已生成新稿 · 版本已提交 · 已交给主控，处理结果见对话')
  })

  it('同一保存状态再次挂载不再提示', () => {
    const draft = saved({ previousPath: '草稿区/稿1.md', path: '草稿区/稿2.md' })
    const first = nextSaveToast(draft, new Map())
    const again = nextSaveToast(draft, first.announced)
    expect(again.text).toBeUndefined()
    expect(again.announced).toBe(first.announced)
  })

  it('提交或通知重试成功只提示增量', () => {
    const failed = saved({ commit: 'failed', notification: 'failed' })
    const first = nextSaveToast(failed, new Map())
    expect(first.text).toBe('文件已保存')
    const committed = nextSaveToast(saved({ commit: 'saved', notification: 'failed' }), first.announced)
    expect(committed.text).toBe('版本已提交')
    const notified = nextSaveToast(saved(), committed.announced)
    expect(notified.text).toBe('已交给主控，处理结果见对话')
  })

  it('clear 之后同一保存可以再提示一次', () => {
    const memory = new EditorMemory()
    const source = saved()
    expect(memory.noteSave(source).text).toContain('文件已保存')
    expect(memory.noteSave(source).text).toBeUndefined()
    memory.clear()
    expect(memory.noteSave(source).text).toContain('文件已保存')
  })
})

describe('编辑状态随新稿迁移', () => {
  it('已缓存的状态迁到新路径', () => {
    const memory = new EditorMemory()
    const from = draft('草稿区/稿1.md')
    const to = draft('草稿区/稿2.md')
    const state = EditorState.create({ doc: '未保存' })
    memory.set('s:' + fileKey(from.ref), state)
    memory.move('s', from, to)
    expect(memory.get('s:' + fileKey(from.ref))).toBeUndefined()
    expect(memory.get('s:' + fileKey(to.ref))).toBe(state)
  })

  it('视图还没卸载时，随后写入旧键会落到新稿', () => {
    const memory = new EditorMemory()
    const from = draft('草稿区/稿1.md')
    const to = draft('草稿区/稿2.md')
    memory.move('s', from, to)
    const state = EditorState.create({ doc: '保存瞬间的正文' })
    memory.set('s:' + fileKey(from.ref), state)
    expect(memory.get('s:' + fileKey(from.ref))).toBeUndefined()
    expect(memory.get('s:' + fileKey(to.ref))).toBe(state)
  })
})
