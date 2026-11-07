import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../../core/src/repo/frontmatter'
import { DOCUMENT_FIELDS, WORLDBOOK_INPUT_FIELDS } from '../../core/src/repo/document-fields'
import { CLUE_STATES, LEDGER_STATES } from '../../core/src/repo/ledger-field-contract'
import { LEDGER_KINDS, LEDGER_NAMES, paths } from '../../core/src/repo/paths'
import { preparePlanTimeline, prepareVolumeOutline } from '../../core/src/design/volume'
import { prepareEntry } from '../../core/src/design/worldbook'
import { checkLedgerSectionFields, parseLedgerSections, parseTimelineSections, planSettlement } from '../../core/src/settlement'
import { queryLedger } from '../../core/src/ledger'
import { writeBatchAtomic } from '../../core/src/repo/atomic'
import { removeSync } from '../../core/src/repo/remove'

const design = fs.readFileSync(path.join(__dirname, '../skills/novel-design/SKILL.md'), 'utf8')
const settle = fs.readFileSync(path.join(__dirname, '../skills/novel-settle/底本/沉淀对账.md'), 'utf8')
const protocol = /```markdown\r?\n([\s\S]*?)\r?\n```/.exec(settle)![1]!
const temporary = fs.realpathSync.native(os.tmpdir())
const key = { 卷: 1, 章: 1, 章名: '协议验证' }
let root: string

