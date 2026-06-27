import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CacheManager } from '../../src/cache/index.js'
import { ChapterReader } from '../../src/storage/adapters/ChapterReader.js'

// 守护不变量：中文目录名/文件名/中文内容在任何平台都必须 UTF-8 正确往返过我们的全栈
// （重建缓存 + 读取）。Windows 是一等公民（story-repo-spec §2.2），但 Linux CI 也跑，
// 双平台都覆盖，不依赖系统 locale。
test('中文路径全链路（重建缓存 + 读取，跨平台）', async (t) => {
  const tmpDir = path.join(os.tmpdir(), '测试书仓库', `test-${Date.now()}`)

  try {
    // 构建含中文目录/文件的 fixture
    await fs.mkdir(path.join(tmpDir, '定稿', '正文'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, '.cache'), { recursive: true })

    const testChapter = `---
章号: 1
标题: 测试章节
卷: 1
字数: 100
章定位: 推进
---
这是测试正文。`

    await fs.writeFile(
      path.join(tmpDir, '定稿', '正文', '0001-测试章节.md'),
      testChapter,
      'utf8'
    )

    await fs.writeFile(
      path.join(tmpDir, 'book.yaml'),
      'spec_version: "7.0"\n书名: 测试\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40',
      'utf8'
    )

    // 重建缓存
    const cache = new CacheManager(path.join(tmpDir, '.cache', 'index.db'))
    await cache.ensureReady(tmpDir)

    // 读取接口
    const reader = new ChapterReader(tmpDir, cache)
    const result = await reader.readFrontMatter(1)

    assert.equal(result.ok, true, `读取失败：${result.error}`)
    // 缓存返回英文字段名（title），源文件解析返回中文字段名（标题）
    assert.equal(result.data.title || result.data.标题, '测试章节')

    // 显式关闭数据库连接（避免 Windows 文件锁导致清理失败）
    await cache.close()
  } finally {
    // 清理
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch (err) {
      // Windows 文件锁可能导致删除失败，忽略
    }
  }
})
