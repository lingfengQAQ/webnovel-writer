import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { removeSync } from '../../core/src/repo/remove'
import { linkFixtureDependencies } from '../../bundle/tests/fixtures/fixture-dependencies.mjs'
import { loadSourceHost } from '../../bundle/scripts/dsh-source.mjs'

it('图谱模型使用真实profile和LLM，设置冲突及卸载重装独立于向量', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-graph-settings-')), packageRoot = path.resolve(__dirname, '..')
  try {
    linkFixtureDependencies(packageRoot, root)
    if (process.env.WEBNOVEL_DSH_SOURCE) {
      const host = loadSourceHost(process.env.WEBNOVEL_DSH_SOURCE)
      for (const name of ['cordis', 'dsh-llm']) {
        const file = path.join(root, 'node_modules/@deepseek-ai', name)
        fs.unlinkSync(file); fs.symlinkSync(host.get('@deepseek-ai/' + name).directory, file, 'junction')
      }
    }
    const outfile = path.join(root, 'graph.mjs')
    await build({ entryPoints: [path.join(packageRoot, 'src/graph.ts')], outfile, platform: 'node', format: 'esm', bundle: true, target: 'node22', external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', 'node:*'] })
    const result = await promisify(execFile)(process.execPath, [path.join(packageRoot, 'tests/fixtures/graph-host.mjs'), root, outfile], {
      cwd: root, windowsHide: true, timeout: 25000, env: { ...process.env, DSH_HOME: path.join(root, '.dsh'), DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.stdout).toContain('"independentOfEmbeddings":true')
    expect(result.stdout).toContain('"restoredSettings":true')
    expect(result.stderr).not.toContain('UNHANDLED')
  } finally { removeSync(root) }
}, 30000)
