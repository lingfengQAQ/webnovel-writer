import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NOVEL_TOOL_NAMES, NOVEL_CONDITIONAL_TOOL_NAMES, NOVEL_PRODUCTION_TOOL_NAMES, REFERENCE_TOOL_NAMES } from '../src/tool-catalog'
import { createNovelTools, NOVEL_TEST_TOOL_NAMES } from '../src/novel-tools'

describe('业务与条件委派工具清单', () => {
  it('完整清单包含业务工厂与条件工具，名称唯一且不混入测试工具', () => {
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: () => undefined })
    expect(tools.map(tool => tool.name)).toEqual(NOVEL_TOOL_NAMES)
    expect(NOVEL_TOOL_NAMES).toHaveLength(36)
    expect(NOVEL_CONDITIONAL_TOOL_NAMES).toEqual(['novel_delegate'])
    expect(NOVEL_PRODUCTION_TOOL_NAMES).toHaveLength(37)
    expect(new Set(NOVEL_PRODUCTION_TOOL_NAMES).size).toBe(NOVEL_PRODUCTION_TOOL_NAMES.length)
    for (const name of REFERENCE_TOOL_NAMES) expect(NOVEL_TOOL_NAMES).toContain(name)
    for (const name of NOVEL_TEST_TOOL_NAMES) expect(NOVEL_PRODUCTION_TOOL_NAMES).not.toContain(name)
  })

  it('维护文档列出完整清单，并明确条件注册数量', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../../..', 'docs/tool-catalog.md'), 'utf8')
    const listed = [...doc.matchAll(/^\| `(novel_[a-z_]+)` \|/gm)].map(match => match[1])
    expect(listed.sort()).toEqual([...NOVEL_PRODUCTION_TOOL_NAMES].sort())
    expect(doc).toContain(`${NOVEL_PRODUCTION_TOOL_NAMES.length} 个 Scriptor 工具：${NOVEL_TOOL_NAMES.length} 个业务工具 + ${NOVEL_CONDITIONAL_TOOL_NAMES.length} 个条件委派工具`)
  })
})
