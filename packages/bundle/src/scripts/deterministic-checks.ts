/**
 * 确定性检查脚本的 CLI 逻辑（R21「脚本只算不写」）。
 *
 * 本模块经薄入口 `skills/novel-review/scripts/确定性检查.mjs` 动态引 lib 调用。
 * 只算不写：computeReview 纯算零写盘（R21 落码前 runReview 曾在此直落审核记录，
 * 2026-09-05 真机实锤后拆分）；确定性模块的发现项由主 Agent 经常驻工具
 * novel_record_review_findings 逐模块回写落盘（写入器），本函数只把回写载荷打到 stdout。
 * 函数保持纯函数形态（argv 进、退出码出），模块顶层不得有副作用。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { computeReview, listChecks } from '@webnovel/review'

interface Args {
  readonly book: string
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  readonly 审读材料: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const name = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${token} 缺少值`)
    values.set(name, value)
    i += 1
  }
  const book = values.get('book')?.trim()
  const 章名 = values.get('章名')?.trim()
  const 卷 = Number(values.get('卷'))
  const 章 = Number(values.get('章'))
  if (!book) throw new Error('必须传 --book 书仓路径')
  if (!Number.isInteger(卷) || 卷 <= 0) throw new Error('--卷 必须是正整数')
  if (!Number.isInteger(章) || 章 <= 0) throw new Error('--章 必须是正整数')
  if (!章名) throw new Error('必须传 --章名')
  return { book, 卷, 章, 章名, 审读材料: values.get('审读材料') === 'true' }
}

export function runChecksCli(argv: readonly string[]): number {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(`前置参数错误：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (!fs.existsSync(args.book) || !fs.statSync(args.book).isDirectory()) {
    console.error(`书仓不存在：${path.resolve(args.book)}`)
    return 1
  }
  try {
    const result = computeReview(args.book, { 卷: args.卷, 章: args.章, 章名: args.章名 })
    if (!result.ok || result.record === null || result.正文统计 === undefined) {
      console.error(`确定性检查未运行：${result.reason ?? '未知原因'}`)
      return 1
    }
    const record = result.record
    const counts = Object.entries(record.模块)
      .filter(([, state]) => state.完成 === true)
      .map(([name]) => `${name}:${record.问题.filter((finding) => finding.模块名 === name).length}`)
      .join('、') || '（无）'
    // 回写载荷(R21 只算不写):确定性模块(注册了 run 的)逐模块输出发现项,
    // 每个模块都携带这次实际输入的指纹，主 Agent 原样回写；空发现项也要回写(置完成)。
    const deterministic = new Set(listChecks().filter((c) => c.run !== undefined).map((c) => c.名称))
    const 回写 = [...deterministic].map((模块名) => ({
      模块名,
      审读指纹: record.审读指纹,
      发现项: record.问题.filter((f) => f.模块名 === 模块名),
    }))
    if (args.审读材料) {
      console.log(JSON.stringify({ ok: true, 审读指纹: record.审读指纹, 正文统计: result.正文统计, 篇幅核对: result.篇幅核对, 材料段: result.材料段, 回写载荷: 回写 }, null, 2))
      return 0
    }
    console.log(`确定性检查完成：${counts}`)
    console.log(`模块回写齐全：${record.完成 ? 'true' : 'false'}`)
    console.log(JSON.stringify({ 正文统计: result.正文统计, 篇幅核对: result.篇幅核对 }, null, 2))
    console.log('回写载荷(经 novel_record_review_findings 逐模块回写):')
    console.log(JSON.stringify(回写, null, 2))
    return 0
  } catch (err) {
    console.error(`确定性检查异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
