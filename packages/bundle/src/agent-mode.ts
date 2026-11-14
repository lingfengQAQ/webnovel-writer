/** A capability owned by one live, isolated preset revision. */
export interface WritingCapability {
  readonly mode: 'writing'
  /** Invalid as soon as teardown begins, before Cordis removes the service slot. */
  readonly disposed?: boolean
}

interface AgentContext {
  readonly ctx?: unknown
}

export interface MainAgentRegistry {
  get(id: string): unknown
  /** rc.1 exposes runtime ownership here; rc.3 uses ordinary live instances. */
  roots?(): readonly unknown[]
}

export function isLiveMainAgent(agent: { readonly id: string; readonly session?: { readonly header?: { readonly origin?: string } } }, registry: MainAgentRegistry): boolean {
  if (registry.get(agent.id) !== agent) return false
  return typeof registry.roots === 'function' ? registry.roots().includes(agent) : agent.session?.header?.origin !== 'subagent'
}

/** Use the live preset binding; titles, cwd, and historical origin are not mode evidence. */
export function writingCapabilityOf(agent: AgentContext | undefined): WritingCapability | undefined {
  try {
    const ctx = agent?.ctx as { get?(name: string): unknown } | undefined
    const registry = ctx?.get?.('agentPresets') as { serviceFor?(agent: AgentContext, name: string): unknown } | undefined
    if (!agent || typeof registry?.serviceFor !== 'function') return undefined
    const capability = registry.serviceFor(agent, 'webnovelWriting')
    return capability !== null && typeof capability === 'object' && 'mode' in capability && capability.mode === 'writing'
      && !('disposed' in capability && capability.disposed === true)
      ? capability as WritingCapability : undefined
  } catch { return undefined }
}

export function isWritingAgent(agent: AgentContext | undefined): boolean {
  return writingCapabilityOf(agent) !== undefined
}
