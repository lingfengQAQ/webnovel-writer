import * as fs from 'node:fs'
import * as path from 'node:path'

/** A real, temporary profile gives ConfigEditor the same ownership as the CLI. */
export function createSettingsProfile(root, rows, appBoot) {
  const home = path.join(root, 'profile-home')
  const dir = path.join(home, 'profiles', 'test')
  appBoot.initProfile(dir, ['webnovel-test-bundle'])
  const bundle = path.join(dir, 'node_modules', 'webnovel-test-bundle')
  fs.mkdirSync(bundle, { recursive: true })
  fs.writeFileSync(path.join(home, 'package.json'), '{"name":"webnovel-test-installation"}\n')
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({
    name: 'webnovel-test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  fs.writeFileSync(path.join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
  const configPath = path.join(dir, 'cordis.yml')
  fs.writeFileSync(configPath, '[]\n')
  const profile = {
    name: 'test', startedBundles: ['webnovel-test-bundle'], dir, patchPath: path.join(dir, 'cordis.patch.yml'),
    installAnchor: path.join(home, 'package.json'), cwd: root, home, overlays: [], telemetryDisabledEnv: '1',
  }
  return {
    profile,
    start: name => appBoot.boot(name, configPath, appBoot.readProfilePatches(name, profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
    }),
  }
}
