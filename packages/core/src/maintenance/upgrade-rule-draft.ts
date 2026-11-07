import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isScalar, parseDocument as parseYaml } from 'yaml'
import { parseDocument } from '../repo/frontmatter'
import { relPathProblem } from '../repo/rel-path'
import { UpgradeRuleError, documentBodyOffset, rawLines, rangeEvidence } from './upgrade-rule-text'
import type { UpgradeChange } from './upgrade-types'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0

export function isUpgradeDraft(relative: string): boolean {
  if (relPathProblem(relative, { strict: true }) !== null) return false
  const match = /^草稿区\/草稿\/卷(\d+)-[^/]+\/稿(\d+)(?:\.md|\.起草中\.txt)$/.exec(relative)
  return !!match && positive(Number(match[1])) && positive(Number(match[2]))
}

/** Only a matching, numbered outline/final supplies a chapter number; draft revisions never do. */
export function planDraftIdentity(relative: string, text: string, files: ReadonlyMap<string, string>): UpgradeChange | undefined {
  if (!isUpgradeDraft(relative)) return undefined
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new UpgradeRuleError(relative, parsed.detail)
  const old = parsed.data.fields['身份']
  if (typeof old !== 'string') return undefined
  const scope = /^卷(\d+)-(.+)$/.exec(path.posix.basename(path.posix.dirname(relative)))!
  const prior = /^卷(\d+)-(.+)$/.exec(old)
  const volume = Number(scope[1]), title = scope[2]!
  if (!prior || Number(prior[1]) !== volume || prior[2] !== title) throw new UpgradeRuleError(relative, '旧草稿身份与目录不一致，不能推断或覆盖身份', undefined, '身份')
  const candidates: { chapter: number; file: string }[] = []
  for (const [file, content] of files) {
    const match = /^(?:定稿\/卷(\d+)|大纲\/卷规划\/卷(\d+)\/章细纲)\/(\d{4,})-(.+)\.md$/.exec(file)
    if (!match || Number(match[1] ?? match[2]) !== volume || match[4] !== title) continue
    const source = parseDocument(content), chapter = Number(match[3])
    if (!positive(chapter) || !source.ok || !source.data.body.trim()) throw new UpgradeRuleError(relative, `章号证据不可读：${file}`)
    const fields = source.data.fields, identity = fields['身份']
    const expected = { 卷: volume, 章: chapter, 章名: title }
    if (fields['状态'] !== (match[1] ? '已定稿' : '已确认')
      || identity !== undefined && (!object(identity) || Object.entries(expected).some(([key, value]) => identity[key] !== value))
      || fields['章号'] !== undefined && fields['章号'] !== chapter) throw new UpgradeRuleError(relative, `章号证据的状态或身份不一致：${file}`)
    candidates.push({ chapter, file })
  }
  if (new Set(candidates.map(item => item.chapter)).size !== 1) throw new UpgradeRuleError(relative, '旧草稿身份缺少唯一的同卷同名确认细纲或定稿章号证据；稿件版本不能当章号', undefined, '身份')
  const identity = { 卷: volume, 章: candidates[0]!.chapter, 章名: title }
  const bodyAt = documentBodyOffset(relative, text), lines = rawLines(text)
  const opening = lines[0]!, closing = lines.find(line => line.end === bodyAt)
  if (!closing || closing === opening) throw new UpgradeRuleError(relative, '旧草稿缺少明确文件头')
  const yaml = parseYaml(text.slice(opening.end, closing.start)), field = yaml.get('身份', true)
  if (yaml.errors.length || !isScalar(field) || !field.range || field.value !== old) throw new UpgradeRuleError(relative, '身份不是唯一可定位的标量')
  const [from, to] = field.range, start = opening.end + from, end = opening.end + to
  if (/[\r\n]/.test(text.slice(start, end))) throw new UpgradeRuleError(relative, '多行旧身份没有无歧义搬位规则')
  const value = `{ 卷: ${volume}, 章: ${identity.章}, 章名: ${JSON.stringify(title)} }`
  const after = text.slice(0, start) + value + text.slice(end)
  const checked = parseDocument(after)
  if (!checked.ok || !isDeepStrictEqual(checked.data.fields, { ...parsed.data.fields, 身份: identity }) || checked.data.body !== parsed.data.body) throw new UpgradeRuleError(relative, '身份转换无法保全其余字段和正文')
  return { relPath: relative, before: text, after, rules: ['C7-v1'], evidence: [
    `旧身份与目录同卷同名；章号来自 ${candidates.map(item => item.file).join('、')}，不使用稿件版本`,
    `${rangeEvidence(text, start, end)}：只替换身份标量，其余原字节保留；草稿不进入Git，完整前后文保留在本地维护收据`,
  ] }
}
