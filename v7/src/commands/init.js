import { installWorkdir } from '../installer/index.js'

/**
 * init [--hosts=a,b] [--force]：一条命令装出工作目录（multi-agent spec §8.1）。
 * 已有安装时等价 update（哈希三态,不静默覆盖手改）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'anywhere'

export async function run(args, options, ctx) {
  const hostsOverride = options.hosts && options.hosts !== true ? options.hosts : null
  const r = await installWorkdir(ctx, { hostsOverride, force: !!options.force })
  return r.ok ? { ok: true, output: r.report } : { ok: false, error: r.error }
}
