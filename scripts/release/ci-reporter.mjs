import fs from 'node:fs'
import path from 'node:path'

/** Persist progress in the parent process, so a crashed worker leaves its last file. */
export default class CiReporter {
  onInit(vitest) {
    this.root = vitest.config.root
    this.file = path.join(this.root, '.tmp/ci/progress.json')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.state = { schemaVersion: 1, node: process.version, platform: process.platform, startedAt: Date.now(), pending: [], active: {}, completed: [], errors: [] }
  }
  relative(module) { return path.relative(this.root, module.moduleId).replaceAll('\\', '/') }
  save() { fs.writeFileSync(this.file, JSON.stringify({ ...this.state, updatedAt: Date.now() }, null, 2) + '\n') }
  onTestRunStart(specifications) {
    this.state.pending = specifications.map(specification => this.relative(specification))
    this.save()
  }
  onTestModuleStart(module) {
    const file = this.relative(module)
    this.state.pending = this.state.pending.filter(item => item !== file)
    this.state.active[file] = Date.now()
    this.save()
  }
  onTestModuleEnd(module) {
    const file = this.relative(module)
    const started = this.state.active[file]
    this.state.pending = this.state.pending.filter(item => item !== file)
    this.state.completed.push({ file, durationMs: started === undefined ? 0 : Date.now() - started })
    delete this.state.active[file]
    this.save()
  }
  onTestRunEnd(_modules, errors, reason) {
    this.state.reason = reason
    this.state.errors = errors.map(error => ({ name: error.name, message: error.message, stack: error.stack }))
    this.save()
  }
}
