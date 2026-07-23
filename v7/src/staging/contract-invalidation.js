import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { ContractReader } from '../storage/adapters/ContractReader.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import {
  CHAPTER_KNOWLEDGE_SNAPSHOT_PATH,
  parseChapterKnowledgeSnapshot,
} from '../knowledge/chapter.js'
import { readCurrentReviewInput } from '../review/input-binding.js'

export const CONTRACT_INVALIDATION_MARKER = path.join('工作区', '契约更新待重备料.md')
export const CONTRACT_INVALIDATION_GUARD = path.join('工作区', '契约失效.json')
export const CONTRACT_UPDATE_LOCK = path.join('工作区', '契约更新处理中.lock')

const BATCH_DIR = path.join('工作区', '待定稿')
const GUARD_KEYS = Object.freeze([
  '契约版本',
  '生效起章',
  '受影响批次章',
  '当前工作区章',
  '待提交章',
])
const PROOF_KEYS = Object.freeze(['章号', '契约版本', '批次目录', '定稿包哈希'])
const PACKAGE_HASH_RE = /^sha256:[0-9a-f]{64}$/
const ACTIVE_CONTRACT_MUTATION_LOCKS = new WeakSet()

export async function acquireContractMutationLock(repoPath, operation = '作品状态写入') {
  const lockPath = path.join(repoPath, CONTRACT_UPDATE_LOCK)
  let handle
  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() }),
      'utf8'
    )
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {})
      await fs.rm(lockPath, { force: true }).catch(() => {})
    }
    if (err.code === 'EEXIST') {
      return {
        ok: false,
        error: `已有作品状态写入正在处理，${operation}不能并发执行；请等待该次完成后重试。`,
      }
    }
    return { ok: false, error: `${operation}无法建立并发保护：${err.message}` }
  }

  let released = false
  const lock = {
    ok: true,
    repoKey: contractMutationRepoKey(repoPath),
    async release() {
      if (released) return
      released = true
      ACTIVE_CONTRACT_MUTATION_LOCKS.delete(lock)
      await handle.close().catch(() => {})
      await fs.rm(lockPath, { force: true }).catch(() => {})
    },
  }
  ACTIVE_CONTRACT_MUTATION_LOCKS.add(lock)
  return lock
}

export function holdsContractMutationLock(lock, repoPath) {
  return !!lock &&
    ACTIVE_CONTRACT_MUTATION_LOCKS.has(lock) &&
    lock.repoKey === contractMutationRepoKey(repoPath)
}

export async function checkChapterContractInvalidation(repoPath, chapterNum, { payload = null } = {}) {
  const guard = await readContractInvalidationGuard(repoPath)
  if (guard?.corrupt) {
    return { ok: false, kind: 'corrupt', guard, proof: null, resolvedGuard: null, error: '' }
  }
  const marker = await readContractInvalidationMarker(repoPath)
  if (marker.corrupt) {
    return { ok: false, kind: 'corrupt', guard, proof: null, resolvedGuard: null, error: '' }
  }

  const proof = findPendingCommitProof(guard, chapterNum)
  if (proof) {
    return { ok: true, kind: 'ready', guard, proof, resolvedGuard: null, error: '' }
  }

  if (guardBlocksChapter(guard, chapterNum)) {
    const fresh = await validateFreshContractWork(repoPath, chapterNum, payload)
    if (!fresh.ok) {
      return { ok: false, kind: 'stale', guard, proof: null, resolvedGuard: null, error: fresh.error }
    }
    return {
      ok: true,
      kind: 'fresh',
      guard,
      proof: null,
      resolvedGuard: resolveGuardChapter(guard, chapterNum),
      error: '',
    }
  }

  if (!guard || !guardHasPendingChapters(guard)) {
    if (marker.exists && chapterNum >= marker.effectiveChapter) {
      return {
        ok: false,
        kind: 'marker',
        guard,
        proof: null,
        resolvedGuard: null,
        effectiveChapter: marker.effectiveChapter,
        error: '',
      }
    }
  }
  return { ok: true, kind: '', guard, proof: null, resolvedGuard: null, error: '' }
}

