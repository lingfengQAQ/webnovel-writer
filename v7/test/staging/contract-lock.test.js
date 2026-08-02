import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  acquireContractMutationLock,
  readStaleContractLock,
  STALE_CONTRACT_LOCK_AGE_MS,
  CONTRACT_UPDATE_LOCK,
} from '../../src/staging/contract-invalidation.js'
import { makeRepo, cleanup } from '../storage/_tmprepo.js'

/**
 * P3-F9：契约互斥锁陈旧回收（S0 检测+序0 确认流，非静默回收）。
 * 锁文件内容 {pid, operation, startedAt}（既有写入方）；读侧判定：pid 死→陈旧；
 * 无 pid 信息/探测失败→超龄阈值兜底；pid 存活→活锁保持拒绝（不得误删）。
 */

async function writeLock(root, fields) {
  const p = path.join(root, CONTRACT_UPDATE_LOCK)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(fields), 'utf8')
  return p
}

test('readStaleContractLock：pid 已死 → 陈旧', async () => {
  const root = await makeRepo()
  try {
    // 找一个肯定不存在的 pid：从当前 pid 往上找空位
    let deadPid = process.pid + 100000
    try { process.kill(deadPid, 0) } catch { /* ESRCH 即确认已死 */ }
    await writeLock(root, { pid: deadPid, operation: '章节定稿', startedAt: new Date().toISOString() })
    const r = await readStaleContractLock(root)
    assert.equal(r.stale, true, r.error)
    assert.match(r.reason, /进程.*不?在|已退出|pid/i)
  } finally {
    await cleanup(root)
  }
})

test('readStaleContractLock：pid 存活（自身）→ 活锁，绝不可判陈旧', async () => {
  const root = await makeRepo()
  try {
    await writeLock(root, { pid: process.pid, operation: '章节定稿', startedAt: new Date(Date.now() - 7200_000).toISOString() })
    const r = await readStaleContractLock(root)
    assert.equal(r.stale, false, '活锁即使超龄也不得判陈旧（误删=并发写损坏窗口）')
  } finally {
    await cleanup(root)
  }
})

test('readStaleContractLock：无 pid 字段 + 超龄（>阈值）→ 年龄兜底判陈旧', async () => {
  const root = await makeRepo()
  try {
    const p = await writeLock(root, { operation: '章节定稿', startedAt: new Date(Date.now() - STALE_CONTRACT_LOCK_AGE_MS - 60_000).toISOString() })
    const old = new Date(Date.now() - STALE_CONTRACT_LOCK_AGE_MS - 60_000)
    await fs.utimes(p, old, old)
    const r = await readStaleContractLock(root)
    assert.equal(r.stale, true)
    assert.match(r.reason, /超龄|陈旧|残留/)
  } finally {
    await cleanup(root)
  }
})

test('readStaleContractLock：无锁文件 → 不陈旧', async () => {
  const root = await makeRepo()
  try {
    const r = await readStaleContractLock(root)
    assert.equal(r.stale, false)
  } finally {
    await cleanup(root)
  }
})

test('acquireContractMutationLock：并发被拒时报文带锁路径与序0 清理指引', async () => {
  const root = await makeRepo()
  try {
    const first = await acquireContractMutationLock(root, '章节定稿')
    assert.equal(first.ok, true)
    const second = await acquireContractMutationLock(root, '章级知识归档')
    assert.equal(second.ok, false)
    assert.match(second.error, /工作区.{0,2}契约更新处理中\.lock|契约更新处理中\.lock/)
    assert.match(second.error, /陈旧|清理/)
    await first.release()
  } finally {
    await cleanup(root)
  }
})
