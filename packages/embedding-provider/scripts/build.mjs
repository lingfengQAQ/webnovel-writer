import { build } from 'esbuild'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeNotices } from '../../../scripts/release/notices.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const hostBuild = await build({
  entryPoints: [path.join(root, 'src/index.ts')], outfile: path.join(root, 'lib/index.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'inline', metafile: true,
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', 'node:*'],
})
const clientBuild = await build({
  entryPoints: [path.join(root, 'src/client.tsx')], outfile: path.join(root, 'lib/client.js'),
  bundle: true, platform: 'browser', format: 'cjs', target: 'chrome110', external: ['react'],
  loader: { '.css': 'text' },
  legalComments: 'inline', metafile: true, minify: true,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
console.log('[embedding-provider] Host plugin and native settings client built')

writeNotices(root, [hostBuild, clientBuild])
