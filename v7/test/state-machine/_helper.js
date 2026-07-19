import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CacheManager } from '../../src/cache/index.js'

const execFileAsync = promisify(execFile)

/**
 * 造 git 书仓库 + 缓存。files={相对路径:内容}。commits=[{message,files}] 逐个额外提交（用于造 ch(N) 历史）。
 */
export async function makeGitBook(files, { commits = [], includeContract = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-'))
  const git = (a) => execFileAsync('git', a, { cwd: root })
  await git(['init', '-q'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'test'])
  await fs.writeFile(path.join(root, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  const initialFiles = { ...(files || {}) }
  if (includeContract && initialFiles['book.yaml'] && !initialFiles['作品契约/作品契约.md']) {
    initialFiles['作品契约/作品契约.md'] = minimalWorkContract()
    initialFiles['作品契约/知识选择记录.md'] = '# 知识选择记录\n'
  }
  await writeAll(root, initialFiles)
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'init'])

  for (const c of commits) {
    await writeAll(root, c.files)
    await git(['add', '-A'])
    await git(['commit', '-q', '-m', c.message])
  }

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  await cache.ensureReady(root)
  return {
    root,
    git,
    ctx: { repoPath: root, cache },
    cleanup: async () => {
      await cache.close()
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(dbDir, { recursive: true, force: true })
    },
  }
}

async function writeAll(root, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }
}

export const chapter = (n, body = '正文。', vol = 1) =>
  `---\n章号: ${n}\n标题: 第${n}章\n卷: ${vol}\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n---\n${body}`

export function minimalWorkContract({
  version = 1,
  effectiveChapter = 1,
  type = '玄幻',
  secondaryTopics = [],
  pacing = '按因果节点推进，不设固定章数。',
} = {}) {
  return [
    '---',
    `类型: ${type}`,
    '副题材:',
    ...secondaryTopics.map((topic) => `  - ${topic}`),
    '流派:',
    '创意约束:',
    '来源版本:',
    ...Array.from({ length: 1 + secondaryTopics.length }, () => '  - 作者自定义'),
    `契约版本: ${version}`,
    `生效起章: ${effectiveChapter}`,
    version === 1 ? '更新原因: 初始建书' : '更新原因: 测试修订',
    version === 1 ? '变更类型: 建书' : '变更类型: 作者主动修改',
    '---',
    '## 核心读者承诺',
    '成长与选择都有可见后果。',
    '## 骨架约定',
    '按卷推进长期目标。',
    '## 题材融合协议',
    '无副题材。',
    '## 创意约束落地',
    '主线困境不由临时奖励解决。',
    '## 差异化点',
    '- 线索改变人物关系。',
    '- 成长代价延续到后文。',
    '- 反派掌握先手信息。',
    '## 冲突与关系结算原则',
    '- 主角底线：不牺牲无辜。',
    '- 伤害后果：责任必须可见。',
    '- 和解条件：先有修复行动。',
    '- 救赎条件：持续付出代价。',
    '- 允许余地：善良与克制可以成立。',
    '## 本书专属毒点',
    '- 不用旁白直接揭谜。',
    '## 节奏与兑现参数',
    pacing,
  ].join('\n')
}

export function minimalCreateBookPayload(overrides = {}) {
  const base = {
    book: {
      spec_version: '7.0',
      书名: '测试书',
      类型: '玄幻',
      副题材: [],
      流派: [],
    },
    总纲: '# 总纲',
    卷纲: '# 第1卷',
    作品契约: minimalWorkContract(),
    知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
    作者已确认: true,
  }
  return {
    ...base,
    ...overrides,
    book: { ...base.book, ...(overrides.book || {}) },
  }
}
