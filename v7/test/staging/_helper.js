import { promises as fs } from 'node:fs'
import path from 'node:path'

export function reviewMarkdown(chapterNum, issues = []) {
  const blocking = issues.filter(isBlocking).length
  return `# 第 ${chapterNum} 章审稿单\n\n> 完整两审模式。\n> 共 ${issues.length} 个问题：${blocking} 阻断。\n`
}

export function reviewOutcome(chapterNum, issues = []) {
  const blocking = issues.filter(isBlocking).length
  return JSON.stringify(
    {
      章号: chapterNum,
      issues,
      issues_count: issues.length,
      blocking_count: blocking,
      has_blocking: blocking > 0,
    },
    null,
    2
  )
}

export async function writeReviewArtifacts(repoPath, chapterNum, issues = []) {
  await fs.mkdir(path.join(repoPath, '工作区', '评审报告'), { recursive: true })
  await Promise.all([
    fs.writeFile(
      path.join(repoPath, '工作区', '审稿.md'),
      reviewMarkdown(chapterNum, issues),
      'utf8'
    ),
    fs.writeFile(
      path.join(repoPath, '工作区', '评审报告', '审稿结果.json'),
      reviewOutcome(chapterNum, issues),
      'utf8'
    ),
  ])
}

function isBlocking(issue) {
  return issue?.category !== 'unregistered_thread' &&
    (issue?.severity === 'critical' || issue?.blocking === true)
}
