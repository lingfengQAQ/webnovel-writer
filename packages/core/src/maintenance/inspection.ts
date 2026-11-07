import { parseLegacyMemoryIndexLinks as parseMemoryIndexLinks } from '../repo/legacy-memory-index-links'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseDocument, type Frontmatter } from '../repo/frontmatter'
import { parseBookFormatVersion, type BookFormatVersionResult } from '../repo/book-format'
import { DOCUMENT_CONTRACTS, classifyDocumentPath, type DocumentUnitId } from '../repo/document-types'
import { LEDGER_NAMES, MEMORY_KINDS, paths, validateSegment, type LedgerName } from '../repo/paths'
import { classifyBookMemoryDocument } from '../repo/book-memory-contract'
import { parseMachineJson, MACHINE_SCHEMA_VERSION } from '../repo/schema'
import { relPathProblem } from '../repo/rel-path'
import { parseSourceRef } from '../repo/sourceRef'
import { CLUE_FIELDS, CLUE_STATES, LEDGER_FIELD_KEYS, LEDGER_STATES } from '../repo/ledger-field-contract'
import { TIMELINE_FIELD_KEYS, WORLDBOOK_NATURES, WORLDBOOK_STATES } from '../repo/document-fields'
import { ledgerContentShape, FIELD_RE } from '../ledger/clue'
import { parseWorldbookHistory } from '../design/worldbook-history'
import { parseChapterLength } from '../design/chapter-length'
import { parseLabeledStates, volumeAllocationConflict } from '../derive/design'
import { ARTIFACT_STATES, WINDOW_ENTRY_STATES } from '../derive/states'
import { parseWindow } from '../derive/scan'
import { checkConceptCompleteness } from '../inspire/concept'
import { extractSourceRefLines, parseOutline } from '../outline/parse'
import { 定位段小节, 单元字段 } from '../outline/template'
import { parseMaterialManifest } from '../assembly/read'
import { 材料包十段, sectionFileName } from '../assembly/sections'
import { 待定稿包七件 } from '../prepare/pack'
import { readArchiveReceipt } from '../commit/receipt'
import { checkCommitPath } from '../commit/paths'
import { readIndexState } from '../retrieval/state'
import { readSceneRecords } from '../retrieval/scenes'
import { createReadonlyBookSnapshot, type ReadonlyBookSnapshot } from './snapshot'
import { OpeningCommitProof, readOpeningGitState, type OpeningGitState } from './opening-git'
import { parseUpgradeReceipt, upgradeCommitted, upgradeReceiptId, verifyUpgradeBook } from './upgrade-receipt'
import { UPGRADE_RECEIPT_DIR } from './upgrade-reader'
import type { BookInspection, DocumentInspection, DocumentTypeCoverage, MaintenanceIssue, UncheckedDocument } from './types'
import { uniqueMaintenanceIssues } from './types'
import { isUpgradeDraft, planDraftIdentity } from './upgrade-rule-draft'

export const BOOK_INSPECTION_RULE_VERSION = 1
const HASH = /^[a-f0-9]{64}$/
const ROOTS = ['作品契约', '构想', '大纲', '世界书', '账本', '本书记忆', '定稿', '草稿区'] as const
const COMMON = ['UTF-8与YAML', '已有版本及来源字段类型']
const checks: Readonly<Record<DocumentUnitId, readonly string[]>> = {
  I01: [...COMMON, '书id及格式标记', '分部状态与篇幅配置'], I02: [...COMMON, '已确认构想的必填要素'],
  I03: [...COMMON, '已有规划状态'], I04: [...COMMON, '分卷分配状态冲突'],
  I05: [...COMMON, '已有规划状态'], I06: [...COMMON, '已有规划状态'], I07: [...COMMON, '窗口条目状态'],
  I08: [...COMMON, '候选身份及已有来源语法'], I09: [...COMMON, '确认细纲身份及结构'], I10: [...COMMON, '模块名称与重复声明'],
  I11: [...COMMON, '世界书字段与事实分段'], I12: [...COMMON, '世界书公共字段，不推断关系语义'],
  I13: [...COMMON, '账本字段区、身份与状态'], I14: [...COMMON, '线索字段区与旧前缀'], I15: [...COMMON, '事件时点结构区与旧前缀'],
  I16: [...COMMON, '定稿身份、状态及正文'], I17: [...COMMON, '章摘要读取，不判断语义充分性'], I18: [...COMMON, '卷摘要读取，不判断语义充分性'],
  I19: [...COMMON, '记忆类别、已有身份与正文'], I20: [...COMMON, '索引链接与文件覆盖'], I21: [...COMMON, '空分类与有内容旧分类'],
  I22: [...COMMON, '已有稿件角色与身份'], I23: [...COMMON, '基础材料文件可读性'], I24: ['材料清单协议、段及附件哈希'],
  I25: ['审核JSON协议与记录字段，不重建审核批准'], I26: ['准备包JSON协议、路径及文件哈希'], I27: ['未实现的批次协议'],
  I28: [...COMMON, '提案编号、域、类型与状态'], I29: [...COMMON, '补偿来源及影响路径'],
  I30: ['归档收据协议、校验和及目标结构', '历史同批提交，不要求当前共享输出等于旧值'], I31: ['公共语法，不独立证明领域有效'],
  I32: ['不打开SQLite，缓存内容未检查'], I33: ['场景缓存协议、分段边界与已有规则标识'], I34: ['索引控制状态协议'],
  I35: ['编辑收据结构，不验证当前会话授权'],
}
const partialUnits = new Set<DocumentUnitId>(['I12', 'I33', 'I35'])
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const textArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

