import { describe, expect, it } from 'vitest'
import { personaText, registerPersona, attachPersonaToAgent, PERSONA_BLACKLIST } from '../src/persona'

describe('persona 轻适配内容（只做 dsh 原生身份的小说场景适配）', () => {
  it('覆盖身份/主技能指向/状态校准/创作分工/真源纪律', () => {
    expect(personaText).toContain('Webnovel Writer 写作工作台')
    expect(personaText).toContain('工作台总控')
    expect(personaText).toContain('skill 工具，参数为 {"name":"novel-director"}')
    expect(personaText).toContain('作者明确开始新章时，用 novel_begin_chapter')
    expect(personaText).toContain('这次不再加调 novel_get_story_status')
    expect(personaText).toContain('恢复、改稿或普通查询，用 novel_get_story_status')
    expect(personaText).toContain('主动查书仓格式，用 novel_check_book')
    expect(personaText).toContain('子代理') // 创作分工
    expect(personaText).toContain('建议稿') // 规划提案
    expect(personaText).toContain('草稿区')
    expect(personaText).toContain('定稿区只读')
  })

  it('轻量：不内置完整工具指引与节点 SOP（已移入主技能与节点技能）', () => {
    expect(personaText).not.toContain('六大铁律')
    expect(personaText).not.toContain('材料包')
    expect(personaText.length).toBeLessThan(1200)
  })

  it('不含 §9.3 黑名单词', () => {
    for (const w of PERSONA_BLACKLIST) {
      expect(personaText).not.toContain(w)
    }
  })
})

describe('persona 注册（轻适配：不 complete，保留 dsh 原生指引段）', () => {
  it('用官方槽位 deployment:persona-prefix，order:0，无 complete', () => {
    let registered: unknown = null
    const sys = {
      section: (s: unknown) => { registered = s },
    }
    const ok = registerPersona(sys)
    expect(ok).toBe(true)
    expect(registered).toMatchObject({
      name: 'deployment:persona-prefix',
      order: 0,
    })
    expect((registered as { complete?: boolean }).complete).toBeUndefined()
  })

  it('attachPersonaToAgent：经 agent.ctx.inject 的 scoped 注册（非全局）', () => {
    let registered: unknown = null
    const fakeCtx = {
      systemPrompt: { section: (s: unknown) => { registered = s } },
      inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(fakeCtx); return undefined },
    }
    const undo = attachPersonaToAgent(fakeCtx as never)
    expect(typeof undo, '交回注销函数（审计 B2）').toBe('function')
    expect(registered as { name?: string; complete?: boolean } | null).toMatchObject({ name: 'deployment:persona-prefix' })
    expect((registered as { complete?: boolean } | null)?.complete).toBeUndefined()
  })

  it('attachPersonaToAgent 缺 inject 面 fail-open', () => {
    expect(attachPersonaToAgent({ systemPrompt: {} as never } as never)).toBeUndefined()
    expect(attachPersonaToAgent(undefined)).toBeUndefined()
  })

  it('可注入自定义文本', () => {
    let got: string | null = null
    const sys = { section: (s: { text?: string }) => { got = (s.text as string | undefined) ?? null } }
    registerPersona(sys, '自定义身份文本')
    expect(got).toBe('自定义身份文本')
  })

  it('无 systemPrompt 表面 fail-open 不抛', () => {
    expect(registerPersona(undefined)).toBe(false)
  })
})

describe('persona 句长（STE）', () => {
  it('每个编号条目不超过 2 句，每句不超过 50 字', () => {
    const items = personaText.split('\n').filter((line) => /^\d+\. /.test(line))
    expect(items.length).toBe(5)
    for (const item of items) {
      const sentences = item.replace(/^\d+\. /, '').split(/[。！？]/).map((s) => s.trim()).filter(Boolean)
      expect(sentences.length).toBeLessThanOrEqual(2)
      for (const sentence of sentences) expect([...sentence].length).toBeLessThanOrEqual(50)
    }
    for (const line of personaText.split('\n')) {
      for (const sentence of line.split(/[。！？]/)) expect([...sentence.trim()].length).toBeLessThanOrEqual(50)
    }
  })
})

