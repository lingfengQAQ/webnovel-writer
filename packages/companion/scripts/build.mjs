import { build } from 'esbuild'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
await build({ entryPoints: [path.join(root, 'src/index.ts')], outfile: path.join(root, 'lib/index.js'), bundle: true, format: 'esm', platform: 'node', target: 'node22' })
const result = await build({
  entryPoints: [path.join(root, 'src/client.tsx')], outfile: path.join(root, 'lib/client.js'), bundle: true,
  platform: 'browser', format: 'cjs', target: 'chrome110', external: ['react'], minify: true, metafile: true,
  loader: { '.css': 'text', '.webm': 'dataurl', '.png': 'dataurl' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
for (const output of Object.values(result.metafile.outputs)) {
  for (const entry of output.imports.filter(i => i.external)) {
    if (!manifest.peerDependencies[entry.path]) throw new Error('Undeclared shared dependency: ' + entry.path)
  }
}
for (const input of Object.keys(result.metafile.inputs)) {
  if (/node_modules.*(?:react|cordis)[/\\]/.test(input)) throw new Error('Shared runtime must not be inlined: ' + input)
}
const bytes = statSync(path.join(root, 'lib/client.js')).size
if (bytes > 8 * 1024 * 1024) throw new Error('Companion Client exceeds 8 MiB; optimize media before release')
console.log(`Companion built, including offline media: ${(bytes / 1048576).toFixed(2)} MiB`)
