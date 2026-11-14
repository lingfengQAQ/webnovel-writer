import { describe, expect, it } from 'vitest'
import {
  IRREVERSIBLE_KINDS,
  APPROVE_LABEL,
  applyArbitrationField,
  askAuthor,
  buildAskRequest,
  interpretAnswer,
  parseArbitration,
  serializeArbitration,
  type AskRequest,
} from '../src/arbitration'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import type {
  AskUserQuestionAnswer as DshAskUserQuestionAnswer,
  AskUserQuestionItem as DshAskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions/types'

describe('不可逆清单(插件规格 §6)', () => {
  it('已有裁决与独立维护种类都在清单内且能生成提问', () => {
    expect([...IRREVERSIBLE_KINDS]).toEqual([
      '定稿入档', '世界书条目转正', '记忆入记', '吃书补偿', '规则来源声明',
      '书仓升级', '书仓升级续办', '草稿留档确认',
    ])
    for (const kind of IRREVERSIBLE_KINDS) {
      const req = buildAskRequest(kind, { 范围: '卷01/初见', 摘要: '测试' })
      expect(req.questions).toHaveLength(1)
      expect(req.questions[0]?.id).toBe(kind)
      expect(req.questions[0]?.options?.map((o) => o.label)).toEqual(['批准', '退回'])
    }
  })
  it('维护批准明确执行原计划，不借用文学事实生效文案', () => {
    for (const kind of ['书仓升级', '书仓升级续办', '草稿留档确认'] as const) {
      const question = buildAskRequest(kind, { 范围: '书甲', 摘要: '指纹 abc 与差异' }).questions[0]!
      expect(question.detail).toContain('指纹 abc 与差异')
      expect(question.detail).toBe('书甲\n\n指纹 abc 与差异')
      expect(question.options?.[0]?.description).not.toContain('不可逆动作生效')
      expect(interpretAnswer(kind, { id: '定稿入档', selected: ['批准'] }).ok).toBe(false)
    }
  })
})

describe('答案解释', () => {
  it('批准/退回', () => {
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: ['批准'] }))
      .toEqual({ ok: true, 决定: '已批准' })
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: ['退回'] }))
      .toEqual({ ok: true, 决定: '已退回' })
    expect(interpretAnswer('规则来源声明', { id: '规则来源声明', selected: ['批准'] }))
      .toEqual({ ok: true, 决定: '已确认' })
  })

  it('缺答案或非选项→拒绝', () => {
    expect(interpretAnswer('定稿入档', undefined).ok).toBe(false)
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: [] }).ok).toBe(false)
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: ['随便'] }).ok).toBe(false)
  })

  it('Other 自由文本不算批准(dsh custom 字段,fail-closed)', () => {
    // dsh AskUserQuestionAnswerItem 带 custom?:string(自由文本 Other)。不可逆动作
    // 只认具名批准选项:走自由文本时 selected 为空或非选项,一律拒绝,不得放行。
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: [], custom: '批准' }).ok).toBe(false)
    expect(interpretAnswer('定稿入档', { id: '定稿入档', selected: ['批准', '退回'] }).ok).toBe(false)
    expect(interpretAnswer('定稿入档', { id: '世界书条目转正', selected: ['批准'] }).ok).toBe(false)
  })

  it('askAuthor 注入假 askFn', async () => {
    const approved = await askAuthor(
      async () => ({ answers: [{ id: '记忆入记', selected: ['批准'] }] }),
      '记忆入记',
      { 范围: '本书记忆/文风' },
    )
    expect(approved).toMatchObject({ ok: true, 决定: '已批准' })
    const missing = await askAuthor(
      async () => ({ answers: [] }),
      '吃书补偿',
      { 范围: '卷01' },
    )
    expect(missing.ok).toBe(false)
  })

  it('预取消不发起作者问答', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const result = await askAuthor(async () => {
      calls++
      return { answers: [{ id: '吃书补偿', selected: ['批准'] }] }
    }, '吃书补偿', { 范围: '卷01' }, { signal: controller.signal })
    expect(calls).toBe(0)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('ASK_ABORTED') })
  })

  it('等待中取消立即结束，迟到批准不改变结果', async () => {
    const controller = new AbortController()
    let answer!: (value: { answers: Array<{ id: string; selected: string[] }> }) => void
    const pending = askAuthor(() => new Promise(resolve => { answer = resolve }), '吃书补偿', { 范围: '卷01' }, { signal: controller.signal })
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('ASK_ABORTED') })
    answer({ answers: [{ id: '吃书补偿', selected: ['批准'] }] })
    await Promise.resolve()
    expect(result.ok).toBe(false)
  })
})

