import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  bindReviewInput,
  reviewedDraftHash,
  reviewInputFile,
} from '../../src/review/input-binding.js'
import { ContractReader } from '../../src/storage/adapters/ContractReader.js'
import { serializeFrontMatter } from '../../src/storage/serializers/front-matter.js'
import { minimalWorkContract } from '../state-machine/_helper.js'

export function reviewMarkdown(chapterNum, issues = []) {
  const blocking = issues.filter(isBlocking).length
  return `# 第 ${chapterNum} 章审稿单\n\n> 完整两审模式。\n> 共 ${issues.length} 个问题：${blocking} 阻断。\n`
}

export function reviewOutcome(
  chapterNum,
  issues = [],
  factChanges = [],
  reviewedDraft = '',
  reviewInputToken = ''
) {
  const blocking = issues.filter(isBlocking).length
  return JSON.stringify(
    {
      章号: chapterNum,
      issues,
      issues_count: issues.length,
      blocking_count: blocking,
      has_blocking: blocking > 0,
      审稿输入令牌: reviewInputToken,
      草稿哈希: reviewedDraftHash(reviewedDraft),
      ...(factChanges.length ? { factChanges } : {}),
    },
    null,
    2
  )
}

export async function writeReviewArtifacts(
  repoPath,
  chapterNum,
  issues = [],
  factChanges = [],
  reviewedDraft = ''
) {
  await fs.mkdir(path.join(repoPath, '工作区', '评审报告'), { recursive: true })
  const boundInput = await writeBoundReviewInput(repoPath, chapterNum, reviewedDraft)
  await Promise.all([
    fs.writeFile(
      path.join(repoPath, '工作区', '审稿.md'),
      reviewMarkdown(chapterNum, issues),
      'utf8'
    ),
    fs.writeFile(
      path.join(repoPath, '工作区', '评审报告', '审稿结果.json'),
      reviewOutcome(
        chapterNum,
        issues,
        factChanges,
        reviewedDraft,
        boundInput.审稿输入令牌
      ),
      'utf8'
    ),
  ])
  return boundInput
}

async function writeBoundReviewInput(repoPath, chapterNum, reviewedDraft) {
  const contractPath = path.join(repoPath, '作品契约', '作品契约.md')
  try {
    await fs.access(contractPath)
  } catch {
    await fs.mkdir(path.dirname(contractPath), { recursive: true })
    await fs.writeFile(contractPath, minimalWorkContract(), 'utf8')
  }
  const contract = await new ContractReader(repoPath).readReviewSections()
  if (!contract.ok) throw new Error(contract.error)

  const draftText = reviewedDraft && typeof reviewedDraft === 'object' && !Array.isArray(reviewedDraft)
    ? serializeFrontMatter(reviewedDraft.frontMatter || {}, reviewedDraft.body || '')
    : String(reviewedDraft || '')
  const input = bindReviewInput({
    章号: chapterNum,
    作品契约版本: contract.data.frontMatter.契约版本,
    草稿全文: draftText,
    作品契约: contract.content,
  })
  const file = reviewInputFile(input)
  await fs.writeFile(path.join(repoPath, file.path), file.content, 'utf8')
  return input
}

function isBlocking(issue) {
  return issue?.category !== 'unregistered_thread' &&
    (issue?.severity === 'critical' || issue?.blocking === true)
}
