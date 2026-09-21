import fs from 'node:fs'
import path from 'node:path'

// A junction around pnpm's whole node_modules breaks its relative links.
// Resolve each package first; Windows junctions then need no symlink privilege.
export function linkFixtureDependencies(packageRoot, fixtureRoot) {
  const source = path.join(packageRoot, 'node_modules')
  const destination = path.join(fixtureRoot, 'node_modules')
  fs.mkdirSync(destination)
  const link = name => {
    const target = fs.realpathSync.native(path.join(source, name))
    fs.symlinkSync(target, path.join(destination, name), process.platform === 'win32' ? 'junction' : 'dir')
  }
  for (const name of fs.readdirSync(source)) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@')) {
      fs.mkdirSync(path.join(destination, name))
      for (const child of fs.readdirSync(path.join(source, name))) link(path.join(name, child))
    } else link(name)
  }
}
