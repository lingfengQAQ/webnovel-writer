import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { removeSync } from '../../core/src/repo/remove'
import { linkFixtureDependencies } from '../../bundle/tests/fixtures/fixture-dependencies.mjs'

describe('真实 DSH 设置与提供方生命周期', () => {
  it('可保存维度、隔离凭据、热更新配置并保持卸载重装等价', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-embedding-settings-'))
    const packageRoot = path.resolve(__dirname, '..')
    try {
      linkFixtureDependencies(packageRoot, root)
      const outfile = path.join(root, 'embedding.mjs')
      await build({ entryPoints: [path.join(packageRoot, 'src/index.ts')], outfile, platform: 'node', format: 'esm', bundle: true, target: 'node22', external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', 'node:*'] })
      const result = await promisify(execFile)(process.execPath, [path.join(packageRoot, 'tests/fixtures/settings-host.mjs'), root, outfile], {
        cwd: root, windowsHide: true, timeout: 20_000,
        env: { ...process.env, DSH_HOME: path.join(root, '.dsh'), AGENTS_HOME: path.join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
      })
      expect(result.stdout).toContain('"dimensionsRequired":true')
      expect(result.stdout).toContain('"reloadPreservesSettings":true')
      expect(result.stderr).not.toContain('UNHANDLED')
    } finally {
      removeSync(root)
    }
  }, 25_000)
})
