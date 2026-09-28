/**
 * 事件与恢复(插件规格 §4.1/§8):恢复只从书仓推导，不依赖会话记忆。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { deriveChapterFacts, type ChapterDerivation } from '../derive/derive'
import { listChapters, scanChapter, type ChapterFacts, type ChapterKey } from '../derive/scan'
import { loadMaterialPackage } from '../assembly/read'
import { paths } from '../repo/paths'
import { queryLedger, queryMemory, reconcileLedger, type LedgerQueryResult, type LedgerReconciliationResult, type MemoryQueryResult } from '../ledger'

export interface ResumeSnapshot {
  readonly key: ChapterKey
  readonly facts: ChapterFacts
  readonly derived: ChapterDerivation
  readonly ledger: LedgerQueryResult
  readonly memory: MemoryQueryResult
  readonly reconciliation: LedgerReconciliationResult
  readonly statusCard: string
  readonly injection: {
    readonly 近况: string
    readonly 细纲: string
    readonly 材料段: Readonly<Record<string, string>>
  }
}

function read(root: string, rel: string): string {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return '' }
}

function advice(环节: string): string {
  const map: Partial<Record<string, string>> = {
    '章细纲(待定位)': '先从近期窗口选择或补充本章任务。',
    '章细纲(待确认)': '补全定位段、细纲段并提交作者确认。',
    '写作备料': '组装并检查本章材料包，确认状态为段齐备。',
    '写稿': '只消费已确认细纲与段齐备材料包，生成草稿区草稿。',
    '润色': '运行润色道并完成保真核对。',
    '审核': '执行审核方案，确保每条发现项有处置状态。',
    '改稿': '按审核发现项处置并回查硬约束。',
    '定稿准备与沉淀': '补齐七件待定稿包并呈报卷对账偏离。',
    '作者定稿裁决': '等待作者批准或退回定稿包。',
    '定稿入档': '按清单原子写入并提交 ch:。',
    '完成': '本章已完成，可从近况进入下一章。',
  }
  return map[环节] ?? '按当前节点契约继续。'
}

interface BookStatus {
  readonly ledger: LedgerQueryResult
  readonly memory: MemoryQueryResult
  readonly reconciliation: LedgerReconciliationResult
  readonly lines: readonly string[]
}

function degraded(kind: 'missing' | 'parse-error', available: number): string {
  if (kind === 'parse-error') return available > 0 ? '部分解析失败' : '解析失败'
  return available > 0 ? '部分缺失' : '未初始化'
}

function bookStatus(bookRoot: string, volume: number): BookStatus {
  const ledger = queryLedger(bookRoot)
  const memory = queryMemory(bookRoot)
  const reconciliation = reconcileLedger(bookRoot, volume, ledger)
  const ledgerLine = ledger.ok
    ? `账本：${ledger.entries.length} 条`
    : `账本：${degraded(ledger.kind, ledger.entries.length)}（${ledger.entries.length} 条可用）`
  const memoryLine = memory.ok
    ? `本书记忆：${memory.entries.length} 条`
    : `本书记忆：${degraded(memory.kind, memory.entries.length)}（${memory.entries.length} 条可用）`
  const reconcileLine = reconciliation.ok
    ? `计划对账：${reconciliation.report.状态}（匹配${reconciliation.report.已匹配.length}，待兑现${reconciliation.report.计划未兑现.length}，未计划${reconciliation.report.事实未计划.length}，待核对${reconciliation.report.章级待核对.length + (reconciliation.report.疑似占位待核对?.length ?? 0)}）`
    : `计划对账：${reconciliation.kind === 'missing' ? '数据未初始化' : '解析失败'}`
  return { ledger, memory, reconciliation, lines: [ledgerLine, memoryLine, reconcileLine] }
}

function renderStatusCardFrom(key: ChapterKey, derived: ChapterDerivation, status: BookStatus): string {
  const marker = derived.叠加标记.length === 0 ? '无' : derived.叠加标记.join('、')
  return [
    `近况｜卷${String(key.卷).padStart(2, '0')} 第${String(key.章).padStart(4, '0')}章 ${key.章名}`,
    `建议环节：${derived.建议.环节}（§8 第${derived.建议.row}行；建议仅供参考，判断归主 Agent）`,
    `复核标记：${marker}`,
    ...status.lines,
    `下一步：${advice(derived.建议.环节)}`,
  ].join('\n')
}

export function renderStatusCard(bookRoot: string, key: ChapterKey): string {
  const facts = scanChapter(bookRoot, key)
  const derived = deriveChapterFacts(facts)
  const status = bookStatus(bookRoot, key.卷)
  return renderStatusCardFrom(key, derived, status)
}

function rebuildResumeWithStatus(bookRoot: string, key: ChapterKey, status: BookStatus): ResumeSnapshot {
  const facts = scanChapter(bookRoot, key)
  const derived = deriveChapterFacts(facts)
  const statusCard = renderStatusCardFrom(key, derived, status)
  const confirmedRel = paths.确认细纲(key.卷, key.章, key.章名)
  const 材料段 = loadMaterialPackage(bookRoot, key).段
  return {
    key,
    facts,
    derived,
    ledger: status.ledger,
    memory: status.memory,
    reconciliation: status.reconciliation,
    statusCard,
    injection: { 近况: statusCard, 细纲: read(bookRoot, confirmedRel), 材料段 },
  }
}

export function rebuildResume(bookRoot: string, key: ChapterKey): ResumeSnapshot {
  return rebuildResumeWithStatus(bookRoot, key, bookStatus(bookRoot, key.卷))
}

/** 新会话入口：列出可恢复章节，调用方不需要保存任何会话状态。 */
export function listResumable(bookRoot: string): ReadonlyArray<ResumeSnapshot> {
  const keys = listChapters(bookRoot)
  const statuses = new Map<number, BookStatus>()
  return keys.map((key) => {
    let status = statuses.get(key.卷)
    if (status === undefined) {
      status = bookStatus(bookRoot, key.卷)
      statuses.set(key.卷, status)
    }
    return rebuildResumeWithStatus(bookRoot, key, status)
  })
}
