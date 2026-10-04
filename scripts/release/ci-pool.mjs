import fs from 'node:fs'
import path from 'node:path'
import { ForksPoolWorker } from 'vitest/node'

/** Add exit evidence to Vitest's pinned fork implementation without changing it. */
export function diagnosticForks(directory) {
  let sequence = 0
  return {
    name: 'diagnostic-forks',
    createPoolWorker(options) {
      const id = ++sequence
      return new class extends ForksPoolWorker {
        name = 'diagnostic-forks'
        async start() {
          this.plannedStop = false
          await super.start()
          this.on('exit', (code, signal) => {
            fs.mkdirSync(directory, { recursive: true })
            fs.appendFileSync(path.join(directory, 'workers.jsonl'), JSON.stringify({
              worker: id, code, signal: signal ?? null, planned: this.plannedStop, at: Date.now(),
            }) + '\n')
          })
        }
        async stop() { this.plannedStop = true; await super.stop() }
      }(options)
    },
  }
}
