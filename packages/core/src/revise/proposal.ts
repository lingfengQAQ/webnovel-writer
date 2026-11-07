/**
 * 提案与补偿事件留痕（S4，story-repo-spec §9.5）。
 *
 * 逆流的法定容器：任何节点发现缺口或漂移 → 登记提案 → 影响分析（脚本）→ 作者裁决 →
 * 未定稿下游同批整改（整批 design:）／已定稿下游走吃书补偿（retcon:）。
 * 文件＝作者裁决材料，Markdown＋frontmatter（文件即真相）；登记是 acquisition，不挂审批。
 * 裁决记录回写只动 frontmatter `状态` 与「裁决记录」节，其余一字不动。
 */

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { writeFileAtomic } from '../repo/atomic'
import { bookWriter } from '../repo/atomic'

export type 提案域 = '内容修订' | '吃书补偿'
export type 提案类型 = '补充设计' | '修改计划' | '事实更正' | '吃书'
export type 提案状态 = '待裁决' | '已通过' | '已驳回'

export interface ProposalInput {
  readonly 域: 提案域
  readonly 类型: 提案类型
  /** 提案内容正文（改什么、为什么、影响面摘要）。 */
  readonly 内容: string
  /** 来源（如「第3章审核发现项 2 条」「作者对话指示」）。 */
  readonly 来源: string
  /** 影响分析脚本的输出摘要（可选，登记后也可补）。 */
  readonly 影响分析?: string
  readonly 关联发现项?: readonly { readonly 卷: number; readonly 章: number; readonly 章名: string; readonly 发现项编号: string }[]
}

function 提案目录(bookRoot: string): string {
  return nodePath.join(bookRoot, '草稿区', '提案')
}

/**
 * 统一编号池（F2 修复，2026-09-05）：普通提案（`NNNN-*.md`）与补偿事件（`补偿-NNNN.md`，
 * 含旧位置 `草稿区/提案/补偿-NNNN.md` 与新位置 `定稿/卷NN/补偿/补偿-NNNN.md`）共用一个
 * 单调序列——此前补偿文件不占号，连续两次补偿会生成同名文件并覆盖旧记录。
 * 取全池最大值+1；调用方写入前仍有存在性递增兜底。
 */
export function nextProposalNumber(bookRoot: string): number {
  let max = 0
  const scan = (dir: string): void => {
    try {
      for (const f of fs.readdirSync(dir)) {
        const m1 = /^(\d{4})-/.exec(f)
        if (m1 !== null) { max = Math.max(max, Number(m1[1]!)); continue }
        const m2 = /^补偿-(\d{4})\.md$/.exec(f)
        if (m2 !== null) max = Math.max(max, Number(m2[1]!))
      }
    } catch { /* 目录不存在＝无提案 */ }
  }
  scan(提案目录(bookRoot))
  // 补偿事件的新家:定稿/卷NN/补偿/(受跟踪,随 retcon: 提交留痕)
  const 定稿目录 = nodePath.join(bookRoot, '定稿')
  let 卷s: string[] = []
  try { 卷s = fs.readdirSync(定稿目录) } catch { /* 无定稿目录 */ }
  for (const vol of 卷s) {
    if (!/^卷\d+$/.test(vol)) continue
    let names: string[] = []
    try { names = fs.readdirSync(nodePath.join(定稿目录, vol, '补偿')) } catch { continue }
    for (const f of names) {
      const m = /^补偿-(\d{4})\.md$/.exec(f)
      if (m !== null) max = Math.max(max, Number(m[1]!))
    }
  }
  return max + 1
}

/** 编号对应的补偿事件落点(F3 移址):定稿/卷<NN>/补偿/补偿-<NNNN>.md(受跟踪路径)。 */
function 补偿事件相对路径(卷: number, 编号: string): string {
  return `定稿/卷${String(卷).padStart(2, '0')}/补偿/补偿-${编号}.md`
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/** 登记提案（acquisition，不挂审批）。返回编号与相对路径。 */
function registerProposalLocked(
  bookRoot: string,
  input: ProposalInput,
): { readonly ok: true; readonly 编号: string; readonly relPath: string } {
  if (input.关联发现项 !== undefined && (!Array.isArray(input.关联发现项) || input.关联发现项.some(item => item === null || typeof item !== 'object'
    || !Number.isSafeInteger(item.卷) || item.卷 < 1 || !Number.isSafeInteger(item.章) || item.章 < 1
    || typeof item.章名 !== 'string' || !item.章名.trim() || typeof item.发现项编号 !== 'string' || !item.发现项编号.trim()))) {
    throw new Error('关联发现项必须包含有效的卷、章、章名和发现项编号')
  }
  const num = nextProposalNumber(bookRoot)
  const 编号 = pad4(num)
  const relPath = `草稿区/提案/${编号}-${input.类型}.md`
  const fields = {
    编号,
    域: input.域,
    类型: input.类型,
    状态: '待裁决' as 提案状态,
    来源: input.来源,
    ...(input.关联发现项 === undefined ? {} : { 关联发现项: input.关联发现项 }),
  }
  const body = [
    input.内容.trim(),
    '',
    '## 影响分析',
    '',
    input.影响分析?.trim() || '（待补：跑影响分析脚本后粘贴）',
    '',
    '## 裁决记录',
    '',
    '（待作者裁决）',
    '',
  ].join('\n')
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, body))
  return { ok: true, 编号, relPath }
}