export async function readContractInvalidationMarker(repoPath) {
  try {
    const content = await fs.readFile(path.join(repoPath, CONTRACT_INVALIDATION_MARKER), 'utf8')
    const matches = [...content.matchAll(/作品契约从第\s*(\d+)\s*章起更新/g)]
    const effectiveChapter = matches.length === 1 ? Number(matches[0][1]) : null
    if (!Number.isSafeInteger(effectiveChapter) || effectiveChapter < 1) {
      return { exists: true, corrupt: true, effectiveChapter: null }
    }
    return { exists: true, corrupt: false, effectiveChapter }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { exists: false, corrupt: false, effectiveChapter: null }
    }
    return { exists: true, corrupt: true, effectiveChapter: null }
  }
}

export function contractInvalidationGuardFile(guard) {
  const normalized = normalizeGuardForWrite(guard)
  if (!isValidGuard(normalized)) {
    throw new Error('契约失效记录内容不完整，拒绝写入')
  }
  return {
    path: CONTRACT_INVALIDATION_GUARD,
    content: JSON.stringify(normalized, null, 2),
  }
}

export async function readContractInvalidationGuard(repoPath) {
  try {
    const guard = JSON.parse(
      await fs.readFile(path.join(repoPath, CONTRACT_INVALIDATION_GUARD), 'utf8')
    )
    if (!isValidGuard(guard)) return corruptContractInvalidationGuard()
    const contract = await new ContractReader(repoPath).read()
    if (
      !contract.ok ||
      contract.data?.frontMatter?.契约版本 !== guard.契约版本 ||
      contract.data?.frontMatter?.生效起章 !== guard.生效起章
    ) {
      return corruptContractInvalidationGuard()
    }
    const marker = await readContractInvalidationMarker(repoPath)
    if (
      !marker.exists ||
      marker.corrupt ||
      marker.effectiveChapter !== guard.生效起章
    ) {
      return corruptContractInvalidationGuard()
    }
    return {
      corrupt: false,
      契约版本: guard.契约版本,
      生效起章: guard.生效起章,
      受影响批次章: [...guard.受影响批次章],
      当前工作区章: [...guard.当前工作区章],
      待提交章: guard.待提交章.map((proof) => ({ ...proof })),
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null
    return corruptContractInvalidationGuard()
  }
}

export function guardBlocksChapter(guard, chapterNum) {
  if (!guard) return false
  if (guard.corrupt) return true
  if (guard.受影响批次章.includes(chapterNum)) return true
  if (guard.当前工作区章.includes(chapterNum)) return true
  return guardHasPendingChapters(guard) && chapterNum >= guard.生效起章
}

export function resolveGuardChapter(guard, chapterNum) {
  return {
    ...guard,
    受影响批次章: guard.受影响批次章.filter((chapter) => chapter !== chapterNum),
    当前工作区章: guard.当前工作区章.filter((chapter) => chapter !== chapterNum),
    待提交章: guard.待提交章.filter((proof) => proof.章号 !== chapterNum),
  }
}

export function guardHasPendingChapters(guard) {
  return guard?.受影响批次章?.length > 0 ||
    guard?.当前工作区章?.length > 0 ||
    guard?.待提交章?.length > 0
}

export function findPendingCommitProof(guard, chapterNum) {
  if (!guard || guard.corrupt) return null
  return guard.待提交章.find((proof) => proof.章号 === chapterNum) || null
}

export function contractPackageHash(content) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex')
}

export function moveGuardChapterToPendingCommit(guard, chapterNum, batchDir, payloadContent) {
  if (!guard || guard.corrupt) throw new Error('契约失效记录不可用')
  const proof = {
    章号: chapterNum,
    契约版本: guard.契约版本,
    批次目录: batchDir,
    定稿包哈希: contractPackageHash(payloadContent),
  }
  const next = resolveGuardChapter(guard, chapterNum)
  next.待提交章.push(proof)
  next.待提交章.sort((left, right) => left.章号 - right.章号)
  if (!isValidGuard(normalizeGuardForWrite(next))) {
    throw new Error('待提交证据与契约失效记录不一致')
  }
  return { guard: next, proof }
}

