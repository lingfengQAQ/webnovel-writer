import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createNovelTools } from '../src/novel-tools'
import { nativeWriteStub } from './fixtures/native-write-stub'

const OUTLINE_LINES = ['# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', '探章，单章承接', '', '### 章节功能', '', '- 〔硬〕开场点名主角', '', '### 视角与焦点', '主角视角', '', '### 时空锚定', '城门，清晨', '', '### 起止边界', '抵达到发现', '', '### 故事线与承诺分配', '推进主线', '', '### 信息边界', '只披露所见', '', '### 情绪与节奏目标', '紧张留钩', '', '### 前置条件核对结果', '已核对，无留白', '', '## 细纲段', '', '### 单元 1', '', '- 目标: 开场', '- 人物: 主角', '- 时空: 城门', '- 行动/冲突: 盘问', '- 信息披露: 线索', '- 状态变化: 平静到警觉', '']
const CONCEPT = { 状态: '已确认', 核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x', 核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x' }

describe('工具 output.schema 与真实返回形状一致(dsh 校验器)', () => {
  it('全部工具 schema 在 dsh 支持子集内，实际返回值符合 schema', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'))
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => path.join(ws, '探书'), testTools: true })
    const sc = { agent: { id: 'a', session: { append: () => {} } } }
    const call = (n: string, a: Record<string, unknown>) => tools.find((t) => t.name === n)!.execute(a, sc as never)
    const shapes: Record<string, string[]> = {}
    const captured = new Map<string, unknown[]>()
    const rec = (n: string, v: unknown) => {
      captured.set(n, [...(captured.get(n) ?? []), v])
      const keys = v && typeof v === 'object' ? Object.keys(v as object) : ['<non-object:' + typeof v + '>']
      shapes[n] = Array.from(new Set([...(shapes[n] ?? []), ...keys])).sort()
    }
    const created = await call('novel_create_book', { bookName: '探书', concept: CONCEPT }) as { bookId: string }
    rec('novel_create_book', created)
    const bookId = created.bookId
    for (const [n, a] of [
      ['novel_select_book', { bookId }],
      ['novel_seed_min_design', { bookId }],
      ['novel_get_story_status', { bookId }],
      ['novel_search_finalized', { bookId, query: '林舟' }],
      ['novel_search_finalized', { bookId, query: '' }],
      ['novel_update_contract', { bookId, partName: '题材与读者定位', state: '已确认', content: 'x' }],
      ['novel_update_skeleton', { bookId, 正文: '# 故事骨架\n\n- 第一幕 〔已确认〕\n' }],
      ['novel_roll_window', { bookId, 卷: 1, action: '追加', 名称: '探章' }],
      ['novel_confirm_worldbook_entry', { bookId, 模块: '人物档案', 名称: '甲', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈' }],
      ['novel_get_book_progress', { bookId }],
      ['novel_prepare_pack', { bookId, 卷: 1, 章: 1, 章名: '探章' }],
      ['novel_settle_chapter', { bookId, 卷: 1, 章: 1, 章名: '探章', summary: 'x', 裁决记录: ' ' }],
      ['novel_assemble_materials', { bookId, 卷: 1, 章: 1, 章名: '探章' }],
      ['novel_note_pending', { bookId, 名称: '探留白', 说明: 'x' }],
      ['novel_record_memory', { bookId, 名称: '探记', 描述: 'x', 类: '决策', 标签: ['x'], 来源: '对谈', 正文: 'x' }],
      ['novel_record_review_findings', { bookId, 卷: 1, 章: 1, 章名: '探章', 模块名: '不存在', 发现项: [] }],
      ['novel_new_outline_draft', { bookId, 卷: 1, 章: 1, 章名: '探章', 正文: 'x', 来源引用: ['x@1'] }],
      ['novel_confirm_outline', { bookId, 卷: 1, 章: 1, 章名: '探章' }],
      ['novel_apply_revision', { bookId, 卷: 1, 章: 1, 章名: '探章', 正文: 'x', 依据: 'x' }],
      ['novel_update_volume_layout', { bookId, 正文: '# 分卷布局\n\n- 卷01 〔已确认〕\n' }],
      ['novel_confirm_volume_outline', { bookId, 卷: 1, 正文: '# 卷大纲\n' }],
    ] as Array<[string, Record<string, unknown>]>) {
      try { rec(n, await call(n, a)) } catch (e) { shapes[n] = ['<throw:' + (e as Error).message.slice(0, 40) + '>'] }
    }
    // 成功分支：造齐前置后再跑一轮 outline/pack/settle
    const body = OUTLINE_LINES.join(String.fromCharCode(10))
    rec('novel_new_outline_draft', await call('novel_new_outline_draft', { bookId, 卷: 1, 章: 1, 章名: '探章2', 正文: body, 来源引用: ['作品契约/契约.md@1'] }))
    rec('novel_confirm_outline', await call('novel_confirm_outline', { bookId, 卷: 1, 章: 1, 章名: '探章2' }))
    rec('novel_assemble_materials', await call('novel_assemble_materials', { bookId, 卷: 1, 章: 1, 章名: '探章2' }))
    rec('novel_record_review_findings', await call('novel_record_review_findings', { bookId, 卷: 1, 章: 1, 章名: '探章2', 模块名: '章节结构审读', 发现项: [] }))
    // Use the installed bundle dependency, never an old copy left in the pnpm store.
    // Node avoids Vite's handling of percent-encoded Windows paths here.
    const bundleRequire = createRequire(path.join(repoRoot, 'packages/bundle/package.json'))
    const library = bundleRequire.resolve('@deepseek-ai/dsh-tools')

    const cases = tools.map((t) => ({
      name: t.name,
      schema: (t as { output?: { schema?: unknown } }).output?.schema,
      values: captured.get(t.name) ?? [],
    }))
    const payload = path.join(ws, 'cases.json')
    fs.writeFileSync(payload, JSON.stringify(cases), 'utf-8')
    const script = [
      'const fs = require("node:fs")',
      'const { pathToFileURL } = require("node:url")',
      'const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"))',
      'async function main() {',
      '  const m = await import(pathToFileURL(process.argv[3]).href)',
      '  if (typeof m.validateJsonSchemaValue !== "function") throw new Error("校验器缺席")',
      '  if (typeof m.assertSupportedJsonSchema !== "function") throw new Error("子集断言缺席")',
      '  const out = []',
      '  let checked = 0',
      '  for (const c of cases) {',
      '    if (c.schema === undefined) { out.push(c.name + ": 缺 output.schema"); continue }',
      '    checked++',
      '    try { m.assertSupportedJsonSchema(c.schema) } catch (e) { out.push(c.name + ": schema 越出支持子集 " + e.message) }',
      '    for (const v of c.values) {',
      '      checked++',
      '      const vio = m.validateJsonSchemaValue(c.schema, v)',
      '      if (Array.isArray(vio) && vio.length > 0) out.push(c.name + ": 返回值不合 schema " + vio.join("; "))',
      '    }',
      '  }',
      '  fs.writeFileSync(process.argv[4], JSON.stringify({ checked, out }), "utf-8")',
      '}',
      'main().catch((e) => { console.error(e.message); process.exit(3) })',
    ].join(String.fromCharCode(10))
    const scriptPath = path.join(ws, 'verify.cjs')
    fs.writeFileSync(scriptPath, script, 'utf-8')
    const outPath = path.join(ws, 'out.json')
    const checked = spawnSync(process.execPath, [scriptPath, payload, library, outPath], { encoding: 'utf-8', windowsHide: true })
    expect(checked.status, checked.stderr || checked.stdout).toBe(0)
    const report = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as { checked: number; out: string[] }
    // 防空转：必须真的校验过（20 个 schema + 各自返回值）
    console.log('[schema 校验] 工具数=' + tools.length + ' 校验条数=' + report!.checked + ' 违规=' + report!.out.length)
    expect(report!.checked, '校验条数应覆盖全部工具').toBeGreaterThan(tools.length)
    const failures: string[] = report!.out

    expect(failures, failures.join(String.fromCharCode(10))).toEqual([])
    fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 })
  }, 30_000) // Full tool lifecycle plus Git/Node subprocesses on Windows CI.
})
