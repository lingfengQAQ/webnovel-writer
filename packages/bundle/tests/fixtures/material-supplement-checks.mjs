import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export async function checkMaterialSupplements({ root, workspace, main, execute, check, report, withTurn }) {
  const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
  await check('补充原文预览保存、恢复审读与源变化失效', async () => {
    const book = path.join(workspace, '补料验收书')
    const key = { 卷: 1, 章: 3, 章名: '章3' }
    core.makeFixtureBook(book, 3)
    const put = (target, text) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text) }
    const contract = path.join(book, '作品契约/契约.md')
    fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace('---', '---\n书id: supplement-book'))
    put(path.join(book, '大纲/卷规划/卷01/卷纲.md'), '# 卷纲\n\n' + ['叙事结构', '弧线', '线索推进', '卷末兑现'].map(name => `## ${name}\n\n章3核对城门线索。\n`).join('\n'))
    put(path.join(book, '草稿区/草稿/卷01-章3/稿1.md'), core.serializeDocument({ 角色: '待审稿', 版本: 1 }, '主角在城门前看见旧铜符。'))
    const source = path.join(workspace, '书房/作者记忆/补料决定.md')
    put(source, '# 作者决定\n本章保留旧铜符来历，不揭示真名。【宿主补料标记】\n')
    const operation = { 操作: '设置', 编号: 'decision', 标题: '早期决定', 理由: '保持作者确定的信息边界', 性质: '建议', 来源: { 域: '书房', 路径: '作者记忆/补料决定.md' } }
    const call = async extra => {
      const result = await withTurn(main, () => execute(main, 'novel_assemble_materials', { bookId: 'supplement-book', ...key, ...extra }))
      assert.equal(result.isError, false, JSON.stringify(result))
      return result.value
    }
    const dir = path.join(book, '草稿区/材料包/卷01-章3')
    const preview = await call({ 模式: '预览', 补充操作: [operation] })
    assert.equal(preview.ok, true, JSON.stringify(preview))
    assert.equal(fs.existsSync(dir), false)
    assert.match(preview.补充预览[0].原文, /宿主补料标记/)
    const saveArgs = { 模式: '保存', 补充操作: preview.补充预览.map(item => item.操作), 材料清单哈希: preview.材料清单哈希 }
    const saved = await call(saveArgs)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal((await call(saveArgs)).ok, true)
    for (const material of [core.loadDraftContext(book, key).材料段, core.rebuildResume(book, key).injection.材料段, core.computeReview(book, key).材料段]) assert.match(JSON.stringify(material), /宿主补料标记/)

    // Exercise the packaged thin entry and its opt-in JSON output for the review handoff.
    fs.copyFileSync(path.join(root, 'lib/webnovel.mjs'), path.join(root, 'lib/index.js'))
    const cli = execFileSync(process.execPath, [path.join(root, 'skills/novel-review/scripts/确定性检查.mjs'), '--book', book, '--卷', '1', '--章', '3', '--章名', '章3', '--审读材料', 'true'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
    const review = JSON.parse(cli)
    assert.equal(review.ok, true)
    assert.match(JSON.stringify(review.材料段), /宿主补料标记/)
    assert.ok(review.回写载荷.length > 0)
    assert.ok(review.回写载荷.every(item => item.审读指纹 === review.审读指纹 && /^[a-f0-9]{64}$/.test(item.审读指纹)))
    const oldSnapshot = fs.readFileSync(path.join(dir, '补充/decision.md'), 'utf8')
    fs.appendFileSync(source, '作者现在补充了一条意见。\n')
    const stale = await call({})
    assert.equal(stale.ok, false)
    assert.equal(stale.状态, '已过期')
    assert.equal(fs.readFileSync(path.join(dir, '补充/decision.md'), 'utf8'), oldSnapshot)
    assert.equal(core.computeReview(book, key).ok, false)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '材料清单.json'), 'utf8'))
    report.materialSupplements = { previewReadOnly: true, saved: true, replayed: true, consumers: ['drafting', 'recovery', 'review', 'review-cli'], sourceDriftDetected: true, oldSnapshotPreserved: true,
      totalChars: saved.合计字数,
      baseChars: manifest.段.filter(item => item.类型 !== '补充').reduce((sum, item) => sum + item.字数, 0),
      supplementChars: manifest.段.filter(item => item.类型 === '补充').reduce((sum, item) => sum + item.字数, 0),
      sourcePreviewCount: 1, externalModelTokens: null,
    }
  })
}