describe('作者裁决 frontmatter 往返', () => {
  it('serializeDocument/parseDocument 还原记录', () => {
    const rec = {
      谁: '作者',
      何时: '2026-08-23T00:00:00.000Z',
      版本: 3,
      范围: '卷01/初见',
      种类: '定稿入档' as const,
      决定: '已批准' as const,
    }
    const text = serializeDocument(applyArbitrationField({ 状态: '已批准待入档' }, rec), '正文')
    const parsed = parseDocument(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parseArbitration(parsed.data.fields['作者裁决'])).toEqual(rec)
    expect(parseArbitration(serializeArbitration(rec))).toEqual(rec)
  })
})

describe('裁决 14:请求形状对齐 dsh userQuestions 真源类型', () => {
  it('buildAskRequest 产出可直接赋给 dsh AskUserQuestionItem[]', () => {
    // 编译期即校验:类型不兼容则 tsc 报错(测试仅确认运行期字段齐备)
    const req = buildAskRequest('定稿入档', { 范围: '卷01/初见', 摘要: 'x' })
    const items: DshAskUserQuestionItem[] = req.questions.map((q) => ({ ...q, options: q.options?.map((o) => ({ ...o })) }))
    expect(items[0]?.id).toBe('定稿入档')
    expect(items[0]?.multiSelect).toBe(false)
  })

  it('dsh 答案形状可直接喂给 interpretAnswer', () => {
    const answer: DshAskUserQuestionAnswer = { answers: [{ id: '定稿入档', selected: ['批准'] }] }
    expect(interpretAnswer('定稿入档', answer.answers[0])).toEqual({ ok: true, 决定: '已批准' })
  })

  it('intent 具名批准选项:不靠选项顺序推断裁决(裁决 11 审批≠裁决点)', () => {
    const req = buildAskRequest('定稿入档', { 范围: '卷01/初见', 摘要: 'x' })
    const q = req.questions[0]!
    expect(q.intent).toEqual({ kind: 'plan-review', approve: APPROVE_LABEL })
    // dsh 侧硬约束:approve 必须命名本题某个选项,否则 ask() 拒绝
    expect(q.options?.map((o) => o.label)).toContain(q.intent!.approve)
  })

  it('每种不可逆动作的 intent.approve 都在自身选项内', () => {
    for (const kind of IRREVERSIBLE_KINDS) {
      const q = buildAskRequest(kind, { 范围: 'x' }).questions[0]!
      expect(q.options?.map((o) => o.label), `${kind}: approve 应命名本题选项`).toContain(q.intent!.approve)
    }
  })
})

describe('裁决 14:askAuthor 对齐 dsh ctx.userQuestions.ask() 真签名', () => {
  it('askFn 收到的请求可直接赋给 dsh AskUserQuestionRequest', async () => {
    let seen: AskRequest | undefined
    const r = await askAuthor(
      async (req) => { seen = req; return { answers: [{ id: '定稿入档', selected: ['批准'] }] } },
      '定稿入档',
      { 范围: '卷01/初见' },
    )
    expect(r).toEqual({ ok: true, 决定: '已批准', kind: '定稿入档' })
    expect(seen!.questions[0]?.id).toBe('定稿入档')
  })

  it('透传 agent 与 signal:dsh 靠 agent 判活体,缺则跳过校验', async () => {
    let seen: AskRequest | undefined
    const agent = { id: 'agent-1' } as never
    const ac = new AbortController()
    await askAuthor(
      async (req) => { seen = req; return { answers: [{ id: '记忆入记', selected: ['批准'] }] } },
      '记忆入记',
      { 范围: 'x' },
      { agent, signal: ac.signal },
    )
    expect(seen!.agent).toBe(agent)
    expect(seen!.signal).toBe(ac.signal)
  })

  it('askFn 抛错(如 CALLER_NOT_LIVE)不吞:上抛给调用方', async () => {
    await expect(askAuthor(
      async () => { throw new Error('CALLER_NOT_LIVE') },
      '定稿入档',
      { 范围: 'x' },
    )).rejects.toThrow('CALLER_NOT_LIVE')
  })

  // dsh ask() 一手约束(user-questions/src/index.ts:130):带 intent 的问题必须有
  // detail,否则抛 BAD_INTENT。作者要批准不可逆动作,本就必须看见批准的是什么。
  it('buildAskRequest: 范围/摘要皆空时 detail 仍非空(否则真机 ask() 抛 BAD_INTENT)', () => {
    const q = buildAskRequest('定稿入档', {}).questions[0]!
    expect(q.intent).toBeDefined()
    expect(q.detail).toBeTypeOf('string')
    expect((q.detail as string).trim().length).toBeGreaterThan(0)
  })

  it('buildAskRequest: 五种不可逆动作的 detail 一律非空', () => {
    for (const kind of ['定稿入档', '世界书条目转正', '记忆入记', '吃书补偿', '规则来源声明'] as const) {
      const q = buildAskRequest(kind, {}).questions[0]!
      expect((q.detail ?? '').trim().length, `${kind}: detail 应非空`).toBeGreaterThan(0)
    }
  })
})