function protocolSection(title: string): string {
  const section = protocol.split(/(?=^# )/m).find(value => value.startsWith(`# ${title}\n`))
  if (section === undefined) throw new Error(`Missing protocol section: ${title}`)
  return section.trim()
}

function put(relative: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content, 'utf8')
}

beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-prompt-contract-')) })
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-prompt-contract-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

describe('bundled prompts match the executable document contracts', () => {
  it('keeps the exact five settlement sections and leaves program-owned timeline fields out of the example', () => {
    expect([...protocol.matchAll(/^# (.+)$/gm)].map(match => match[1])).toEqual([
      '时间线变更', '账本变更', '本书层记忆候选', '章摘要', '事实变更',
    ])
    const timeline = protocolSection('时间线变更')
    expect([...timeline.matchAll(/^- ([^：]+)：/gm)].map(match => match[1])).toEqual([
      DOCUMENT_FIELDS.timelineEvent.name, DOCUMENT_FIELDS.storyTime.name,
    ])
    const timeHint = /^- 时点：(.+)$/m.exec(timeline)?.[1]
    expect(timeHint).toContain(DOCUMENT_FIELDS.storyTime.unknown)
  })

  it.each(['清晨', '三日后', DOCUMENT_FIELDS.storyTime.unknown])('the timeline example roundtrips story time %s without creating a new approval gate', time => {
    const candidate = protocolSection('时间线变更')
      .replace('<事件名>', '抵达城门')
      .replace('<一句话>', '甲抵达城门。')
      .replace(/^- 时点：.+$/m, `- 时点：${time}`)
    expect(parseTimelineSections(candidate)).toHaveLength(1)
    for (const name of LEDGER_NAMES) put(paths.账本(name), `# ${name}\n`)
    const packageDir = '草稿区/定稿准备/协议验证'
    put(`${packageDir}/时间线变更.md`, candidate)
    const plan = planSettlement(root, path.join(root, packageDir), { 章节: key, 批准: true, 裁决记录: '已批准' }, key)
    expect(plan.ok, !plan.ok ? plan.reason : '').toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    writeBatchAtomic(root, plan.ops)
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]?.字段).toMatchObject({
      事件: '甲抵达城门。', 时点: time, 章号: '第0001章', 来源: paths.定稿章(1, 1, key.章名), 裁决记录: '已批准',
    })
  })

  it('the event name in the template does not replace its required event description', () => {
    const candidate = protocolSection('时间线变更').replace('<事件名>', '抵达城门').replace(/^- 事件：.+\n/m, '').replace(/^- 时点：.+$/m, '- 时点：未知')
    expect(() => parseTimelineSections(candidate)).toThrow(/缺少事件字段/)
  })

  it('the template state menus exactly match the separate clue and ordinary ledger state sets', () => {
    const ledger = protocolSection('账本变更')
    const menus = [...ledger.matchAll(/^- 状态：(.+)$/gm)].map(match => match[1]!.split('|').map(value => value.trim()))
    expect(menus).toEqual([CLUE_STATES, LEDGER_STATES])
  })

  it.each(LEDGER_KINDS)('the %s template has valid states without borrowing another domain state', kind => {
    const states = kind === '线索' ? CLUE_STATES : LEDGER_STATES
    for (const status of states) {
      const candidate = `# 账本变更\n## ${kind}\n### 信物\n- 状态：${status}\n- 计划来源：本章新增\n`
        + (kind === '线索' ? '- 埋设点：第0001章\n- 预期兑现区间：第2-3章\n' + (status === '已弃' ? '- 弃因：作者已放弃此线索。\n' : '') : '')
        + '说明原文。\n'
      const [section] = parseLedgerSections(candidate)
      expect(() => checkLedgerSectionFields(section!)).not.toThrow()
      const wrongDomain = kind === '线索' ? LEDGER_STATES[0] : CLUE_STATES[0]
      const [wrong] = parseLedgerSections(candidate.replace(`状态：${status}`, `状态：${wrongDomain}`))
      expect(() => checkLedgerSectionFields(wrong!)).toThrow(/状态非法/)
    }
  })

  it('requires agreement only for an explicitly supplied ledger metadata name, not prose', () => {
    expect(settle).toMatch(/非空.*`名称`.*条目标题.*一致/)
    const candidate = '# 账本变更\n## 承诺\n### 信物\n- 状态：进行中\n- 计划来源：本章新增\n'
    for (const metadata of ['', '- 名称：信物\n', '- 名称：\n']) {
      const [section] = parseLedgerSections(candidate + metadata + '纸条原文：\n名称：另一名称\n')
      expect(() => checkLedgerSectionFields(section!)).not.toThrow()
    }
    const [conflict] = parseLedgerSections(candidate + '- 名称：另一名称\n说明原文。\n')
    expect(() => checkLedgerSectionFields(conflict!)).toThrow(/名称与标题存在歧义/)
  })

  it.each([
    ['卷纲', paths.卷纲(1), prepareVolumeOutline],
    ['计划时间线', paths.计划时间线(1), preparePlanTimeline],
  ] as const)('%s body input preserves metadata and an exact retry preserves bytes', (_kind, relative, prepare) => {
    const row = design.split('\n').find(line => line.startsWith('| 卷纲/计划时间线 |'))!
    expect(row).not.toContain('无 frontmatter')
    expect(design).not.toContain('卷纲是整文件覆盖')
    expect(row).toContain('`版本`')
    const fields = { 状态: '已确认', 版本: 3, 父版本: 2, 来源快照: { 依据: '原来源' }, 作者扩展: ['原值'] }
    put(relative, serializeDocument(fields, '原正文。'))
    const prepared = prepare(root, 1, '保留各段后的完整新正文。')
    expect(parseDocument(prepared.content)).toMatchObject({ ok: true, data: { fields: {
      来源快照: fields.来源快照, 作者扩展: fields.作者扩展, 版本: 4, 父版本: 3,
    }, body: '保留各段后的完整新正文。\n' } })
    put(relative, prepared.content)
    expect(prepare(root, 1, '保留各段后的完整新正文。').content).toBe(prepared.content)
  })

  it('the worldbook input table lists exactly the closed writable field set with conditional create requirements', () => {
    const table = design.split('### 世界书字段')[1]?.split(/^## /m)[0]
    expect(table).toBeDefined()
    const rows = [...table!.matchAll(/^\| `([^`]+)` \| (.+) \| (.+) \|$/gm)]
    expect(rows.map(row => row[1])).toEqual(Object.keys(WORLDBOOK_INPUT_FIELDS))
    expect(rows.filter(row => row[2]!.includes('必填')).map(row => row[1])).toEqual(
      Object.entries(WORLDBOOK_INPUT_FIELDS).filter(([, field]) => field.requiredOnCreate).map(([field]) => field),
    )
  })

  it('worldbook field-only input preserves author fields, raw prose and exact empty-alias retry', () => {
    const relative = '世界书/人物档案/甲.md'
    const fields = { 名称: '甲', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创', 别名: '旧别名', 来源快照: { 原样: true }, 作者扩展: ['保留'] }
    const body = '# 甲\n计划首段。\n\n### 事实@第0001章\n来源：定稿/卷01/0001-协议验证.md\n已发生的事实。\n'
    put(relative, serializeDocument(fields, body))
    const op = prepareEntry(root, '人物档案', '甲', { 别名: '' })
    expect(parseDocument(op.content)).toEqual({ ok: true, data: { fields: { ...fields, 别名: '' }, body } })
    put(relative, op.content)
    expect(prepareEntry(root, '人物档案', '甲', { 别名: '' }).content).toBe(op.content)
    expect(() => prepareEntry(root, '人物档案', '甲', { 性质: '事实' })).toThrow(/不能由设计确认/)
  })
})