export function movePendingCommitBackToAffected(guard, chapterNum) {
  if (!guard || guard.corrupt) return guard
  const next = resolveGuardChapter(guard, chapterNum)
  next.受影响批次章 = [...new Set([...next.受影响批次章, chapterNum])].sort(
    (left, right) => left - right
  )
  return next
}

export function replacePendingCommitProof(guard, chapterNum, batchDir, payloadContent) {
  if (!findPendingCommitProof(guard, chapterNum)) {
    throw new Error(`第 ${chapterNum} 章没有待提交证据`)
  }
  return moveGuardChapterToPendingCommit(guard, chapterNum, batchDir, payloadContent)
}

export function verifyPendingCommitProof(
  guard,
  { chapterNum, batchDir, payloadContent, expectedProof = null }
) {
  const proof = findPendingCommitProof(guard, chapterNum)
  if (!proof) return { ok: false, proof: null, error: `第 ${chapterNum} 章没有待提交证据` }
  if (expectedProof && !samePendingCommitProof(proof, expectedProof)) {
    return { ok: false, proof, error: `第 ${chapterNum} 章待提交授权与失效记录不一致` }
  }
  if (proof.批次目录 !== batchDir) {
    return { ok: false, proof, error: `第 ${chapterNum} 章待提交证据绑定的批次目录不一致` }
  }
  if (proof.契约版本 !== guard.契约版本) {
    return { ok: false, proof, error: `第 ${chapterNum} 章待提交证据的契约版本不一致` }
  }
  if (proof.定稿包哈希 !== contractPackageHash(payloadContent)) {
    return { ok: false, proof, error: `第 ${chapterNum} 章定稿包已变化，待提交证据失效` }
  }
  return { ok: true, proof, error: '' }
}

export async function verifyPendingCommitProofFile(
  repoPath,
  guard,
  chapterNum,
  { batchDir = null, expectedProof = null } = {}
) {
  const proof = findPendingCommitProof(guard, chapterNum)
  if (!proof) return { ok: false, proof: null, content: null, error: `第 ${chapterNum} 章没有待提交证据` }
  const boundDir = batchDir || proof.批次目录
  let content
  try {
    content = await fs.readFile(
      path.join(repoPath, BATCH_DIR, boundDir, '定稿包.json')
    )
  } catch (err) {
    return {
      ok: false,
      proof,
      content: null,
      error: `第 ${chapterNum} 章定稿包读取失败：${err.message}`,
    }
  }
  const verified = verifyPendingCommitProof(guard, {
    chapterNum,
    batchDir: boundDir,
    payloadContent: content,
    expectedProof,
  })
  return { ...verified, content }
}

export async function releaseContractInvalidationChapterAfterCommit(
  repoPath,
  chapterNum,
  expectedProof = null
) {
  const guard = await readContractInvalidationGuard(repoPath)
  if (!guard) {
    return expectedProof
      ? { ok: false, warnings: [], error: '待提交证据对应的契约失效守卫不见了' }
      : { ok: true, warnings: [], error: '' }
  }
  if (guard.corrupt) {
    return { ok: false, warnings: [], error: '契约失效记录损坏，守卫与标记均已保留' }
  }
  if (expectedProof) {
    const verified = await verifyPendingCommitProofFile(repoPath, guard, chapterNum, {
      batchDir: expectedProof.批次目录,
      expectedProof,
    })
    if (!verified.ok) {
      return { ok: false, warnings: [], error: verified.error }
    }
  }

  const nextGuard = resolveGuardChapter(guard, chapterNum)
  try {
    await writeAtomicBatch(repoPath, [contractInvalidationGuardFile(nextGuard)])
  } catch (err) {
    return { ok: false, warnings: [], error: `契约失效记录更新失败：${err.message}` }
  }
  if (guardHasPendingChapters(nextGuard)) return { ok: true, warnings: [], error: '' }

  const warnings = []
  try {
    await fs.rm(path.join(repoPath, CONTRACT_INVALIDATION_MARKER), { force: true })
  } catch (err) {
    warnings.push(`契约重备料标记清理失败（${err.message}），稍后手动删除即可。`)
    return { ok: true, warnings, error: '' }
  }
  try {
    await fs.rm(path.join(repoPath, CONTRACT_INVALIDATION_GUARD), { force: true })
  } catch (err) {
    warnings.push(`空的契约失效记录清理失败（${err.message}），稍后手动删除即可。`)
  }
  return { ok: true, warnings, error: '' }
}