export const registerProposal = bookWriter(registerProposalLocked)

/** 读回提案（解析失败如实报）。 */
export function loadProposal(
  bookRoot: string,
  编号: string,
): { readonly ok: true; readonly text: string; readonly relPath: string } | { readonly ok: false; readonly reason: string } {
  try {
    const matches = fs.readdirSync(提案目录(bookRoot)).filter(f => f.startsWith(`${编号}-`) && f.endsWith('.md'))
    if (matches.length === 0) return { ok: false, reason: `提案不存在：${编号}` }
    if (matches.length !== 1) return { ok: false, reason: `提案编号存在多份文件：${编号}。请作者核对，不能任选一份` }
    const file = matches[0]!
    return { ok: true, text: fs.readFileSync(nodePath.join(提案目录(bookRoot), file), 'utf-8'), relPath: `草稿区/提案/${file}` }
  } catch {
    return { ok: false, reason: `提案不存在：${编号}` }
  }
}

/** 裁决回写：只改 frontmatter `状态` 与「裁决记录」节；其余一字不动。 */
function resolveProposalLocked(
  bookRoot: string,
  编号: string,
  决定: '通过' | '驳回',
  裁决记录: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const loaded = loadProposal(bookRoot, 编号)
  if (!loaded.ok) return loaded
  const doc = parseDocument(loaded.text)
  if (!doc.ok) return { ok: false, reason: `提案解析失败：${doc.detail}` }
  if (doc.data.fields['状态'] !== '待裁决') {
    return { ok: false, reason: `提案 ${编号} 已裁决（状态：${doc.data.fields['状态']}），不重复回写` }
  }
  if (裁决记录.trim() === '') return { ok: false, reason: '裁决记录为空——作者决定须留痕' }
  const fields = { ...doc.data.fields, 状态: (决定 === '通过' ? '已通过' : '已驳回') as 提案状态 }
  const body = doc.data.body.replace('（待作者裁决）', `【${决定}】${裁决记录.trim()}`)
  writeFileAtomic(bookRoot, loaded.relPath, serializeDocument(fields, body))
  return { ok: true }
}

export const resolveProposal = bookWriter(resolveProposalLocked)

export interface RetconEventInput {
  readonly 提案编号?: string
  readonly 受影响工件: readonly string[]
  readonly 账本留痕: string
  readonly 摘要: string
  /** 受影响定稿章所在卷——决定补偿事件记录的落点(定稿/卷NN/补偿/)。 */
  readonly 卷: number
}

export interface RetconEventOp {
  /** 补偿事件记录的受跟踪相对路径(定稿/卷<NN>/补偿/补偿-<NNNN>.md)。 */
  readonly relPath: string
  readonly content: string
}

/**
 * 构建补偿事件记录（F3）：只构建不写盘——调用方把它并入 `archiveRetcon` 的 `files`，
 * 与本次 retcon 的其他文件**同一提交**留痕（此前「提交后另写草稿区」留下
 * 「正文已改但留痕未提交」的假完成窗口，2026-09-05 修复）。
 * 编号取统一编号池，并对目标路径做存在性递增兜底（不允许静默覆盖）。
 */
export function retconEventOps(
  bookRoot: string,
  input: RetconEventInput,
): RetconEventOp {
  let num = nextProposalNumber(bookRoot)
  // 存在性兜底:统一池正常已唯一,若路径仍被占用则递增直至空位
  let relPath = 补偿事件相对路径(input.卷, pad4(num))
  while (fs.existsSync(nodePath.join(bookRoot, relPath))) {
    num += 1
    relPath = 补偿事件相对路径(input.卷, pad4(num))
  }
  const fields = {
    关联提案: input.提案编号 ?? '（未登记提案）',
    受影响工件: [...input.受影响工件],
    日期: new Date().toISOString(),
  }
  const body = ['# 补偿事件记录', '', input.摘要.trim(), '', '## 账本留痕', '', input.账本留痕.trim(), ''].join('\n')
  return { relPath, content: serializeDocument(fields, body) }
}

/**
 * @deprecated 直接写盘版本（F3 前旧路径，落 草稿区 且不随 retcon 提交）。
 * 改用 `retconEventOps` 并入 archiveRetcon 的 files 同提交留痕。
 */
function recordRetconEventLocked(
  bookRoot: string,
  input: Omit<RetconEventInput, '卷'>,
): { readonly ok: true; readonly relPath: string } {
  const num = nextProposalNumber(bookRoot)
  const 编号 = pad4(num)
  const relPath = `草稿区/提案/补偿-${编号}.md`
  const fields = {
    关联提案: input.提案编号 ?? '（未登记提案）',
    受影响工件: [...input.受影响工件],
    日期: new Date().toISOString(),
  }
  const body = ['# 补偿事件记录', '', input.摘要.trim(), '', '## 账本留痕', '', input.账本留痕.trim(), ''].join('\n')
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, body))
  return { ok: true, relPath }
}

export const recordRetconEvent = bookWriter(recordRetconEventLocked)
