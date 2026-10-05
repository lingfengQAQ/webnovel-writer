/**
 * 检查项库注册协议(插件规格 §9)。
 */

import type { ChapterKey, Finding, ChapterLengthCheck } from '@webnovel/core'

export interface CheckInput {
  readonly bookRoot: string
  readonly key: ChapterKey
  readonly 待审稿: string
  readonly 细纲: string
  readonly 审核编号: string
  readonly 材料版本: string
  /** Actual registered package text, including source-labelled supplements. */
  readonly 材料段?: Readonly<Record<string, string>>
  readonly 篇幅核对?: ChapterLengthCheck
}

export interface CheckModule {
  readonly 名称: string
  readonly 审什么: string
  readonly 依赖材料: readonly string[]
  /** 「作者」形态＝作者亲自回写发现项的通道,永不自动跑、不进默认方案、不卡完成态。 */
  readonly 执行形态: '确定性代码' | '隔离子 Agent' | '作者'
  /** 隔离子 Agent 形态时,指向承载人设/做法的 skill 名(§11.1,如 章节结构审读)。 */
  readonly skill?: string
  readonly 适用范围: '章'
  /** 确定性代码形态的实现;隔离子 Agent 形态由主 Agent 编排派发,无 run。 */
  run?(input: CheckInput): Finding[]
}

const registry = new Map<string, CheckModule>()

export function registerCheck(mod: CheckModule): void {
  registry.set(mod.名称, mod)
}

export function getCheck(name: string): CheckModule | undefined {
  return registry.get(name)
}

export function listChecks(): readonly CheckModule[] {
  return [...registry.values()]
}

export function resetChecks(): void {
  registry.clear()
}