export async function overlapsMachineWorkspaceState(repoPath, name) {
  const target = path.join(repoPath, '工作区', name)
  const protectedPaths = [
    path.join(repoPath, BATCH_DIR),
    path.join(repoPath, CONTRACT_INVALIDATION_GUARD),
    path.join(repoPath, CONTRACT_INVALIDATION_MARKER),
    path.join(repoPath, CONTRACT_UPDATE_LOCK),
    path.join(repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH),
  ]
  for (const protectedPath of protectedPaths) {
    if (await filesystemPathsOverlap(target, protectedPath)) return true
  }
  return false
}

export async function workspaceRemovalIsContained(repoPath, name) {
  const workspace = path.join(repoPath, '工作区')
  const target = path.join(workspace, name)
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) return false
  } catch (err) {
    if (err.code === 'ENOENT') return true
    return false
  }
  try {
    const [realWorkspace, realTarget] = await Promise.all([
      fs.realpath(workspace),
      fs.realpath(target),
    ])
    const relative = path.relative(realWorkspace, realTarget)
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  } catch {
    return false
  }
}

async function validateFreshContractWork(repoPath, chapterNum, payload) {
  const contract = await new ContractReader(repoPath).readWritingSections()
  if (!contract.ok) return { ok: false, error: contract.error }

  const outlinePath = path.join(repoPath, '工作区', '细纲.md')
  const snapshotPath = path.join(repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH)
  const materialPath = path.join(repoPath, '工作区', '本章写作材料.md')
  const reviewPath = path.join(repoPath, '工作区', '审稿.md')
  const outcomePath = path.join(repoPath, '工作区', '评审报告', '审稿结果.json')
  const contractPath = path.join(repoPath, '作品契约', '作品契约.md')
  try {
    const [
      outline,
      snapshotText,
      material,
      review,
      outcomeText,
      contractStat,
      outlineStat,
      snapshotStat,
      materialStat,
      reviewStat,
      outcomeStat,
    ] =
      await Promise.all([
        fs.readFile(outlinePath, 'utf8'),
        fs.readFile(snapshotPath, 'utf8'),
        fs.readFile(materialPath, 'utf8'),
        fs.readFile(reviewPath, 'utf8'),
        fs.readFile(outcomePath, 'utf8'),
        fs.stat(contractPath),
        fs.stat(outlinePath),
        fs.stat(snapshotPath),
        fs.stat(materialPath),
        fs.stat(reviewPath),
        fs.stat(outcomePath),
      ])
    if (!new RegExp(`^#\\s*第\\s*${chapterNum}\\s*章细纲`, 'm').test(outline)) {
      return { ok: false, error: `细纲不是第 ${chapterNum} 章的新细纲` }
    }
    const snapshot = parseChapterKnowledgeSnapshot(snapshotText, outline)
    if (!snapshot.ok) return { ok: false, error: snapshot.error }
    if (!new RegExp(`^#\\s*第\\s*${chapterNum}\\s*章写作材料`, 'm').test(material)) {
      return { ok: false, error: `本章写作材料不是第 ${chapterNum} 章的新备料` }
    }
    const expectedContract = contract.content.replace(/^## /gm, '### ')
    if (!material.includes(expectedContract)) {
      return { ok: false, error: '本章写作材料没有采用当前版本的作品契约' }
    }
    if (!new RegExp(`^#\\s*第\\s*${chapterNum}\\s*章审稿单`, 'm').test(review)) {
      return { ok: false, error: `审稿单不是第 ${chapterNum} 章的新审稿结果` }
    }
    const outcome = JSON.parse(outcomeText)
    if (outcome?.章号 !== chapterNum) {
      return { ok: false, error: `结构化审稿结果与第 ${chapterNum} 章不对应` }
    }
    const reviewBinding = await readCurrentReviewInput(repoPath, {
      chapterNum,
      draft: payload,
      expectedToken: outcome.审稿输入令牌,
    })
    if (!reviewBinding.ok) {
      return { ok: false, error: `结构化审稿结果与当前审稿输入不一致：${reviewBinding.error}` }
    }
    if (
      outlineStat.mtimeMs < contractStat.mtimeMs ||
      snapshotStat.mtimeMs < contractStat.mtimeMs ||
      materialStat.mtimeMs < outlineStat.mtimeMs ||
      reviewStat.mtimeMs < materialStat.mtimeMs ||
      outcomeStat.mtimeMs < materialStat.mtimeMs
    ) {
      return { ok: false, error: '材料或审稿结果早于本次契约更新，须重新备料并审查' }
    }
    return { ok: true, error: '' }
  } catch (err) {
    return { ok: false, error: `缺少契约更新后的新材料或新审稿结果：${err.message}` }
  }
}

function normalizeGuardForWrite(guard) {
  return {
    契约版本: guard?.契约版本,
    生效起章: guard?.生效起章,
    受影响批次章: [...new Set(guard?.受影响批次章 || [])].sort((a, b) => a - b),
    当前工作区章: [...new Set(guard?.当前工作区章 || [])].sort((a, b) => a - b),
    待提交章: [...(guard?.待提交章 || [])]
      .map((proof) => ({
        章号: proof?.章号,
        契约版本: proof?.契约版本,
        批次目录: proof?.批次目录,
        定稿包哈希: proof?.定稿包哈希,
      }))
      .sort((left, right) => left.章号 - right.章号),
  }
}

function isValidGuard(guard) {
  if (!isExactObject(guard, GUARD_KEYS)) return false
  if (!Number.isInteger(guard.契约版本) || guard.契约版本 < 1) return false
  if (!Number.isInteger(guard.生效起章) || guard.生效起章 < 1) return false
  if (!isUniqueChapterList(guard.受影响批次章)) return false
  if (!isUniqueChapterList(guard.当前工作区章)) return false
  if (
    [...guard.受影响批次章, ...guard.当前工作区章]
      .some((chapter) => chapter < guard.生效起章)
  ) return false
  if (!Array.isArray(guard.待提交章)) return false

  const occupied = new Set([...guard.受影响批次章, ...guard.当前工作区章])
  if (occupied.size !== guard.受影响批次章.length + guard.当前工作区章.length) return false
  for (const proof of guard.待提交章) {
    if (!isExactObject(proof, PROOF_KEYS)) return false
    if (!Number.isInteger(proof.章号) || proof.章号 < guard.生效起章) return false
    if (proof.契约版本 !== guard.契约版本) return false
    if (!isBoundBatchDirectory(proof.批次目录, proof.章号)) return false
    if (!PACKAGE_HASH_RE.test(proof.定稿包哈希 || '')) return false
    if (occupied.has(proof.章号)) return false
    occupied.add(proof.章号)
  }
  return true
}

function isExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isUniqueChapterList(chapters) {
  return Array.isArray(chapters) &&
    chapters.every((chapter) => Number.isInteger(chapter) && chapter > 0) &&
    new Set(chapters).size === chapters.length
}

function isBoundBatchDirectory(value, chapterNum) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return false
  const prefix = `${String(chapterNum).padStart(4, '0')}-`
  return value.startsWith(prefix) && value.length > prefix.length && path.basename(value) === value
}

function samePendingCommitProof(left, right) {
  return PROOF_KEYS.every((key) => left?.[key] === right?.[key])
}

function corruptContractInvalidationGuard() {
  return {
    corrupt: true,
    契约版本: null,
    生效起章: 1,
    受影响批次章: [],
    当前工作区章: [],
    待提交章: [],
  }
}

async function filesystemPathsOverlap(left, right) {
  const key = (value) => path.resolve(value).normalize('NFC').toLowerCase()
  const overlap = (a, b) => isSameOrAncestor(key(a), key(b)) || isSameOrAncestor(key(b), key(a))
  if (overlap(left, right)) return true
  try {
    const [realLeft, realRight] = await Promise.all([fs.realpath(left), fs.realpath(right)])
    return overlap(realLeft, realRight)
  } catch {
    return false
  }
}

function isSameOrAncestor(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function contractMutationRepoKey(repoPath) {
  return path.resolve(repoPath).normalize('NFC').toLowerCase()
}
