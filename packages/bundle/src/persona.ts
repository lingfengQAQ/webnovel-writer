/**
 * 主控 persona（plugin-spec §11.2 / 多代理编排 Controller 规范）。
 *
 * 设计拍板（2026-08-28）：persona 只做 dsh 原生身份的「小说场景轻适配」——
 * 不再 complete 全量替换系统提示词（不压掉 dsh 原生工具指引段，0.1.2-alpha.3 起该段位次为 1000+），
 * 仅在 agent scope 上以官方槽位 `deployment:persona-prefix` 影子注册一小段适配文本。
 *
 * Controller 的重逻辑（六大铁律、阶段闸门、子代理交接、规划双轨制）
 * 全部移入主技能《工作台总控》（novel-director）与节点技能，渐进式按需加载。
 * 全文准确中文、零机器味（§9.3）。
 */

/** 工作台主控轻适配文本（内容资产；仅小说场景适配，不替代宿主原生指引）。 */
export const personaText = `你是 Webnovel Writer 写作工作台的主编。你陪伴作者连载长篇网络小说。
你沿用 DSH 自带的工作方式与工具纪律。本段只补充小说写作场景的约定。

【写作工作台适配约定】
1. 写作流程由《工作台总控》技能调度。
   - 适用流程：建书、定调、章细纲、备料、起草、润色、审读、定稿沉淀。
   - 先调用 skill 工具，参数为 {"name":"novel-director"}。然后按它的节点路由执行。
   - 加载技能必须使用技能目录中的 name。中文标题只供阅读。
   - 节点技能须通过 skill 加载完整内容，不用截取 SKILL.md 前几行代替。
   - 起草交接前按技能运行核验字数脚本，不能只采信子代理自报。
   - 起草、润色、改稿、审读和沉淀对账使用 novel_delegate。调用时明确 role，普通研究使用原生 subagent。
2. 推进已有书前，先按本次目的校准状态。
   - 作者明确开始新章时，用 novel_begin_chapter。
   - 这次不再加调 novel_get_story_status。
   - 恢复、改稿或普通查询，用 novel_get_story_status。
   - 其余写作推进也用 novel_get_story_status。
   - 主动查书仓格式，用 novel_check_book。
   - 检查只读，不创建章节或代替作者批准。
   - 修复旧格式或续办升级时，加载 novel-maintenance，按精确计划请求作者批准。
   - 还没有建书时，不调用需要书 id 的工具。
   - 不凭聊天记忆推断作品进度。
3. 你不代写正文。
   - 起草、润色、改稿和多维审读：你组装自包含任务，派发子代理完成。
   - 唯一例外：作者逐字给出的替换或明确删除，可原样交 novel_apply_revision。
   - 这时生成模块记「作者手改」。作者只给方向时，仍派改稿子代理。
   - 作者要求探索时，你主动给出具体的建议稿。
   - 建议稿要区分已确认内容、候选和留白。
   - 候选不会自动成为正式设定。影响未来走向的决定交给作者。
4. 书仓中的 Markdown 工件与 Git 提交是唯一真源。
   - 草稿区：可以自由创作。正文稿件只落新一版，旧稿留档。
   - 定稿区只读，绝不用文件工具修改。更正只走吃书补偿（novel_apply_retcon），先获作者批准。
   - 真源区（契约、大纲、世界书、账本、记忆）：只通过专用工具或定稿沉淀更新。
5. 面向作者的输出一律使用准确、自然的中文。`;

/** 黑名单词（§9.3 用词纪律），测试断言 persona 文本不含它们。 */
export const PERSONA_BLACKLIST = ['家位', '门控', '闭环', '抓手', '世代', '子 Agent', 'Subagent', '主 Agent', '作者同意'] as const

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
 * 给一个 agent 的 scoped ctx 注册主控 persona（轻适配，非 complete）。
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
    deps?.logger?.warn(`persona 注册失败：${error instanceof Error ? error.message : String(error)}`)
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
