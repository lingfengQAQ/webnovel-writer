import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mechanicalCheck } from '../../src/mechanical-check/index.js'
import { repoCtx } from '../commands/_helper.js'

const 文风铁律 = `---
禁词:
  - 眸子一缩
禁句式:
  - '不是.*而是'
---
## 铁律
节奏优先。
`
const 名册 = '| 正名 | 别名 | 类型 | 首现章 |\n|--|--|--|--|\n| 林晚 | 晚晚 | character | 1 |\n'
const 信息差 = '---\n读者已知: false\n登记章: 1\n关键词:\n  - 玉佩\n---\n## 内容\n秘密。\n'

// 组装一个含 front matter + 正文的草稿，并放进受控临时仓库
function files(draftBody, { fm, extra } = {}) {
  const front =
    fm ??
    `章号: 3\n标题: 测试章\n卷: 1\n字数: ${[...draftBody.replace(/\s+/g, '')].length}\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫`
  return {
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n每章目标字数: 50\n',
    '文风/文风铁律.md': 文风铁律,
    '定稿/设定/名册.md': 名册,
    '定稿/设定/信息差/信息差-001-x.md': 信息差,
    '工作区/草稿-A.md': `---\n${front}\n---\n${draftBody}`,
    ...extra,
  }
}

async function run(draftBody, opts) {
  const { ctx, cleanup } = await repoCtx(null, files(draftBody, opts))
  try {
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    const r = await mechanicalCheck(ctx, { chapterNum: 3, draftPath })
    return { r, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

const 正常正文 = '林晚立于大殿之前，握紧手中令牌，暗自下定决心，此番定要查明当年旧案，还师门公道。'

test('机检 正常草稿 → pass=true，无阻断 issue', async () => {
  const { r, cleanup } = await run(正常正文)
  try {
    assert.equal(r.ok, true)
    assert.equal(r.pass, true, `不应有阻断 issue：${JSON.stringify(r.issues)}`)
  } finally {
    await cleanup()
  }
})

test('机检 字数太短 → 阻断 issue（字数）', async () => {
  const { r, cleanup } = await run('林晚。', { fm: '章号: 3\n标题: 测\n卷: 1\n字数: 2\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫' })
  try {
    assert.equal(r.pass, false)
    assert.ok(r.issues.some((i) => i.check === '字数'))
  } finally {
    await cleanup()
  }
})

test('机检 命中禁词 → 阻断 issue（禁词）', async () => {
  const { r, cleanup } = await run(正常正文 + '他眸子一缩，盯着令牌看了又看，心头警兆大作久久难平。')
  try {
    assert.ok(r.issues.some((i) => i.check === '禁词'))
    assert.equal(r.pass, false)
  } finally {
    await cleanup()
  }
})

test('机检 命中禁句式正则 → 阻断 issue（禁句式）', async () => {
  const { r, cleanup } = await run('这把剑不是凡铁而是上古神兵，林晚握着它，只觉一股暖流缓缓涌入四肢百骸之间。')
  try {
    assert.ok(r.issues.some((i) => i.check === '禁句式'))
  } finally {
    await cleanup()
  }
})

test('机检 本章内复读 → 阻断 issue（复读）', async () => {
  const { r, cleanup } = await run('空气仿佛凝固空气仿佛凝固空气仿佛凝固空气仿佛凝固，林晚站在原地一动不动。')
  try {
    assert.ok(r.issues.some((i) => i.check === '复读'))
  } finally {
    await cleanup()
  }
})

test('机检 缺 front matter 字段 → 阻断 issue（front matter）', async () => {
  const { r, cleanup } = await run(正常正文, { fm: '章号: 3\n标题: 测\n卷: 1\n字数: 40\n章定位: 推进' }) // 缺钩子/情绪定位
  try {
    assert.ok(r.issues.some((i) => i.check === 'front matter'))
  } finally {
    await cleanup()
  }
})

test('机检 新专名比名册 → 候选（非阻断）', async () => {
  const { r, cleanup } = await run('赵铁山道：“何人擅闯？”林晚抬眼望去，只见来人一身玄衣气度不凡令人不敢直视。')
  try {
    assert.ok(r.candidates.some((c) => c.type === '新专名' && c.value === '赵铁山'))
    // 新专名非阻断
    assert.ok(!r.issues.some((i) => i.check === '新专名'))
  } finally {
    await cleanup()
  }
})

test('机检 信息差关键词命中 → 候选（非阻断）', async () => {
  const { r, cleanup } = await run('林晚摩挲着那枚玉佩，心中疑云密布，却始终参不透其中藏着的惊天秘密究竟为何。')
  try {
    assert.ok(r.candidates.some((c) => c.type === '信息差候选'))
  } finally {
    await cleanup()
  }
})

// —— 条目变动形式检查（spec 0.9 §8 第 5 步，AC6）——

const 条目 = (状态 = '进行') => `---\n强度: 高\n状态: ${状态}\n开启章: 1\n---\n## 履历\n- 第1章：埋下\n`
const 条目库 = {
  '大纲/伏笔/伏笔-001-旧案.md': 条目('进行'),
  '大纲/伏笔/伏笔-002-旧刀.md': 条目('已收尾'),
}
const declFm = (decl) =>
  `章号: 3\n标题: 测\n卷: 1\n字数: ${[...正常正文.replace(/\s+/g, '')].length}\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n${decl}`
const 条目issues = (r) => r.issues.filter((i) => i.check === '条目变动')

test('机检 条目声明合法（推进进行中 + 埋下新编号）→ 无条目变动 issue', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 推进 伏笔-001\n  - 埋下 伏笔-003'),
    extra: 条目库,
  })
  try {
    assert.equal(r.ok, true)
    assert.deepEqual(条目issues(r), [], JSON.stringify(r.issues))
  } finally {
    await cleanup()
  }
})

test('机检 悬念清单混入伏笔编号 → 阻断（类型一致）', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('悬念:\n  - 推进 伏笔-001'),
    extra: 条目库,
  })
  try {
    assert.equal(r.pass, false)
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('异类编号')))
  } finally {
    await cleanup()
  }
})

test('机检 开启类动词撞已有编号 → 阻断', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 埋下 伏笔-001'),
    extra: 条目库,
  })
  try {
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('已存在')))
  } finally {
    await cleanup()
  }
})

test('机检 推进不存在的编号 → 阻断（疑似笔误）', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 推进 伏笔-099'),
    extra: 条目库,
  })
  try {
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('不存在')))
  } finally {
    await cleanup()
  }
})

test('机检 推进已收尾条目 → 阻断（状态不兼容）', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 推进 伏笔-002'),
    extra: 条目库,
  })
  try {
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('已收尾')))
  } finally {
    await cleanup()
  }
})

test('机检 类型不认识的动词 → 阻断（合法动词提示）', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 揭晓 伏笔-001'), // 揭晓属悬念，伏笔应为回收
    extra: 条目库,
  })
  try {
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('合法动词')))
  } finally {
    await cleanup()
  }
})

test('机检 声明行不合「动词 编号」格式 → 阻断', async () => {
  const { r, cleanup } = await run(正常正文, {
    fm: declFm('伏笔:\n  - 伏笔-001'),
    extra: 条目库,
  })
  try {
    assert.ok(条目issues(r).some((i) => i.blocking && i.description.includes('动词 编号')))
  } finally {
    await cleanup()
  }
})
