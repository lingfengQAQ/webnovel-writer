/** Copy this probe into an isolated profile; it imports no workspace code. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export const name = 'scriptor-package-acceptance'
export const inject = ['agents', 'agentLoop', 'workspaceRegistry', 'skills', 'tools', 'sessionPersistence', 'sessionController']
export async function apply(ctx, config) {
  const report = { installed: config.installed, ok: false }
  const progress = step => { report.step = step; fs.writeFileSync(config.report, JSON.stringify(report, null, 2) + '\n') }
  try {
    progress('workspace')
    const registry = await ctx.workspaceRegistry.create(config.workspace, '插件安装验收')
    progress('agent')
    const sessionId = `packaging-${config.stage}`
    const exists = (await ctx.sessionPersistence.list()).some(item => item.header.id === sessionId)
    const handle = exists ? await ctx.agents.resume({ resumeSessionId: sessionId })
      : await ctx.agents.create({ sessionId, meta: { cwd: config.workspace, title: '插件安装验收' } })
    ctx.on('dispose', () => handle.dispose())
    const agent = handle.agent
    progress('tools and skills')
    const tools = ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('novel_'))
    assert.equal(tools.length, config.installed ? 26 : 0)
    assert.ok(!tools.some(tool => tool.name === 'novel_seed_min_design'), 'production install must not expose the test-only seed')
    const skills = (await ctx.skills.list({ cwd: config.workspace, scope: agent })).filter(skill => skill.provider === 'webnovel-bundled')
    assert.equal(skills.length, config.installed ? 10 : 0)
    report.tools = tools.length
    report.skills = []
    if (config.installed) {
      progress('module identity')
      const hostRequire = createRequire(config.hostAnchor)
      const packedRequire = createRequire(hostRequire.resolve('@linfengqaqtat/dsh-scriptor', { paths: [config.profile] }))
      report.peers = {}
      // React is supplied by the browser module loader, not Node's Host resolver.
      for (const peer of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-skill-filesystem']) {
        const installed = fs.realpathSync(packedRequire.resolve(peer))
        assert.equal(installed, fs.realpathSync(hostRequire.resolve(peer)), `Duplicate shared runtime: ${peer}`)
        report.peers[peer] = 'same host module'
      }
      const packageRoot = path.dirname(packedRequire.resolve('@linfengqaqtat/dsh-scriptor/package.json'))
      for (const summary of skills) {
        const skill = await ctx.skills.get(summary.name, { cwd: config.workspace, scope: agent })
        assert.ok(skill.content.length > 100)
        assert.ok(fs.realpathSync(skill.resourceBase.path).startsWith(fs.realpathSync(path.join(packageRoot, 'skills'))))
        report.skills.push({ name: skill.name, resource: path.relative(packageRoot, skill.resourceBase.path).replaceAll('\\', '/'), chars: skill.content.length })
      }
      const result = await ctx.tools.execute({ agent, name: 'novel_select_book', arguments: { bookId: 'packaging-book' }, signal: new AbortController().signal, callId: 'packaging-select' })
      assert.equal(result.value.ok, true, JSON.stringify(result))
      report.selectBook = true
    }
    progress('source isolation')
    if (config.blockedSource) {
      assert.equal(process.permission?.has('fs.read', config.blockedSource), false)
      assert.throws(() => fs.readFileSync(config.blockedSource), { code: 'ERR_ACCESS_DENIED' })
      report.sourceReadDenied = true
    }
    await ctx.sessionPersistence.flush()
    progress('session attachment')
    await registry.attachSession(agent.id)
    await ctx.sessionController.rename({ sessionId: agent.id, title: '插件安装验收' })
    report.ok = true
  } catch (error) {
    report.error = error.stack ?? String(error)
    throw error
  } finally {
    fs.writeFileSync(config.report, JSON.stringify(report, null, 2) + '\n')
  }
}
