import { DesignReader } from '../storage/adapters/DesignReader.js'

/** read-design <ID或名称>：精准读取一个计划对象，不扫描式注入全部设计。 */
export async function run(args, options, ctx) {
  const reference = String(args[0] || '').trim()
  if (!reference) return { ok: false, error: '请指定计划对象的 ID 或名称' }
  const result = await new DesignReader(ctx.repoPath).read(reference)
  if (!result.ok) return { ok: false, error: result.error }
  const object = result.data
  return {
    ok: true,
    output: JSON.stringify(
      {
        分类: object.分类,
        ID: object.ID,
        名称: object.名称,
        ...(object.对象类型 ? { 对象类型: object.对象类型 } : {}),
        ...(object.正名 ? { 正名: object.正名 } : {}),
        ...(object.别名.length ? { 别名: object.别名 } : {}),
        计划路径: object.path,
        本书设计: object.sections.get('本书设计'),
        一致性边界: object.sections.get('一致性边界'),
        ...(object.sections.get('知识依据') ? { 知识依据: object.sections.get('知识依据') } : {}),
      },
      null,
      2
    ),
  }
}
