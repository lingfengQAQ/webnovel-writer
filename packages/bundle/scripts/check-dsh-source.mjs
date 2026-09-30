import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { loadSourceHost } from './dsh-source.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageRoot, '../..')
const require = createRequire(path.join(repoRoot, 'package.json'))
const sourcePath = process.argv.slice(2).filter(arg => arg !== '--')[0] ?? process.env.WEBNOVEL_DSH_SOURCE
if (sourcePath === undefined) throw new Error('Usage: pnpm test:dsh-source -- <DSH checkout>')
const host = loadSourceHost(sourcePath)
host.entry('@deepseek-ai/dsh-app-boot')
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-user-questions/types']) {
  if (host.typePaths[name] === undefined) throw new Error(`DSH declarations missing: ${name}`)
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-dsh-types-'))
const config = path.join(temp, 'tsconfig.json')
try {
  for (const name of ['bundle', 'embedding-provider', 'companion']) {
    fs.writeFileSync(config, JSON.stringify({
      extends: path.join(repoRoot, 'packages', name, 'tsconfig.json'),
      compilerOptions: { paths: host.typePaths },
    }, null, 2))
    console.log(`[dsh-source] checking ${name} types against ${host.version} (${host.commit})`)
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config], { cwd: repoRoot, stdio: 'inherit', windowsHide: true })
  }
  console.log('[dsh-source] running the real Loader against the same built checkout')
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  execFileSync(process.execPath, [vitest, 'run', 'packages/bundle/tests/host-loader.spec.ts'], {
    cwd: repoRoot,
    env: { ...process.env, WEBNOVEL_DSH_SOURCE: host.root },
    stdio: 'inherit',
    windowsHide: true,
  })
} finally {
  fs.unlinkSync(config)
  fs.rmdirSync(temp)
}
