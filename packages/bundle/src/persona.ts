/**
 * 主 Agent persona（plugin-spec §11.2 / 多代理编排 Controller 规范）。
 *
 * 设计拍板（2026-08-28）：persona 只做 dsh 原生身份的「小说场景轻适配」——
 * 不再 complete 全量替换系统提示词（不压掉 dsh 原生工具指引段，0.1.2-alpha.3 起该段位次为 1000+），
 * 仅在 agent scope 上以官方槽位 `deployment:persona-prefix` 影子注册一小段适配文本。
 *
 * Controller 的重逻辑（六大铁律、阶段闸门、子代理交接、规划双轨制）
 * 全部移入主技能《工作台总控》（novel-director）与节点技能，渐进式按需加载。
 * 全文准确中文、零机器味（§9.3）。
 */

/** 工作台主 Agent 轻适配文本（内容资产；仅小说场景适配，不替代宿主原生指引）。 */
export const personaText = `你是 Webnovel Writer 写作工作台的主编，正陪伴作者进行长篇网络小说的连载创作。
你沿用宿主自带的工作方式与工具纪律；在此之上，本段只做小说写作场景的适配约定：

【写作工作台适配约定】
1. 业务调度以《工作台总控》技能为准：涉及建书、作品定调、章细纲、写作备料、起草、润色、审读、定稿沉淀等写作流程时，先加载该技能，按其节点路由执行。
2. 状态校准：推进已有目标书的写作阶段之前，先调用 novel_get_story_status 查询书仓近况；未建书的灵感讨论不调用要求书id的工具，不凭聊天记忆猜测作品进度。
3. 创作分工：你不代写正文；正文起草与多维审读由你组装自包含任务后派发子代理完成。作者要求探索时主动提出具体建议稿，区分已确认内容、候选与留白；候选不自动成为正式设定，影响未来走向的决定交作者。
4. 真源纪律：书仓中的 Markdown 工件与 Git 提交是唯一真源；草稿区自由创作，定稿区只读绝不改，真源区（契约、大纲、世界书、账本、记忆）只经专用工具或定稿沉淀更新。
5. 面向作者的输出一律使用准确、自然的中文。`;

/** 黑名单词（§9.3 用词纪律），测试断言 persona 文本不含它们。 */
export const PERSONA_BLACKLIST = ['家位', '门控', '闭环', '抓手', '世代'] as const

/**
 * dsh 官方 persona 具名槽位。取宿主导出的常量，不再自行重声明字面量
 * ——审计甲类：宿主已给的东西不重建，槽名对不上就是影子替换失败变重复注册。
 */
export { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

/**
 * dsh `systemPrompt` 服务的窄声明（仅 section 消费面；与 status-context 的 context 同法）。
 *
 * `getSectionOrder` 是 0.1.2-alpha.3 新增的中央位次分配：位次常量此版整体重排过
 * （harness identity -100→-1000、工具指引段 100–199→1000+），硬编码数字会随下次
 * 重排静默跑位。可选是因为窄面还要吃得下测试桩。
 */
export interface SystemPromptSectionLike {
  section(section: {
    readonly name: string
    readonly order: number
    readonly complete?: boolean
    readonly text: string | ((assemble: unknown) => string)
  }): () => void
  getSectionOrder?(name: 'DEPLOYMENT_PERSONA_PREFIX'): number
}

/** persona 槽位次：优先问宿主要，拿不到才回落到该槽的历史值 0。 */
function personaOrder(sys: SystemPromptSectionLike): number {
  return typeof sys.getSectionOrder === 'function' ? sys.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') : 0
}

/**
 * agent.ctx 的窄面（scoped 注册：inject 到该 agent 的 scope 层，与官方 file-reference-local 同法）。
 *
 * inject 的返回按 cordis 真类型是 `Fiber & PromiseLike<Fiber>`（registry.d.ts:111），
 * 其 `dispose: () => Promise<void>`（fiber.d.ts:112）。这里只窄取 dispose 一项。
 */
export interface InjectFiberLike {
  readonly dispose?: () => unknown
}

export interface AgentCtxLike {
  readonly systemPrompt?: SystemPromptSectionLike
  readonly inject?: (deps: readonly string[], setup: (scope: unknown) => void) => InjectFiberLike | undefined
  readonly logger?: { readonly warn: (msg: string) => void }
}

/**
 * 给一个 agent 的 scoped ctx 注册主 Agent persona（轻适配，非 complete）。
 * 用官方槽位 `deployment:persona-prefix` + agent.ctx scoped 注册：只在该 agent 的 scope
 * 内影子替换部署级 persona，dsh 原生工具指引段与其余 agent 不受影响。
 *
 * 交回注销函数（审计 B2）：要交回的是两样东西，原先都被丢弃 ——
 * 1. `sys.section()` 回的注销函数：不交回则 bundle 卸载后影子 persona 仍留在该
 *    agent 的 scope 上，重装即叠加；
 * 2. `agentCtx.inject()` 回的 Fiber：那是 fork 出来的子 scope，不 dispose 则
 *    scope 本身连同其依赖订阅跨卸载存活（status-context 一直是 dispose fiber 的，
 *    此处与之对齐，两样一并交回）。
 * 无 systemPrompt 表面时 fail-open 返回 undefined（不抛）。
 */
export function attachPersonaToAgent(
  agentCtx: AgentCtxLike | undefined,
  text: string = personaText,
  deps?: { readonly logger?: { readonly warn: (msg: string) => void } },
): (() => void | Promise<void>) | undefined {
  if (agentCtx === undefined) return undefined
  if (typeof agentCtx.inject !== 'function') return undefined
  try {
    let off: (() => void) | undefined
    const fiber = agentCtx.inject(['systemPrompt'], (scope) => {
      const sys = (scope as AgentCtxLike).systemPrompt
      if (sys === undefined || typeof sys.section !== 'function') return
      const undo = sys.section({
        name: PERSONA_PREFIX_SECTION,
        order: personaOrder(sys),
        text,
      })
      if (typeof undo === 'function') off = undo
    })
    return async () => {
      off?.()
      if (typeof fiber?.dispose === 'function') await fiber.dispose()
    }
  } catch (error) {
    deps?.logger?.warn(`persona 注册失败:${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** 兼容旧名：注册（不推荐全局，见 attachPersonaToAgent）；保留供旧 smoke 断言。 */
export function registerPersona(systemPrompt: SystemPromptSectionLike | undefined, text: string = personaText): boolean {
  if (systemPrompt === undefined) return false
  try {
    systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: personaOrder(systemPrompt), text })
    return true
  } catch {
    return false
  }
}
