/**
 * 测试/走查用空壳设计写入器:保留占位确认态和历史模板，验证内容缺失的呈报。
 * 不发明情节，也不代表开写就绪；真实作者流程不得使用。
 */

import { 契约六部, 分卷布局八部, 故事骨架九部 } from '../derive/design'
import { writeFileAtomic } from '../repo/atomic'
import { pad } from '../repo/paths'
import { writeContract } from './contract'
import { planTimelineBody, writePlanTimeline, writeRecentWindow, writeVolumeOutline } from './volume'
import { ensureModulesDeclared, writeEntry } from './worldbook'
import { bookWriter } from '../repo/atomic'

export interface SeedMinDesignInput {
  readonly 卷?: number
  readonly 窗口项?: string
}

function seedMinDesignLocked(bookRoot: string, input: SeedMinDesignInput = {}): void {
  const 卷 = input.卷 ?? 1
  const 窗口项 = input.窗口项 ?? '开篇任务'

  const parts = Object.fromEntries(契约六部.map((n) => [n, { state: '已确认' as const }]))
  writeContract(bookRoot, parts)

  ensureModulesDeclared(bookRoot)
  writeEntry(bookRoot, '人物档案', '主角', {
    类型: '人物',
    性质: '计划',
    状态: '已确认',
    来源: '对谈共创',
  })
  writeEntry(bookRoot, '世界规则', '基础规则', {
    类型: '规则',
    性质: '计划',
    状态: '已确认',
    来源: '对谈共创',
  })

  writeFileAtomic(
    bookRoot,
    '大纲/故事骨架.md',
    ['# 故事骨架', '', ...故事骨架九部.map((n) => `- ${n} 〔已确认〕`), ''].join('\n'),
  )
  // 卷行归属「故事阶段分配」小节(任务21 F21-3):卷分配声明只认该小节;显式行级格式不变。
  writeFileAtomic(
    bookRoot,
    '大纲/分卷布局.md',
    [
      '# 分卷布局',
      '',
      ...分卷布局八部.flatMap((n) => (n === '故事阶段分配' ? [`## ${n} 〔留白〕`, '', `- 卷${pad(卷)} 〔已确认〕`] : [`## ${n} 〔留白〕`])),
      '',
    ].join('\n'),
  )

  writeVolumeOutline(bookRoot, 卷, [
    '# 卷纲',
    '',
    '## 叙事结构 〔已确认〕',
    '',
    `- ${窗口项}：开篇进入本卷叙事窗口`,
    '',
    '## 弧线 〔留白〕',
    '',
    '## 线索推进 〔留白〕',
    '',
    '## 卷末兑现 〔留白〕',
    '',
  ].join('\n'))
  writePlanTimeline(bookRoot, 卷, planTimelineBody({
    windowEvents: [{ 名称: 窗口项, 先后: '最先' }],
    anchors: [{ 名称: '卷末锚点' }],
  }))
  writeRecentWindow(bookRoot, 卷, [{ 名称: 窗口项, 状态: '已确认' }])
}

export const seedMinDesign = bookWriter(seedMinDesignLocked)
