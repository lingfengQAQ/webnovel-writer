/** Compose through the same public setup seam used by the real session controller. */
export function createPresetAgent(registry, options, preset = 'scriptor') {
  const { parentAgent: parent, ...creation } = options
  const selected = parent?.ctx.get('agentPresets')?.composedPreset(parent.ctx) ?? preset
  const legacyOwner = typeof registry.roots === 'function'
  // Direct non-driving child specimens remain useful for denial checks. rc.3
  // treats them as unmanaged subagents; worker-policy exercises real Activations.
  return registry.create({ ...creation, ...(legacyOwner && parent ? { parentAgent: parent } : {}),
    meta: { ...options.meta, agentPreset: selected, ...(!legacyOwner && parent ? { origin: 'subagent', parentSession: parent.id } : {}) },
    setup: async ctx => {
      if (parent) ctx.get('agentPresets').composeFrom(ctx, parent.ctx)
      else await ctx.get('agentPresets').mount(ctx, selected)
      return options.setup?.(ctx)
    },
  })
}

export function resumePresetAgent(registry, options, preset = 'scriptor') {
  const { parentAgent: parent, ...resume } = options
  return registry.resume({ ...resume, ...(typeof registry.roots === 'function' && parent ? { parentAgent: parent } : {}), setup: async ctx => {
    if (parent) ctx.get('agentPresets').composeFrom(ctx, parent.ctx)
    else await ctx.get('agentPresets').mount(ctx, preset)
    return options.setup?.(ctx)
  } })
}

export function mainAgents(registry) {
  return typeof registry.roots === 'function' ? registry.roots() : registry.list().filter(agent => agent.session.header.origin !== 'subagent')
}
