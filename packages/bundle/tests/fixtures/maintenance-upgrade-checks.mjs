import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createPresetAgent } from './preset-agents.mjs'

function snapshot(root) {
  const result = {}
  const walk = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      result[relative + '/'] = 'directory'
      for (const name of fs.readdirSync(absolute).sort()) walk(relative ? `${relative}/${name}` : name)
    } else result[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  walk('')
  return result
}

/** The model is not involved: tools, userQuestions, gate and Git are the actual Loader services. */
export async function checkMaintenanceUpgrade({ workspace, ctx, service, execute, withTurn, check, report }) {
  await service('workspaceRegistry').create(workspace)
  const main = await createPresetAgent(service('agents'), { sessionId: 'maintenance-main', meta: { cwd: workspace } })
  const child = await createPresetAgent(main.agent.ctx.get('agents'), { parentAgent: main.agent, sessionId: 'maintenance-child', meta: { cwd: workspace } })
  try {
    await check('整仓升级真实批准、失败续办和收据保护', async () => {
      const created = await execute(main.agent, 'novel_create_book', { bookName: '维护验收', concept: { 状态: '已确认', 核心创意: '在旧城找寻故人', 题材与目标读者: '悬疑' } })
      assert.equal(created.value?.ok, true, JSON.stringify(created))
      const bookId = created.value.bookId, root = path.join(workspace, '维护验收')
      const contract = path.join(root, '作品契约/契约.md')
      const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
      git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '.git/hooks')
      fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace(/^书仓格式版本: 1\r?\n/m, ''))
      git('add', '--', '作品契约/契约.md'); git('commit', '--quiet', '-m', 'fixture: unversioned')
      const before = snapshot(root)
      const preview = await execute(main.agent, 'novel_preview_book_upgrade', { bookId })
      assert.equal(preview.isError, false, JSON.stringify(preview))
      assert.equal(preview.value?.state, 'ready', JSON.stringify(preview))
      assert.deepEqual(snapshot(root), before)
      const fingerprint = preview.value.fingerprint, head = git('rev-parse', 'HEAD')
      let choice = '退回', questions = 0, expectedKind = '书仓升级'
      const off = ctx.on('user-questions/request', async request => {
        questions++
        assert.equal(request.agent, main.agent)
        assert.ok(request.signal instanceof AbortSignal)
        assert.equal(request.questions[0].id, expectedKind)
        assert.match(request.questions[0].detail, new RegExp(fingerprint))
        assert.equal(fs.existsSync(path.join(root, '.webnovel/book.lock')), false)
        return { answers: request.questions.map(question => ({ id: question.id, selected: [choice] })) }
      })
      try {
        const declined = await withTurn(main.agent, () => execute(main.agent, 'novel_apply_book_upgrade', { bookId, fingerprint }))
        assert.equal(declined.value?.ok, false, JSON.stringify(declined))
        assert.equal(declined.value?.code, 'author-declined')
        assert.deepEqual(snapshot(root), before)
        choice = '批准'
        const hook = path.join(root, '.git/hooks/pre-commit')
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
        const pending = await withTurn(main.agent, () => execute(main.agent, 'novel_apply_book_upgrade', { bookId, fingerprint }))
        assert.equal(pending.value?.state, 'written-pending-commit', JSON.stringify(pending))
        assert.equal(git('rev-parse', 'HEAD'), head)
        const saved = fs.readFileSync(contract, 'utf8')
        const receipt = path.join(root, '草稿区/.maintenance-receipts', `${fingerprint}.json`)
        const receiptBytes = fs.readFileSync(receipt, 'utf8')
        const rejected = await execute(main.agent, 'write', { file_path: receipt, content: 'bad receipt' })
        assert.equal(rejected.isError, true, JSON.stringify(rejected))
        assert.match(JSON.stringify(rejected), /操作收据/)
        assert.equal(fs.readFileSync(receipt, 'utf8'), receiptBytes)
        fs.unlinkSync(hook)
        expectedKind = '书仓升级续办'
        const resumed = await withTurn(main.agent, () => execute(main.agent, 'novel_resume_book_upgrade', { bookId, operationId: fingerprint }))
        assert.equal(resumed.value?.state, 'committed', JSON.stringify(resumed))
        assert.equal(fs.readFileSync(contract, 'utf8'), saved)
        assert.equal(git('rev-list', '--count', `${head}..HEAD`), '1')
        const done = snapshot(root)
        const replayed = await execute(main.agent, 'novel_resume_book_upgrade', { bookId, operationId: fingerprint })
        assert.equal(replayed.value?.state, 'already-committed', JSON.stringify(replayed))
        assert.deepEqual(snapshot(root), done)
        assert.equal(questions, 3)
        for (const name of ['novel_preview_book_upgrade', 'novel_apply_book_upgrade', 'novel_resume_book_upgrade']) {
          const denied = await execute(child.agent, name, { bookId })
          assert.equal(denied.isError, true); assert.match(JSON.stringify(denied), /UNKNOWN_TOOL/)
        }
        report.maintenanceUpgrade = { readonlyPreview: true, authorQuestions: questions, rejectedBeforeWrite: true, pendingCommit: true, resumeWithoutRewrite: true, repeatWithoutCommit: true, receiptProtected: true, delegatedToolsDenied: true }
      } finally { off() }
    })
  } finally { await child.dispose(); await main.dispose() }
}
