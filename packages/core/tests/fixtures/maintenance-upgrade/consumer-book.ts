/** Synthetic ready-design book containing frozen historical serializer outputs and labeled edge variants. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { scaffoldBookFiles } from '../../../src/book/scaffold'
import { parseDocument, serializeDocument } from '../../../src/repo/frontmatter'
import { paths } from '../../../src/repo/paths'
import { writeReadyDesign } from '../ready-design'

const fixtures = fileURLToPath(new URL('.', import.meta.url))
const historical = (name: string): string => fs.readFileSync(path.join(fixtures, `historical-${name}.md`), 'utf8')
export const consumerBookId = 'upgrade-consumer-fixture'
export const consumerKey = { 卷: 1, 章: 4, 章名: '潮落出发' } as const
export const laterConsumerKey = { 卷: 1, 章: 9, 章名: '再次会面' } as const

export const putConsumerFile = (root: string, relative: string, text: string): void => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text)
}
export const readConsumerFile = (root: string, relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
export const consumerGit = (root: string, ...args: string[]): string => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
}).trim()

function outline(name: string): string {
  return [
    '# 章细纲', '', '## 定位段', '',
    '### 来源窗口项及拆并关系', `${name}，单章承接`, '',
    '### 章节功能', '从旧船票追查渡口旧案', '',
    '### 视角与焦点', '林舟视角', '',
    '### 时空锚定', '渡口，清晨', '',
    '### 起止边界', '从抵达渡口到乘船离开', '',
    '### 故事线与承诺分配', '追查铜铃来源', '',
    '### 信息边界', '只披露林舟已经知道的事', '',
    '### 情绪与节奏目标', '克制叙述，留下疑问', '',
    '### 前置条件核对结果', '已核对来源和窗口', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 找到摆渡人', '- 人物: 林舟', '- 时空: 渡口',
    '- 行动/冲突: 询问旧船票', '- 信息披露: 铜铃留下线索', '- 状态变化: 从等待到出发', '',
  ].join('\n')
}

export function createConsumerBook(workspace: string): string {
  const root = path.join(workspace, '测试书')
  fs.mkdirSync(root)
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '渡口的旧船票引出失踪旧案。', 题材与目标读者: '面向成年读者的幻想故事。' }, { bookId: consumerBookId })
  const concept = readConsumerFile(root, paths.构想快照())
  writeReadyDesign(root)
  putConsumerFile(root, paths.构想快照(), concept)
  const contract = parseDocument(readConsumerFile(root, paths.契约()))
  if (!contract.ok) throw new Error(contract.detail)
  const { 书仓格式版本: _format, ...contractFields } = contract.data.fields
  putConsumerFile(root, paths.契约(), '\uFEFF' + serializeDocument({ ...contractFields, 版本: 7, 父版本: 6 }, contract.data.body).replace(/\n/g, '\r\n'))
  for (const [module, name] of [['人物档案', '主角'], ['世界规则', '基础规则']] as const) {
    const relative = `世界书/${module}/${name}.md`, original = parseDocument(readConsumerFile(root, relative))
    if (!original.ok) throw new Error(original.detail)
    putConsumerFile(root, relative, serializeDocument({ 名称: name, 类型: module, 性质: '计划', 状态: '已确认', 来源: '对谈共创', 版本: 1 }, original.data.body))
  }
  putConsumerFile(root, '世界书/人物档案/林舟.md', historical('worldbook'))
  for (const key of [consumerKey, laterConsumerKey]) putConsumerFile(root, paths.确认细纲(key.卷, key.章, key.章名), serializeDocument({
    身份: key, 状态: '已确认', 版本: 2, 父版本: 1,
    来源引用: ['作品契约/契约.md@7', '世界书/人物档案/林舟.md@4'],
  }, outline(key.章名)))
  putConsumerFile(root, paths.近期窗口(1), '# 近期窗口\n- 潮落出发 〔已确认〕\n- 再次会面 〔已确认〕\n')
  putConsumerFile(root, paths.计划时间线(1), '# 计划时间线\n## 窗口覆盖\n- 渡口会面\n## 窗口外锚点\n- 再次会面\n')

  // Boundary variants of original serializer output: explicit references, old entries
  // outside the recent-item budget, a future event, and a future clue update.
  const baseTimeline = historical('timeline')
  const first = baseTimeline.replace('事件：林舟在渡口遇见摆渡人', '事件：[[林舟]] 在渡口遇见摆渡人')
  const filler = Array.from({ length: 24 }, (_, index) => baseTimeline.slice(baseTimeline.indexOf('## '))
    .replace('## 渡口会面', `## 档案记录${index}`)
    .replace('事件：林舟在渡口遇见摆渡人', `事件：旁支事件${index}`)
    .replace('时点：次日清晨', '时点：当日入夜')
    .replace('两人相约第三次潮落后出发。', `另一处的记录${index}。`)).join('\n')
  const future = baseTimeline.slice(baseTimeline.indexOf('## ')).replace('## 渡口会面', '## 再次会面')
    .replaceAll('0003', '0009').replace('事件：林舟在渡口遇见摆渡人', '事件：[[林舟]] 在未来渡口收到第二封信')
    .replace('两人相约第三次潮落后出发。', '这段仅在第九章后可见。')
  putConsumerFile(root, paths.账本('时间线'), first + '\n' + filler + '\n' + future)
  const clue = historical('clue')
  putConsumerFile(root, paths.账本('线索'), clue + '\n' + clue.slice(clue.indexOf('## ')).replace('状态：已埋', '状态：已收').replaceAll('0003', '0009').replace('石上留有半枚印记。', '第九章认出了印记。'))
  putConsumerFile(root, '本书记忆/决策.md', historical('memory'))
  putConsumerFile(root, '本书记忆/文风.md', historical('memory').replace('# 决策', '# 文风').replace('类：决策', '类：文风')
    .replace('## 保留渡口视角', '## 渡口叙述').replace('保留摆渡人的观察，不提前写明他的来历。', '以克制的叙述保留潮声，不提前解释摆渡人的来历。'))
  putConsumerFile(root, '本书记忆/%41.md', serializeDocument({ 名称: '%41', 类: '对话', 来源: '作者对谈', 状态: '已确认' }, '百分号是文件名的一部分。'))
  putConsumerFile(root, paths.本书记忆索引(), historical('index') + '\n作者说明：旧的分类入口继续可查。\n- [决策](决策.md) — 分类入口\n- [文风](文风.md) — 分类入口\n')
  consumerGit(root, 'init', '--quiet'); consumerGit(root, 'config', 'user.name', 'Fixture')
  consumerGit(root, 'config', 'user.email', 'fixture@example.invalid'); consumerGit(root, 'config', 'commit.gpgsign', 'false')
  consumerGit(root, 'config', 'core.hooksPath', '.git/hooks'); consumerGit(root, 'config', 'core.autocrlf', 'false')
  consumerGit(root, 'add', '.'); consumerGit(root, 'commit', '--quiet', '-m', 'vol: synthetic consumer baseline')
  return root
}

export function consumerSnapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) { result[relative + '/'] = 'directory'; walk(relative) }
      else result[relative] = createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')
    }
  }
  walk(''); return result
}