interface Section { readonly title: string; readonly line: number; readonly lines: readonly string[] }

function ledgerSections(body: string): Section[] {
  const sections: { title: string; line: number; lines: string[] }[] = []
  let fence: { mark: string; length: number } | undefined
  for (const [index, line] of body.split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
    } else if (marker) fence = { mark: marker[1]![0]!, length: marker[1]!.length }
    else {
      const heading = /^##\s+(.+?)\s*$/.exec(line)
      if (heading) { sections.push({ title: heading[1]!, line: index + 1, lines: [] }); continue }
    }
    sections.at(-1)?.lines.push(line)
  }
  return sections
}

class Inspector {
  readonly reader: ReadonlyBookSnapshot
  readonly files = new Map<string, string>()
  readonly reports: DocumentInspection[] = []
  readonly unchecked: UncheckedDocument[] = []
  readonly issues: MaintenanceIssue[]
  private readonly checkedPaths = new Set<string>()
  private readonly receiptPaths = new Set<string>()
  private gitRead = false
  private gitBefore: OpeningGitState | undefined
  private commitProof: OpeningCommitProof | undefined
  private historyUnknown = false
  constructor(root: string, reader?: ReadonlyBookSnapshot) { this.reader = reader ?? createReadonlyBookSnapshot(root); this.issues = this.reader.issues }

  issue(relative: string, message: string, code = 'DOCUMENT_INVALID', extra: Partial<Pick<MaintenanceIssue, '字段' | '行' | '来源形态'>> = {}): void {
    this.issues.push({ 代码: code, 路径: relative, 说明: message, ...extra })
  }

  required(relative: string): void {
    const content = this.reader.readFile(relative)
    if (content === undefined) {
      if (!this.issues.some(issue => issue.路径 === relative)) this.issue(relative, '必需文档不存在；检查不会创建文件', 'REQUIRED_MISSING')
    } else this.files.set(relative, content)
  }

