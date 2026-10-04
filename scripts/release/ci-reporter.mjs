import fs from 'node:fs'
import path from 'node:path'
import { BaseSequencer } from 'vitest/node'

/** Persist progress in the parent process, so a crashed worker leaves its last file. */
export default class CiReporter {
  onInit(vitest) {
    this.context = vitest
    this.root = vitest.config.root
    this.file = path.join(this.root, '.tmp/ci/progress.json')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.state = { schemaVersion: 1, node: process.version, platform: process.platform, startedAt: Date.now(), pending: [], active: {}, activeTests: {}, completed: [], errors: [] }
  }
  relative(module) { return path.relative(this.root, module.moduleId).replaceAll('\\', '/') }
  save() { fs.writeFileSync(this.file, JSON.stringify({ ...this.state, updatedAt: Date.now() }, null, 2) + '\n') }
  async onTestRunStart(specifications) {
    // Vitest gives reporters the pre-shard list. Use the same default sequencer.
    const selected = this.context.config.shard ? await new BaseSequencer(this.context).shard(specifications) : specifications
    this.state.pending = selected.map(specification => this.relative(specification))
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
    delete this.state.activeTests[file]
    this.save()
  }
  onTestCaseReady(test) {
    this.state.activeTests[this.relative(test.module)] = test.fullName
    this.save()
  }
  onTestCaseResult(test) {
    delete this.state.activeTests[this.relative(test.module)]
    this.save()
  }
  onTestRunEnd(_modules, errors, reason) {
    // Vitest can say "passed" with an unhandled pool error and still exit nonzero.
    this.state.reason = errors.length ? 'failed' : reason
    this.state.errors = errors.map(error => ({ name: error.name, message: error.message, stack: error.stack }))
    this.save()
  }
}
