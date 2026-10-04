import { describe, expect, it, vi } from 'vitest'
import { assertObjectJsonSchema, jsonSchemaToTs, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createNovelTools } from '../src/novel-tools'
import { createReferenceTools } from '../src/reference/tools'

const metadata = { title: '测试', author: '作者', edition: '1', acquiredFrom: '自造', allowedUses: '测试', basis: '自造', basisKind: 'user-declaration' }
const reference = { 参考书: 'ref-test', 原文版本: 'r1', 机制: 'm1', 机制版本: 1 }
const valid: Array<[string, Record<string, unknown>]> = [
  ['source', { action: 'preview', filename: '测试.txt', encoding: 'gb18030' }],
  ['source', { action: 'import', filename: '测试.txt', metadata, expectedSourceHash: 'hash' }],
  ['source', { action: 'list' }],
  ['source', { action: 'check', sourceId: 'ref-test' }],
  ['source', { action: 'delete', sourceId: 'ref-test' }],
  ['analyze', { action: 'plan', sourceId: 'ref-test', ranges: 'all' }],
  ['analyze', { action: 'plan', sourceId: 'ref-test', ranges: [{ unitId: 'u1', start: 0, end: 1 }] }],
  ['analyze', { action: 'run', sourceId: 'ref-test', planId: 'p1' }],
  ['analyze', { action: 'run', sourceId: 'ref-test', planId: 'p1', allowProcessing: false }],
  ['analyze', { action: 'status', sourceId: 'ref-test' }],
  ['analyze', { action: 'recover', sourceId: 'ref-test' }],
  ['query', { action: 'search', query: '', tags: ['人物'] }],
  ['query', { action: 'evidence', sourceId: 'ref-test', evidenceId: 'e1', allowInChat: true }],
  ['report', { action: 'build', sourceId: 'ref-test' }],
  ['report', { action: 'save-idea', body: '点子', operationId: 'op1', references: [reference] }],
]

describe('model-facing tool input schemas (#185)', () => {
  it('all novel tools declare an explicit object root', () => {
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: () => undefined, testTools: true })
    expect(tools.length).toBeGreaterThan(4)
    for (const tool of tools) {
      expect(tool.parameters.type, tool.name).toBe('object')
    }
  })

  it('reference tool parameters retain useful PTC argument types', () => {
    for (const tool of createReferenceTools({ workspaceRoot: () => undefined })) {
      expect(() => assertObjectJsonSchema(tool.parameters), tool.name).not.toThrow()
      const rendered = jsonSchemaToTs(tool.parameters)
      expect(rendered, tool.name).not.toBe('unknown')
      expect(rendered, tool.name).toContain('action')
    }
  })

  it.each(valid)('%s accepts existing arguments %j in both schema and execution', async (suffix, args) => {
    const workspaceRoot = vi.fn(() => undefined)
    const tool = createReferenceTools({ workspaceRoot }).find(tool => tool.name === `novel_reference_${suffix}`)!
    assertObjectJsonSchema(tool.parameters)
    expect(validateJsonSchemaValue(tool.parameters, args)).toEqual([])
    // Reaching the workspace check proves argument validation did not reject a valid operation.
    expect(await tool.execute(args)).toMatchObject({ ok: false, code: 'workspace-missing' })
    expect(workspaceRoot).toHaveBeenCalledOnce()
  })

  it.each([
    ['source', { action: 'preview' }],
    ['source', { action: 'preview', filename: '测试.txt', encoding: 'invalid' }],
    ['source', { action: 'import', filename: '测试.txt', metadata }],
    ['source', { action: 'import', filename: '测试.txt', metadata: { ...metadata, basisKind: 'invalid' }, expectedSourceHash: 'hash' }],
    ['source', { action: 'list', filename: '测试.txt' }],
    ['source', { action: 'delete' }],
    ['analyze', { action: 'plan', sourceId: 'ref-test' }],
    ['analyze', { action: 'plan', sourceId: 'ref-test', ranges: [{ unitId: 'u1', start: '0', end: 1 }] }],
    ['analyze', { action: 'run', sourceId: 'ref-test' }],
    ['analyze', { action: 'run', sourceId: 'ref-test', planId: 'p1', allowProcessing: 'true' }],
    ['analyze', { action: 'status', sourceId: 'ref-test', unknown: true }],
    ['query', { action: 'search' }],
    ['query', { action: 'evidence', sourceId: 'ref-test', evidenceId: 'e1', allowInChat: false }],
    ['report', { action: 'save-idea', body: '点子', references: [reference] }],
    ['report', { action: 'save-idea', body: '点子', operationId: 'op1', references: [{ ...reference, 机制版本: '1' }] }],
  ] satisfies Array<[string, Record<string, unknown>]>)('%s rejects invalid action arguments before IO: %j', async (suffix, args) => {
    const workspaceRoot = vi.fn(() => undefined)
    const tool = createReferenceTools({ workspaceRoot }).find(tool => tool.name === `novel_reference_${suffix}`)!
    expect(await tool.execute(args)).toMatchObject({ ok: false, code: 'invalid-args' })
    expect(workspaceRoot).not.toHaveBeenCalled()
  })

  it('rejects unknown actions before IO', async () => {
    const workspaceRoot = vi.fn(() => undefined)
    for (const tool of createReferenceTools({ workspaceRoot })) {
      expect(await tool.execute({ action: 'unknown' })).toMatchObject({ ok: false, code: 'invalid-action' })
    }
    expect(workspaceRoot).not.toHaveBeenCalled()
  })
})