  walk(relative: string): void {
    for (const entry of this.reader.listDirectory(relative) ?? []) {
      const file = `${relative}/${entry.name}`
      if (entry.name === '.gitkeep') continue
      if (entry.kind === 'directory') this.walk(file)
      else if (entry.kind === 'other') { this.reader.readFile(file) }
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.json') || entry.name.endsWith('.起草中.txt')) {
        const content = this.reader.readFile(file)
        if (content !== undefined) this.files.set(file, content)
      } else this.unknown(file, [], '此文件不属于已实现的文档检查范围')
    }
  }

  unknown(relative: string, units: readonly DocumentUnitId[], reason: string): void {
    this.unchecked.push({ 路径: relative, 文档类型: units, 原因: reason })
  }

  receiptHistory(relative: string): OpeningCommitProof | undefined {
    this.receiptPaths.add(relative)
    if (!this.gitRead) {
      this.gitRead = true
      try {
        this.gitBefore = readOpeningGitState(this.reader)
        if (this.gitBefore?.head) this.commitProof = new OpeningCommitProof(this.reader.root, this.gitBefore.head)
        if (this.gitBefore?.pending) this.issue('.git', this.gitBefore.pending, 'RECEIPT_GIT_PENDING')
      } catch (error) {
        this.issue('.git', error instanceof Error ? error.message : String(error), 'RECEIPT_HISTORY_UNKNOWN')
      }
    }
    if (!this.commitProof) {
      this.historyUnknown = true
      this.unknown(relative, ['I30'], '无法读取可信的版本库历史，未核实归档同批提交')
    }
    return this.commitProof
  }

  fields(relative: string, doc: Frontmatter): void {
    const fields = doc.fields
    if (Object.hasOwn(fields, '版本') && !positive(fields['版本'])) this.issue(relative, '已有内容版本须为正安全整数', 'DOCUMENT_INVALID', { 字段: '版本' })
    if (Object.hasOwn(fields, '父版本') && fields['父版本'] !== null && !positive(fields['父版本'])) this.issue(relative, '父版本须为空或正安全整数', 'DOCUMENT_INVALID', { 字段: '父版本' })
    if (Object.hasOwn(fields, '来源引用')) {
      const raw = fields['来源引用']
      if (raw !== null && typeof raw !== 'string' && !textArray(raw)) this.issue(relative, '来源引用须为文本或文本数组', 'DOCUMENT_INVALID', { 字段: '来源引用' })
      else for (const line of extractSourceRefLines(fields)) {
        if (parseSourceRef(line.startsWith('来源') ? line : `来源:${line}`) === null) this.issue(relative, '来源引用语法无效', 'DOCUMENT_INVALID', { 字段: '来源引用' })
      }
    }
  }

  identity(relative: string, fields: Readonly<Record<string, unknown>>, required = false, unnumbered = false): void {
    const identity = fields['身份']
    if (identity === undefined && !required) return
    if (typeof identity === 'string' && isUpgradeDraft(relative)) {
      try {
        if (planDraftIdentity(relative, this.files.get(relative)!, this.files)) {
          this.issue(relative, '旧草稿身份为文本；已有唯一章号证据，可预览格式升级。原文不会由检查改写', 'LEGACY_SHAPE', { 字段: '身份', 来源形态: '草稿文本身份' })
          return
        }
      } catch (error) {
        this.issue(relative, error instanceof Error ? error.message : '旧草稿身份无法唯一映射', 'DOCUMENT_INVALID', { 字段: '身份' })
        return
      }
    }
    if (!record(identity) || !positive(identity['卷']) || !(unnumbered ? nonnegative(identity['章']) : positive(identity['章'])) || !text(identity['章名'])) {
      this.issue(relative, '章节身份须包含有效卷、章和章名', 'DOCUMENT_INVALID', { 字段: '身份' }); return
    }
    const exact = /(?:^|\/)卷(\d+)\/(?:章细纲\/|章摘要\/)?(\d{4,})-(.+)\.md$/.exec(relative)
    const draft = /(?:^|\/)卷(\d+)-([^/]+)(?:\/|\.md$)/.exec(relative)
    if ((exact && (identity['卷'] !== Number(exact[1]) || identity['章'] !== Number(exact[2]) || identity['章名'] !== exact[3]))
      || (draft && (identity['卷'] !== Number(draft[1]) || identity['章名'] !== draft[2]))) this.issue(relative, '章节身份与文件位置不一致', 'DOCUMENT_INVALID', { 字段: '身份' })
  }

  planning(relative: string, doc: Frontmatter): void {
    if (doc.fields['状态'] !== undefined && !['已确认', '暂定', '留白'].includes(String(doc.fields['状态']))) this.issue(relative, '规划状态不在当前词表中', 'DOCUMENT_INVALID', { 字段: '状态' })
    for (const row of parseLabeledStates(doc.body)) {
      if (!['已确认', '暂定', '留白', '已消费', '已失效', '等待补设计'].includes(row.state)) this.issue(relative, `规划标注状态无效：${row.name}`, 'DOCUMENT_INVALID', { 字段: '状态' })
    }
  }

  ledger(relative: string, doc: Frontmatter, kind: LedgerName): void {
    const sections = ledgerSections(doc.body)
    if (!sections.length && doc.body.trim() !== `# ${kind}`) this.unknown(relative, kind === '时间线' ? ['I15'] : kind === '线索' ? ['I14'] : ['I13'], '非空账本未识别出条目边界')
    for (const section of sections) {
      const cut = section.lines.findIndex(line => /^###\s+正文\s*$/.test(line))
      if (cut < 0) { this.issue(relative, '账本条目缺少明确正文边界，不能按正文猜字段', 'UNSUPPORTED_SHAPE', { 行: section.line }); continue }
      const allowed = kind === '时间线' ? [...TIMELINE_FIELD_KEYS] : [...LEDGER_FIELD_KEYS, ...(kind === '线索' ? CLUE_FIELDS : [])]
      const values: Record<string, string> = {}
      for (const [index, line] of section.lines.slice(0, cut).entries()) {
        const match = FIELD_RE.exec(line)
        const key = match?.[1]?.trim()
        if (!key || !(allowed as readonly string[]).includes(key)) continue
        if (Object.hasOwn(values, key)) this.issue(relative, `字段重复：${key}`, 'DOCUMENT_INVALID', { 字段: key, 行: section.line + index + 1 })
        else values[key] = match![2]!.trim()
      }
      const shape = kind === '线索' || kind === '时间线' ? ledgerContentShape(kind, values, section.lines.slice(cut + 1).join('\n')) : undefined
      if (shape) this.issue(relative, shape.reason + (shape.format === 'legacy' ? '。本次检查不会改写。须先生成整仓升级预览；执行仍须作者批准' : ''), shape.format === 'legacy' ? 'LEGACY_SHAPE' : 'DOCUMENT_INVALID', { 行: section.line, 来源形态: `${kind}正文前缀` })
      if (kind === '时间线') {
        if (!shape) for (const field of TIMELINE_FIELD_KEYS) {
          if (!values[field]) this.issue(relative, `时间线结构字段缺失或为空：${field}`, 'DOCUMENT_INVALID', { 字段: field, 行: section.line })
        }
      } else {
        for (const field of LEDGER_FIELD_KEYS) if (!values[field]) this.issue(relative, `账本结构字段缺失或为空：${field}`, 'DOCUMENT_INVALID', { 字段: field, 行: section.line })
        if (values['名称'] && values['名称'] !== section.title) this.issue(relative, '账本名称与条目标题冲突', 'DOCUMENT_INVALID', { 字段: '名称', 行: section.line })
        if (values['类型'] && values['类型'] !== kind) this.issue(relative, '账本类型与文件分类冲突', 'DOCUMENT_INVALID', { 字段: '类型', 行: section.line })
        if (!((kind === '线索' ? CLUE_STATES : LEDGER_STATES) as readonly string[]).includes(values['状态'] ?? '')) this.issue(relative, '账本状态不在所属词表中', 'DOCUMENT_INVALID', { 字段: '状态', 行: section.line })
        if (kind === '线索') {
          const needed = ['埋设点', '预期兑现区间', ...(values['状态'] === '已弃' ? ['弃因'] : [])]
          const missing = needed.filter(field => !values[field])
          if (!shape) for (const field of missing) this.issue(relative, `线索结构字段缺失或为空：${field}`, 'DOCUMENT_INVALID', { 字段: field, 行: section.line })
        }
      }
    }
  }

  markdown(relative: string, content: string, unit: DocumentUnitId): void {
    const parsed = parseDocument(content)
    if (!parsed.ok) { this.issue(relative, parsed.detail); return }
    const doc = parsed.data, fields = doc.fields
    this.fields(relative, doc)
    if (['I01', 'I03', 'I04', 'I05', 'I06'].includes(unit)) this.planning(relative, doc)
    switch (unit) {
      case 'I01': {
        if (!text(fields['书id']) || /[\r\n]/.test(String(fields['书id']))) this.issue(relative, '书id缺失或无效', 'DOCUMENT_INVALID', { 字段: '书id' })
        const policy = parseChapterLength(content)
        if (policy.状态 === '配置错误') this.issue(relative, policy.原因, 'DOCUMENT_INVALID', { 字段: '章节篇幅' })
        break
      }
      case 'I02': {
        const result = checkConceptCompleteness(content)
        if (!result.ok) this.issue(relative, `构想快照不完整：${result.gaps.join('、')}`)
        break
      }
      case 'I04': {
        const conflict = volumeAllocationConflict(doc.body)
        if (conflict) this.issue(relative, conflict, 'DOCUMENT_INVALID', { 字段: '状态' })
        break
      }
      case 'I07':
        for (const row of parseWindow(doc.body)) if (!(WINDOW_ENTRY_STATES as readonly string[]).includes(row.state)) this.issue(relative, `窗口条目状态无效：${row.name}`, 'DOCUMENT_INVALID', { 字段: '状态' })
        break
      case 'I08': case 'I09': {
        this.identity(relative, fields, false, unit === 'I08')
        const outline = parseOutline(content)
        if (outline.状态 !== null && !(ARTIFACT_STATES as readonly string[]).includes(outline.状态)) this.issue(relative, '细纲状态无效', 'DOCUMENT_INVALID', { 字段: '状态' })
        if (unit === 'I09' && outline.状态 === '已确认') {
          if (定位段小节.some(name => !outline.定位[name]) || !outline.units.length || outline.units.some(row => 单元字段.some(name => !row.fields[name]))) this.issue(relative, '确认细纲缺少定位段或叙事单元字段')
        }
        break
      }
      case 'I10': {
        const names = new Set<string>()
        for (const line of doc.body.split('\n')) {
          const match = /^-\s+(.+?)(?:\s*[：:]\s*.*)?$/.exec(line)
          if (!match) continue
          const name = match[1]!.trim()
          if (validateSegment(name).length || names.has(name)) this.issue(relative, '模块名称无效或重复')
          names.add(name)
        }
        break
      }
      case 'I11': {
        const history = parseWorldbookHistory(content)
        if (!history.ok) { this.issue(relative, history.detail); break }
        if (history.data.未闭合围栏) this.issue(relative, '世界书围栏未闭合，不能证明事实边界')
        for (const name of ['类型', '性质', '状态', '来源']) if (!text(fields[name]) || /[\r\n]/.test(String(fields[name]))) this.issue(relative, `世界书字段缺失或无效：${name}`, 'DOCUMENT_INVALID', { 字段: name })
        if (!(WORLDBOOK_NATURES as readonly unknown[]).includes(fields['性质']) || !(WORLDBOOK_STATES as readonly unknown[]).includes(fields['状态'])) this.issue(relative, '世界书性质或状态无效')
        if (fields['名称'] !== undefined && fields['名称'] !== path.posix.basename(relative, '.md')) this.issue(relative, '世界书名称与文件名不一致', 'DOCUMENT_INVALID', { 字段: '名称' })
        if (fields['生成模块'] === '吃书补偿' && fields['性质'] === '计划') this.issue(relative, '旧吃书更正标记与计划性质并存，须核对原始证据', 'LEGACY_SHAPE', { 来源形态: '世界书更正归属' })
        for (const append of history.data.追加) if (!positive(append.章)) this.issue(relative, '事实追加章号无效', 'DOCUMENT_INVALID', { 行: append.行号 })
        break
      }
      case 'I13': case 'I14': case 'I15':
        this.ledger(relative, doc, path.posix.basename(relative, '.md') as LedgerName)
        break
      case 'I16':
        this.identity(relative, fields, true)
        if (fields['状态'] !== '已定稿' || !doc.body.trim()) this.issue(relative, '定稿章状态或正文无效')
        break
      case 'I19': case 'I21': {
        const shape = classifyBookMemoryDocument(fields, path.posix.basename(relative, '.md'))
        if (!shape.ok) { this.issue(relative, shape.reason); break }
        if (shape.format === 'legacy') {
          if (doc.body.trim() !== '' && doc.body.trim() !== `# ${shape.memoryKind}`) this.issue(relative, '分类文件仍含旧记忆内容。本次检查不会改写。须先生成整仓升级预览；执行仍须作者批准', 'LEGACY_SHAPE', { 来源形态: '一类多条目记忆' })
        } else {
          if (fields['名称'] !== undefined && fields['名称'] !== path.posix.basename(relative, '.md')) this.issue(relative, '记忆名称与文件名不一致', 'DOCUMENT_INVALID', { 字段: '名称' })
          for (const name of ['名称', '描述', '来源', '状态']) if (fields[name] !== undefined && typeof fields[name] !== 'string') this.issue(relative, `记忆已有字段不是文本：${name}`, 'DOCUMENT_INVALID', { 字段: name })
          if (!doc.body.trim()) this.issue(relative, '记忆正文为空')
        }
        break
      }
      case 'I20': this.memoryIndex(relative, content); break
      case 'I22':
        this.identity(relative, fields)
        if (fields['角色'] !== undefined && !['草稿', '待审稿'].includes(String(fields['角色']))) this.issue(relative, '稿件角色无效', 'DOCUMENT_INVALID', { 字段: '角色' })
        if (fields['选定'] !== undefined && typeof fields['选定'] !== 'boolean') this.issue(relative, '稿件选定标记须为布尔值', 'DOCUMENT_INVALID', { 字段: '选定' })
        break
      case 'I28':
        if (!text(fields['编号']) || !['内容修订', '吃书补偿'].includes(String(fields['域'])) || !['补充设计', '修改计划', '事实更正', '吃书'].includes(String(fields['类型'])) || !['待裁决', '已通过', '已驳回'].includes(String(fields['状态'])) || !text(fields['来源'])) this.issue(relative, '提案编号、域、类型、状态或来源无效')
        break
      case 'I29':
        if (!text(fields['关联提案']) || !text(fields['日期']) || !textArray(fields['受影响工件']) || (fields['受影响工件'] as string[]).some(value => relPathProblem(value, { strict: true }) !== null)) this.issue(relative, '补偿事件来源、日期或影响路径无效')
        break
    }
  }

  memoryIndex(relative: string, content: string): void {
    const links = parseMemoryIndexLinks(content)
    for (const problem of links.problems) this.issue(relative, problem, 'DOCUMENT_INVALID', { 行: Number(/第(\d+)/.exec(problem)?.[1]) || undefined })
    const unique = new Set(links.filenames)
    if (unique.size !== links.filenames.length) this.issue(relative, '记忆索引含重复目标')
    for (const [index, line] of content.split('\n').entries()) {
      const names = parseMemoryIndexLinks(line).filenames
      if (names.some(name => /[\s()[\]#%&`]/.test(name)) && !line.includes('](<./')) this.issue(relative, '旧索引目标尚未使用明确编码，文件名仍按原字面值读取', 'LEGACY_SHAPE', { 行: index + 1, 来源形态: '旧记忆索引目标' })
    }
    for (const filename of unique) if (this.reader.readFile(`本书记忆/${filename}`) === undefined) this.issue(relative, `记忆索引目标不可读：${filename}`)
    for (const [file, value] of this.files) {
      if (!/^本书记忆\/[^/]+\.md$/.test(file) || file === relative) continue
      const doc = parseDocument(value)
      if (doc.ok && Object.hasOwn(doc.data.fields, '类') && !unique.has(path.posix.basename(file))) this.issue(relative, `记忆索引缺少条目：${path.posix.basename(file)}`)
    }
  }

  machine(relative: string, content: string, unit: DocumentUnitId): void {
    if (unit === 'I30') {
      if (relative.startsWith(`${UPGRADE_RECEIPT_DIR}/`)) {
        const receipt = parseUpgradeReceipt(content, upgradeReceiptId(relative))
        verifyUpgradeBook(this.reader, receipt)
        if (!this.receiptHistory(relative)) return
        try {
          if (!upgradeCommitted(this.reader.root, receipt, this.gitBefore?.head)) this.issue(relative, '维护文件已写入，但尚无整批提交证明；请按操作编号续办', 'UPGRADE_PENDING_COMMIT')
        } catch (error) {
          this.historyUnknown = true
          this.issue(relative, error instanceof Error ? error.message : String(error), 'RECEIPT_HISTORY_UNKNOWN')
          this.unknown(relative, ['I30'], '维护历史无法核实，未证明同批提交已完成')
        }
        return
      }
      const receipt = readArchiveReceipt(this.reader.root, path.posix.basename(relative, '.json'))
      if (!receipt) { this.issue(relative, '归档收据读取期间已消失'); return }
      const proof = this.receiptHistory(relative)
      if (!proof) return
      try {
        if (!proof.committed(receipt)) this.issue(relative, '归档收据尚无可核实的同批提交，请核对待提交或中断情况；本次不补交', 'RECEIPT_PENDING_COMMIT')
      } catch (error) {
        this.historyUnknown = true
        this.issue(relative, error instanceof Error ? error.message : String(error), 'RECEIPT_HISTORY_UNKNOWN')
        this.unknown(relative, ['I30'], '归档历史无法核实，未证明同批提交已完成')
      }
      return
    }
    if (unit === 'I33') {
      readSceneRecords(this.reader.root)
      this.unknown(relative, ['I33'], '当前定稿来源与缓存新鲜度未核实；保留尚未引用的历史记录，不据此判为损坏')
      return
    }
    if (unit === 'I34') { readIndexState(this.reader.root); return }
    if (unit === 'I35') {
      const receipt: unknown = JSON.parse(content)
      if (!record(receipt) || receipt['schema'] !== 1 || !HASH.test(String(receipt['inputHash'])) || !record(receipt['result']) || receipt['result']['operationId'] !== path.posix.basename(relative, '.json') || !HASH.test(String(receipt['result']['hash'])) || typeof receipt['result']['changed'] !== 'boolean') this.issue(relative, '作者编辑收据字段无效')
      return
    }
    const parsed = parseMachineJson(content, MACHINE_SCHEMA_VERSION)
    if (!parsed.ok) { this.issue(relative, parsed.detail, /未知/.test(parsed.detail) ? 'UNSUPPORTED_SCHEMA' : 'DOCUMENT_INVALID'); return }
    const data = parsed.data
    if (unit === 'I25') {
      if (typeof data['完成'] !== 'boolean' || !Array.isArray(data['问题']) || !data['问题'].every(record) || !record(data['模块']) || !Object.values(data['模块']).every(value => record(value) && typeof value['完成'] === 'boolean')) this.issue(relative, '审核记录的完成标记、问题或模块结构无效')
      for (const field of ['审稿哈希', '审读指纹']) if (data[field] !== undefined && !HASH.test(String(data[field]))) this.issue(relative, '审核证据哈希无效', 'DOCUMENT_INVALID', { 字段: field })
    } else if (unit === 'I24') this.materialManifest(relative, content)
    else if (unit === 'I26') {
      const outputs = data['文件'], artifacts = data['工件']
      if (!Array.isArray(outputs) || !outputs.length || !Array.isArray(artifacts)) { this.issue(relative, '准备包缺少文件或工件清单'); return }
      const names = new Set<string>()
      for (const item of artifacts) {
        if (!record(item) || !text(item['名']) || names.has(item['名']) || !(待定稿包七件 as readonly string[]).includes(item['名']) || !HASH.test(String(item['sha256']))) { this.issue(relative, '准备包工件名称或哈希无效'); continue }
        names.add(item['名'])
        const body = this.reader.readFile(`${path.posix.dirname(relative)}/${item['名']}`)
        if (body === undefined || sha(body) !== item['sha256']) this.issue(relative, `准备包工件缺失或哈希不一致：${item['名']}`)
      }
      if (names.size !== 待定稿包七件.length) this.issue(relative, '准备包七件清单不完整')
      const targets = new Set<string>()
      for (const item of outputs) {
        if (!record(item) || !text(item['源']) || !names.has(item['源']) || !text(item['目标']) || relPathProblem(item['目标'], { strict: true }) !== null || !checkCommitPath(this.reader.root, item['目标']).ok || !HASH.test(String(item['sha256']))) { this.issue(relative, '准备包输出路径或哈希无效'); continue }
        const artifact = artifacts.find(row => record(row) && row['名'] === item['源']) as Record<string, unknown> | undefined
        if (artifact?.['sha256'] !== item['sha256'] || targets.has(item['目标'])) this.issue(relative, '准备包输出哈希与工件不一致或目标重复')
        targets.add(item['目标'])
      }
    }
  }

  materialManifest(relative: string, content: string): void {
    const manifest = parseMaterialManifest(content)
    const rows = manifest.raw['段']
    if (!Array.isArray(rows) || !['段齐备', '段有缺'].includes(String(manifest.raw['状态'])) || !nonnegative(manifest.raw['合计字数'])) { this.issue(relative, '材料清单状态、字数或段列表无效'); return }
    const base = new Set<string>()
    for (const row of rows) {
      if (!record(row) || !text(row['段']) || !textArray(row['来源']) || typeof row['版本'] !== 'string' || typeof row['选用原因'] !== 'string' || !['完整', '残缺', '空', '旧格式'].includes(String(row['完整性'])) || (row['字数'] !== undefined && !nonnegative(row['字数']))) { this.issue(relative, '材料段字段无效'); continue }
      if (row['类型'] !== '补充') {
        const index = (材料包十段 as readonly string[]).indexOf(row['段'])
        if (index < 0 || base.has(row['段'])) { this.issue(relative, '基础材料段未知或重复'); continue }
        base.add(row['段'])
        const file = `${path.posix.dirname(relative)}/${sectionFileName(index, 材料包十段[index]!)}`
        if (this.reader.readFile(file) === undefined) this.issue(file, '基础材料段缺失或不可读', 'REQUIRED_MISSING')
      }
    }
    if (base.size !== 材料包十段.length) this.issue(relative, '基础材料十段清单不完整')
    for (const supplement of manifest.sections.filter(row => '类型' in row && row.类型 === '补充')) {
      if (!('内容哈希' in supplement)) continue
      const file = `${path.posix.dirname(relative)}/${supplement.文件}`
      const value = this.reader.readFile(file)
      if (value === undefined || sha(value) !== supplement.内容哈希 || Array.from(value).length !== supplement.字数) this.issue(file, '补充材料附件缺失或哈希不一致')
      const source = supplement.来源快照
      if (source.域 !== '本书') this.unknown(file, ['I24'], '书房来源不在本次书仓读取范围，未核对其新鲜度')
      else {
        const raw = this.reader.readFile(source.路径)
        if (raw === undefined || sha(raw) !== source.读取哈希) this.issue(file, '补充材料来源已变化或不可读，保留旧证据', 'EVIDENCE_STALE')
      }
    }
    const registered = new Set(manifest.sections.flatMap(row => '文件' in row ? [`${path.posix.dirname(relative)}/${row.文件}`] : []))
    for (const file of this.files.keys()) if (file.startsWith(`${path.posix.dirname(relative)}/补充/`) && !registered.has(file)) this.unknown(file, ['I24'], '附件未在材料清单登记，未作为有效补充核对')
  }

  inspectFile(relative: string, content: string): void {
    if (this.checkedPaths.has(relative)) return
    this.checkedPaths.add(relative)
    const match = classifyDocumentPath(relative)
    const staging = /^草稿区\/草稿\/卷\d{2,}-.+\/稿\d+\.起草中\.txt$/.test(relative)
    let units: readonly DocumentUnitId[] = match?.units ?? (staging ? ['I22'] as const : [])
    if (units.includes('I21')) {
      const parsed = parseDocument(content)
      if (parsed.ok) {
        const shape = classifyBookMemoryDocument(parsed.data.fields, path.posix.basename(relative, '.md'))
        if (shape.ok) units = [shape.format === 'legacy' ? 'I21' : 'I19']
      }
    }
    const unit = units[0]
    if (!unit) { this.unknown(relative, [], '路径未对应已实现的文档类型；不猜测其用途'); return }
    const before = this.issues.length, unseen = this.unchecked.length
    try {
      if (unit === 'I27') { this.unknown(relative, units, '连写批次协议尚未实现'); this.issue(relative, '连写批次协议尚未实现', 'UNSUPPORTED_SCHEMA') }
      else if (relative.endsWith('.json')) this.machine(relative, content, unit)
      else if (!staging) this.markdown(relative, content, unit === 'I26' && relative.endsWith('/正文.md') ? 'I16' : unit)
    } catch (error) { this.issue(relative, error instanceof Error ? error.message : String(error)) }
    let performed = checks[unit]
    if (staging) performed = ['UTF-8原文读取', '起草中暂存路径形状']
    else if (unit === 'I24' && relative.endsWith('.md')) performed = [...COMMON, '补充附件原文读取']
    else if (unit === 'I26' && relative.endsWith('.md')) performed = [...COMMON, ...(relative.endsWith('/正文.md') ? ['待归档正文身份与状态'] : ['准备工件原文读取'])]
    if ((unit === 'I23' || unit === 'I24') && relative.endsWith('.md')) {
      const directory = relative.includes('/补充/') ? path.posix.dirname(path.posix.dirname(relative)) : path.posix.dirname(relative)
      if (!this.files.has(`${directory}/材料清单.json`)) this.unknown(relative, units, '材料清单不存在，未验证整包登记与依赖')
    }
    if (unit === 'I26' && relative.endsWith('.md') && !this.files.has(`${path.posix.dirname(relative)}/清单.json`)) this.unknown(relative, units, '准备清单不存在，未验证整包哈希和目标')
    this.reports.push({ 路径: relative, 文档类型: units, 检查: performed, 结果: unit === 'I30' && this.unchecked.some(item => item.路径 === relative) ? '部分检查' : this.issues.length > before ? '失败' : this.unchecked.length > unseen ? '部分检查' : '已检查' })
  }

  run(): BookInspection {
    this.reader.listDirectory('')
    for (const root of ROOTS) this.walk(root)
    this.required(paths.契约())
    const contract = this.files.get(paths.契约())
    const format: BookFormatVersionResult = contract === undefined
      ? { ok: false, kind: this.issues.some(issue => issue.路径 === paths.契约() && issue.代码 === 'READ_FAILED') ? 'read-error' : 'missing', reason: '作品契约不存在或无法读取' }
      : parseBookFormatVersion(contract)
    const future = !format.ok && format.kind === 'unsupported-version'
    if (!future) for (const relative of [paths.构想快照(), paths.故事骨架(), paths.分卷布局(), '世界书/模块声明.md', ...LEDGER_NAMES.map(paths.账本)]) this.required(relative)
    for (const entry of this.reader.listDirectory('.webnovel') ?? []) {
      const relative = `.webnovel/${entry.name}`
      const match = classifyDocumentPath(relative)
      if (match?.units[0] === 'I32') this.unknown(relative, ['I32'], '检查不打开SQLite，未验证搜索缓存内容或新鲜度')
      else if (match) {
        const content = this.reader.readFile(relative)
        if (content !== undefined) this.files.set(relative, content)
      } else if (!future && (entry.name === 'writer.lock' || entry.name === 'acquire.lock' || entry.name === 'finalized-search.worker.lock')) this.issue(relative, '存在运行锁，检查不会回收；请核对在途操作', 'RUNTIME_PENDING')
      else if (!future && (entry.name === 'transactions' || entry.name === 'quarantine')) {
        const contents = this.reader.listDirectory(relative)
        if (contents?.length) this.issue(relative, '存在事务或隔离记录，检查不会恢复或清理', 'RUNTIME_PENDING')
      }
    }
    if (!format.ok) this.issue(paths.契约(), format.reason, format.kind === 'unversioned' ? 'LEGACY_FORMAT' : format.kind === 'unsupported-version' ? 'UNSUPPORTED_SCHEMA' : 'DOCUMENT_INVALID')
    for (const [relative, content] of [...this.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (future) this.unknown(relative, classifyDocumentPath(relative)?.units ?? [], '书仓格式尚未支持，未套用当前领域规则')
      else this.inspectFile(relative, content)
    }
    const memoryHasContent = [...this.files].some(([relative, content]) => {
      if (!relative.startsWith('本书记忆/')) return false
      const parsed = parseDocument(content)
      if (!parsed.ok) return false
      return !MEMORY_KINDS.some(kind => relative === paths.记忆(kind) && !Object.hasOwn(parsed.data.fields, '类') && ['', `# ${kind}`].includes(parsed.data.body.trim()))
    })
    if (!future && !this.files.has(paths.本书记忆索引()) && memoryHasContent) this.issue(paths.本书记忆索引(), '有内容的本书记忆缺少索引', 'REQUIRED_MISSING')
    let gitChanged = false
    if (this.gitRead) {
      let after: OpeningGitState | undefined
      try { after = readOpeningGitState(this.reader) }
      catch (error) { this.issue('.git', error instanceof Error ? error.message : String(error), 'RECEIPT_HISTORY_UNKNOWN') }
      gitChanged = JSON.stringify(this.gitBefore) !== JSON.stringify(after)
      if (after?.head === undefined || gitChanged) this.historyUnknown = true
      if (gitChanged) this.issue('.git', '检查期间 Git 提交或工作树状态已变化，请重新核对归档历史', 'RECEIPT_GIT_CHANGED')
      if (after?.head === undefined || this.gitBefore?.head === undefined || gitChanged) for (const relative of this.receiptPaths) {
        if (!this.unchecked.some(item => item.路径 === relative)) this.unknown(relative, ['I30'], '本次 Git 证据不完整或已变化，归档提交结论未获稳定复验')
      }
    }
    const observed = this.reader.finish()
    const snapshot = this.gitRead ? {
      ...observed,
      指纹: sha(JSON.stringify({ 文件: observed.指纹, Git: this.gitBefore })),
      稳定: observed.稳定 && !this.historyUnknown && !gitChanged,
      变更: [...new Set([...observed.变更, ...(gitChanged ? ['.git'] : [])])],
    } : observed
    const readerFailure = this.historyUnknown || this.issues.some(issue => ['READ_FAILED', 'SNAPSHOT_CHANGED'].includes(issue.代码))
    const invalid = this.issues.some(issue => !['LEGACY_FORMAT', 'LEGACY_SHAPE', 'UNSUPPORTED_SCHEMA', 'UNSUPPORTED_SHAPE'].includes(issue.代码))
    const unsupported = this.unchecked.length > 0 || this.issues.some(issue => issue.代码.startsWith('UNSUPPORTED'))
    const coverage: DocumentTypeCoverage[] = Object.values(DOCUMENT_CONTRACTS).map(item => ({
      编号: item.id, 名称: item.title, 能力: item.id === 'I27' || item.id === 'I32' ? '未支持' : item.id === 'I31' ? '公共语法' : partialUnits.has(item.id) ? '部分结构检查' : '结构检查',
      检查: checks[item.id], 文件数: this.reports.filter(report => report.文档类型.includes(item.id)).length,
    }))
    return {
      状态: readerFailure || unsupported ? '部分失败' : '已检查',
      结论: readerFailure ? '无法核实' : invalid ? '需处理' : unsupported ? '未支持' : this.issues.length ? '需升级' : '未发现已知问题',
      书仓格式: format, 规则版本: BOOK_INSPECTION_RULE_VERSION,
      受检范围: this.reports.map(report => report.文档类型.includes('I30') && report.结果 === '已检查' && this.unchecked.some(item => item.路径 === report.路径) ? { ...report, 结果: '部分检查' } : report),
      未检范围: this.unchecked, 类型覆盖: coverage, 问题: uniqueMaintenanceIssues(this.issues), 快照: snapshot,
    }
  }
}

/** Inspect only: no lock, recovery, migration, cache creation or write authorization. */
export function inspectBookDocuments(bookRoot: string): BookInspection {
  return new Inspector(bookRoot).run()
}

/** Internal maintenance composition: the reader may overlay proposed bytes in memory. */
export function inspectBookDocumentSnapshot(reader: ReadonlyBookSnapshot): BookInspection {
  return new Inspector(reader.root, reader).run()
}
