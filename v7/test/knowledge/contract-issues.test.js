import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  contractIssuesFromReviewIssues,
  decodeContractIssue,
  encodeContractIssue,
  evaluateContractIssueSignals,
  readContractIssueHistory,
  summarizeContractIssues,
} from '../../src/knowledge/contract-issues.js'
import { serializeFrontMatter } from '../../src/storage/serializers/front-matter.js'

const issue = (summary = '承诺没有兑现') => ({
  severity: 'medium',
  contract_clause: '核心读者承诺',
  description: summary,
})

test('契约问题记录只保留条款、严重度和摘要，并可从平铺列表往返', () => {
  const records = contractIssuesFromReviewIssues([
    issue(),
    issue(),
    { severity: 'low', description: '普通问题' },
  ])
  assert.deepEqual(records, [
    { 条款: '核心读者承诺', 严重度: 'medium', 问题: '承诺没有兑现' },
  ])
  const encoded = encodeContractIssue(records[0])
  assert.equal(encoded, '核心读者承诺｜中｜承诺没有兑现')
  assert.deepEqual(decodeContractIssue(encoded), records[0])
})

test('契约问题阈值：同类连续两章或同卷三次才产生复盘信号', () => {
  const record = { 条款: '核心读者承诺', 严重度: 'medium', 问题: '承诺没有兑现' }
  assert.deepEqual(evaluateContractIssueSignals([{ 章号: 1, 卷: 1, 问题: [record] }]), [])

  const consecutive = evaluateContractIssueSignals([
    { 章号: 1, 卷: 1, 问题: [record] },
    { 章号: 2, 卷: 1, 问题: [record] },
  ])
  assert.deepEqual(consecutive[0].连续章, [1, 2])

  const volumeCount = evaluateContractIssueSignals([
    { 章号: 1, 卷: 1, 问题: [record] },
    { 章号: 2, 卷: 1, 问题: [] },
    { 章号: 3, 卷: 1, 问题: [record] },
    { 章号: 4, 卷: 1, 问题: [] },
    { 章号: 5, 卷: 1, 问题: [record] },
  ])
  assert.equal(volumeCount[0].卷内次数, 3)
  assert.deepEqual(volumeCount[0].连续章, [])
})

test('定稿章档案是契约问题历史的唯一输入，空章不制造占位', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-contract-history-'))
  try {
    const dir = path.join(root, '定稿', '正文')
    await fs.mkdir(dir, { recursive: true })
    const encoded = encodeContractIssue({
      条款: '节奏与兑现参数',
      严重度: 'low',
      问题: '兑现略晚',
    })
    await fs.writeFile(
      path.join(dir, '0001-有记录.md'),
      serializeFrontMatter({ 章号: 1, 标题: '有记录', 卷: 1, 契约问题: [encoded] }, '正文。'),
      'utf8'
    )
    await fs.writeFile(
      path.join(dir, '0002-无记录.md'),
      serializeFrontMatter({ 章号: 2, 标题: '无记录', 卷: 1 }, '正文。'),
      'utf8'
    )
    const history = await readContractIssueHistory(root, { volume: 1 })
    assert.equal(history.length, 2)
    assert.equal(history[0].问题.length, 1)
    assert.deepEqual(history[1].问题, [])
    assert.deepEqual(summarizeContractIssues(history), [
      { 条款: '节奏与兑现参数', 次数: 1, 章: [1], 最近问题: '兑现略晚' },
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
