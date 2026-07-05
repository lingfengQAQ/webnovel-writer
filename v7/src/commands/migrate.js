import { migrateV6 } from '../migrate/index.js'

export const scope = 'workdir'

/**
 * migrate <v6项目路径> [--dir=<目录名>]
 * v6 书项目一次性迁移成 v7 书仓库（源只读；报告落 工作区/迁移报告.md）。
 */
export async function run(args, options, ctx) {
  const v6Path = args[0]
  if (!v6Path) {
    return { ok: false, error: '用法：migrate <v6项目路径> [--dir=<目录名>]。把路径指向 v6 书项目根目录（含 正文/ 或 .webnovel/）。' }
  }
  return migrateV6(ctx, v6Path, { dir: options.dir })
}
