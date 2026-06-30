import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { CacheManager } from '../../src/cache/index.js'

// 在临时目录构造一个最小书仓库，files 是 { 相对路径: 内容 }
async function makeRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wnw-rebuild-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
  return root
}

const 名册仅林晚 =
  '| 正名 | 别名 | 类型 | 首现章 |\n|------|------|------|--------|\n| 林晚 | 晚晚 | character | 1 |\n'

test('角色卡不在名册里也必须入 entities（upsert，不丢数据）', async () => {
  const root = await makeRepo({
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    '定稿/设定/名册.md': 名册仅林晚,
    '定稿/设定/角色/独行客.md':
      '---\n姓名: 独行客\n状态: 在世\n位置: 荒原\n境界: 元婴\n最后变更章: 5\n---\n## 设定\n来历不明。\n',
  })
  const cache = new CacheManager(path.join(root, '.cache', 'index.db'))
  try {
    await cache.ensureReady(root)
    const rows = await cache.query('SELECT * FROM entities WHERE id = ?', ['独行客'])
    assert.equal(rows.length, 1, '独行客有角色卡但不在名册，必须 upsert 入 entities，不能丢')
    assert.equal(rows[0].status, '在世')
    assert.equal(rows[0].realm, '元婴')
  } finally {
    await cache.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('名册中的角色被角色卡补全字段（upsert 走 UPDATE 分支）', async () => {
  const root = await makeRepo({
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    '定稿/设定/名册.md': 名册仅林晚,
    '定稿/设定/角色/林晚.md':
      '---\n姓名: 林晚\n状态: 在世\n位置: 青云宗\n境界: 练气三层\n最后变更章: 1\n---\n## 设定\n外门弟子。\n',
  })
  const cache = new CacheManager(path.join(root, '.cache', 'index.db'))
  try {
    await cache.ensureReady(root)
    const rows = await cache.query('SELECT * FROM entities WHERE id = ?', ['林晚'])
    assert.equal(rows.length, 1, '林晚不应因 upsert 而重复')
    assert.equal(rows[0].realm, '练气三层', '角色卡的境界应补进名册建立的行')
  } finally {
    await cache.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('履历引用不存在的章节 → 记 warning，不阻断重建（AC10）', async () => {
  const root = await makeRepo({
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    '定稿/设定/名册.md': 名册仅林晚,
    '定稿/正文/0001-开局.md': '---\n章号: 1\n标题: 开局\n卷: 1\n字数: 100\n章定位: 推进\n---\n正文。',
    '大纲/伏笔/伏笔-001-test.md':
      '---\n强度: 高\n状态: 进行\n开启章: 1\n---\n## 履历\n- 第999章：推进——引用不存在的章\n',
  })
  const cache = new CacheManager(path.join(root, '.cache', 'index.db'))
  try {
    const result = await cache.rebuildFromSource(root)
    assert.equal(result.ok, true, '履历章节不存在只警告，不阻断')
    assert.ok(
      result.warnings.some((w) => w.includes('999')),
      `应有引用 999 章的 warning，实际：${JSON.stringify(result.warnings)}`
    )
  } finally {
    await cache.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('别名冲突 → 报 error 并拒绝重建（AC10）', async () => {
  const root = await makeRepo({
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    // 「影」同时是林晚和神秘老者的别名 → 冲突
    '定稿/设定/名册.md':
      '| 正名 | 别名 | 类型 | 首现章 |\n|------|------|------|--------|\n' +
      '| 林晚 | 影 | character | 1 |\n| 神秘老者 | 影 | character | 1 |\n',
  })
  const cache = new CacheManager(path.join(root, '.cache', 'index.db'))
  try {
    const result = await cache.rebuildFromSource(root)
    assert.equal(result.ok, false, '别名冲突必须拒绝重建')
    assert.ok(
      result.errors.some((e) => e.includes('影')),
      `应有别名冲突 error，实际：${JSON.stringify(result.errors)}`
    )
  } finally {
    await cache.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('别名冲突 → ROLLBACK 不留半库（P1-1：已写 chapters 也回滚）', async () => {
  const root = await makeRepo({
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    '定稿/正文/0001-开局.md': '---\n章号: 1\n标题: 开局\n卷: 1\n字数: 100\n章定位: 推进\n---\n正文。',
    '定稿/正文/0002-承接.md': '---\n章号: 2\n标题: 承接\n卷: 1\n字数: 100\n章定位: 推进\n---\n正文。',
    // 别名冲突：scanEntities 在 chapters/threads/secrets 已 INSERT 后才返回失败
    '定稿/设定/名册.md':
      '| 正名 | 别名 | 类型 | 首现章 |\n|------|------|------|--------|\n' +
      '| 林晚 | 影 | character | 1 |\n| 老者 | 影 | character | 1 |\n',
  })
  const cache = new CacheManager(path.join(root, '.cache', 'index.db'))
  try {
    const result = await cache.rebuildFromSource(root)
    assert.equal(result.ok, false, '别名冲突应拒绝重建')
    // 事务回滚：chapters 不应残留半填数据
    const ch = await cache.query('SELECT COUNT(*) AS c FROM chapters')
    assert.equal(ch[0].c, 0, '别名冲突应 ROLLBACK，chapters 不留半填数据')
    const th = await cache.query('SELECT COUNT(*) AS c FROM threads')
    assert.equal(th[0].c, 0, 'threads 同样回滚')
  } finally {
    await cache.close()
    await rm(root, { recursive: true, force: true })
  }
})
