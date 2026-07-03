import { installWorkdir } from '../installer/index.js'

/**
 * update [--hosts=a,b] [--force]：升级既有工作目录（multi-agent spec §8.2）。
 * 哈希未变的文件直接更新;你改过的提示并跳过（--force 覆盖）;AGENTS.md 只动标记块内。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir'

export async function run(args, options, ctx) {
  const hostsOverride = options.hosts && options.hosts !== true ? options.hosts : null
  const r = await installWorkdir(ctx, { hostsOverride, force: !!options.force })
  return r.ok ? { ok: true, output: r.report } : { ok: false, error: r.error }
}
