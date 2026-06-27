import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 守护不变量：中文目录名、中文文件名、中文内容在任何平台都必须 UTF-8 正确往返，
// 不依赖系统 locale（Windows 中文环境是一等公民，story-repo-spec §2.2）。
test('中文路径与中文内容 UTF-8 往返一致', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wnw-'))
  try {
    const dir = join(base, '测试书-第05卷')
    await mkdir(dir, { recursive: true })
    const file = join(dir, '伏笔-031-灭门真凶.md')
    const content = '# 北境的雪\n林晚于北境得血书，玄阶令牌现世。\n'
    await writeFile(file, content, { encoding: 'utf8' })
    const readBack = await readFile(file, { encoding: 'utf8' })
    assert.equal(readBack, content)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
