import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { readJsonInput } from '../../src/util/json-input.js'

/**
 * P2-1：相对路径两处都找（先启动目录再书仓库），找不到把两处路径如实列出。
 * 宿主在启动目录写临时 JSON 传相对名，此前按 repoPath 解析必 ENOENT。
 */

async function tmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('json-input：绝对路径直接读', async () => {
  const dir = await tmpDir('wnw-ji-')
  try {
    const p = path.join(dir, 'a.json')
    await fs.writeFile(p, '{"x":1}', 'utf8')
    const r = await readJsonInput({ repoPath: dir }, p, 'file')
    assert.equal(r.ok, true)
    assert.equal(r.data.x, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('json-input：相对路径按启动目录找得到（宿主临时 JSON 常写在这）', async () => {
  const cwdDir = await tmpDir('wnw-ji-cwd-')
  const repoDir = await tmpDir('wnw-ji-repo-')
  const oldCwd = process.cwd()
  try {
    await fs.writeFile(path.join(cwdDir, 'payload.json'), '{"来源":"启动目录"}', 'utf8')
    process.chdir(cwdDir)
    const r = await readJsonInput({ repoPath: repoDir }, 'payload.json', 'file')
    assert.equal(r.ok, true, r.error)
    assert.equal(r.data.来源, '启动目录')
  } finally {
    process.chdir(oldCwd)
    await fs.rm(cwdDir, { recursive: true, force: true })
    await fs.rm(repoDir, { recursive: true, force: true })
  }
})

test('json-input：启动目录没有 → 回落书仓库解析（SKILL 约定放 工作区/）', async () => {
  const repoDir = await tmpDir('wnw-ji-repo2-')
  try {
    await fs.mkdir(path.join(repoDir, '工作区'), { recursive: true })
    await fs.writeFile(path.join(repoDir, '工作区', 'p.json'), '{"来源":"书仓库"}', 'utf8')
    const r = await readJsonInput({ repoPath: repoDir }, path.join('工作区', 'p.json'), 'file')
    assert.equal(r.ok, true, r.error)
    assert.equal(r.data.来源, '书仓库')
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true })
  }
})

test('json-input：两处都没有 → 报错列出找过的路径', async () => {
  const repoDir = await tmpDir('wnw-ji-repo3-')
  try {
    const r = await readJsonInput({ repoPath: repoDir }, '不存在.json', 'file')
    assert.equal(r.ok, false)
    assert.ok(r.error.includes('找过'), '报错应列出找过的路径')
    assert.ok(r.error.includes(repoDir), '报错应包含书仓库侧的候选路径')
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true })
  }
})
