import { describe, expect, it } from 'vitest'
import { classifyReason, errorText, failureFrom, NEXT_STEP, normalizeFailure, toolFailure } from '../src/tool-failure'
import { BookLockError, TransactionConflictError } from '@webnovel/core'

describe('统一失败结构（PR-6）', () => {
  it('从类型和 cause 保留错误码，前缀不改变恢复指引', () => {
    const errors = [
      ...(['book-locked', 'lock-interrupted', 'runtime-link'] as const).map(code => new BookLockError(code, 'opaque')),
      new TransactionConflictError('opaque', []),
    ]
    for (const error of errors) {
      const wrapped = new Error('outer', { cause: error })
      expect(failureFrom(wrapped, '读取失败：')).toEqual({ ok: false, code: error.code, reason: '读取失败：outer', next: NEXT_STEP[error.code] })
      expect(failureFrom(error).code).toBe(error.code)
    }
    expect(failureFrom(new Error('必须传入章号'), '检查失败：')).toMatchObject({ code: 'invalid-argument', reason: '检查失败：必须传入章号' })
  })
  it('按 reason 归类并补上下一步', () => {
    const cases: Array<[string, string]> = [
      ['书仓写入锁定中：另一个写入操作正在进行', 'book-locked'],
      ['书仓锁获取曾中断，留下了 .webnovel/acquire.lock', 'lock-interrupted'],
      ['未获作者批准：作者已退回', 'author-declined'],
      ['作者关闭了裁决窗口，没有做出决定', 'author-cancelled'],
      ['待定稿包在等待作者裁决期间已变化，旧批准不可使用', 'approval-stale'],
      ['定稿只增不改：目标已存在，但没有匹配的可信收据', 'source-conflict'],
      ['归档写入前核对失败，本次没有写入：新归档须同时新建本章定稿与章摘要', 'source-conflict'],
      ['最小设计已写入但提交失败（重跑本工具即可补提交）', 'partial-commit'],
      ['卷必须是从 1 开始的正整数', 'invalid-argument'],
      ['书id不存在或不唯一', 'book-not-found'],
      ['发生了未知情况', 'internal'],
    ]
    for (const [reason, code] of cases) expect(classifyReason(reason), reason).toBe(code)
  })

  it('保留已有字段与 code，只补缺失的 next', () => {
    expect(normalizeFailure({ ok: false, reason: '卷必须是正整数', extra: 1 })).toEqual({ ok: false, reason: '卷必须是正整数', extra: 1, code: 'invalid-argument', next: NEXT_STEP['invalid-argument'] })
    expect(normalizeFailure({ ok: false, code: 'book-busy', reason: '书仓正被其他操作锁定' })).toMatchObject({ code: 'book-busy', next: NEXT_STEP['book-locked'] })
    expect(normalizeFailure({ ok: true, message: 'done' })).toEqual({ ok: true, message: 'done' })
    expect(toolFailure('author-declined', '未获作者批准')).toEqual({ ok: false, code: 'author-declined', reason: '未获作者批准', next: NEXT_STEP['author-declined'] })
  })

  it('错误文本只取 message', () => {
    expect(errorText(new Error('外层：内层'))).toBe('外层：内层')
    expect(errorText('字符串')).toBe('字符串')
  })
})

describe('classifyReason：解析器带行号的报错', () => {
  it('「第 N 行：」归为 parse-error，即使正文含「非法」「缺少」', () => {
    expect(classifyReason('账本变更第 4 行：条目「线索/纸鹤」状态非法「进行中」；合法值：已埋、已示、已收、已弃；修正方法：把「状态」改成合法值之一')).toBe('parse-error')
    expect(classifyReason('时间线变更第 3 行：事件「入城」缺少事件字段；修正方法：加一行')).toBe('parse-error')
  })
})
