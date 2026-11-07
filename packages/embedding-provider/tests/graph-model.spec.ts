import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { HostGraphProvider } from '../src/graph-model'
import { resolveGraphSettings } from '../src/graph-config'

async function* answer(): AsyncGenerator<StreamChunk> {
  const text = '{"relations":[]}'
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const input = { sourceKind: 'world-append', text: '甲独自读书。'.repeat(11000), fields: {}, entities: [] }

describe('图谱沿用宿主模型设置', () => {
  it('发送完整输入，不向宿主传输出覆盖值', async () => {
    const config = resolveGraphSettings({ enabled: true, provider: 'test', model: 'model', timeoutMs: 1000 })!
    const stream = vi.fn((_options: GenerateOptions) => answer())
    const provider = new HostGraphProvider(config, { stream })
    try {
      await expect(provider.extract(input)).resolves.toMatchObject({ data: { relations: [] } })
      expect(stream).toHaveBeenCalledOnce()
      expect(stream.mock.calls[0]![0]).not.toHaveProperty('maxTokens')
      const content = stream.mock.calls[0]![0].messages[0]!.content[0] as { type: string; text: string }
      expect(content.type).toBe('text')
      expect(JSON.parse(content.text).text).toBe(input.text)
    } finally { await provider.close() }
  })
  it('API异常继续失败，不能把错误当空关系成功', async () => {
    const failure = new Error('fixture api failure')
    const provider = new HostGraphProvider(resolveGraphSettings({ enabled: true, provider: 'test', model: 'model' })!,
      { stream: async function* () { throw failure } })
    try { await expect(provider.extract(input)).rejects.toBe(failure) } finally { await provider.close() }
  })
  it('不配合的模型调用仍受超时和取消控制', async () => {
    const provider = new HostGraphProvider(resolveGraphSettings({ enabled: true, provider: 'test', model: 'model', timeoutMs: 100 })!,
      { stream: async function* () { await new Promise(() => {}) } })
    try {
      await expect(provider.extract(input)).rejects.toMatchObject({ name: 'TimeoutError' })
      const abort = new AbortController(), pending = provider.extract(input, abort.signal)
      abort.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    } finally { await provider.close() }
  })
})
