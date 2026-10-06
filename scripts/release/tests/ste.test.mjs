import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMarkdown, checkFailures, loadGlossary, report } from '../ste-report.mjs'
import { root } from '../version.mjs'

const glossary = {
  banned: [
    { term: '主对话', preferred: '主会话' },
    { term: '宿主', preferred: 'DSH' },
    { term: '排错', preferred: '故障排查' },
  ],
  allowances: ['宿主版本'],
}

test('sentence splitter drops fragments shorter than 6 characters', () => {
  const result = analyzeMarkdown('请先打开书房。好。然后核对文件名是否正确！', glossary)
  assert.deepEqual(result.sentences.map(item => item.text), ['请先打开书房', '然后核对文件名是否正确'])
})

test('top-level ordered items are steps and other prose is explanation', () => {
  const text = [
    '先阅读这份说明。这一段告诉你范围。',
    '',
    '1. 打开插件页面。成功时，列表显示写作工作台。',
    '   1. 嵌套动作不单独升级为步骤句。',
    '2. 粘贴安装标识。',
    '',
    '| 名称 | 作用 |',
    '| --- | --- |',
    '| 书仓 | 保存一本书的目录 |',
  ].join('\n')
  const result = analyzeMarkdown(text, glossary)
  const steps = result.sentences.filter(item => item.kind === 'step').map(item => item.text)
  const notes = result.sentences.filter(item => item.kind === 'explain').map(item => item.text)
  assert.deepEqual(steps, ['打开插件页面', '成功时，列表显示写作工作台', '粘贴安装标识'])
  assert.ok(notes.some(item => item.includes('先阅读这份说明')))
  assert.ok(notes.some(item => item.includes('嵌套动作不单独升级为步骤句')))
  assert.ok(notes.some(item => item.includes('保存一本书的目录')))
  assert.equal(result.stepWithinLimit, steps.length)
  assert.ok(result.explainRatio >= 0.8)
})

test('banned terms ignore code, prompts, quoted interface text and allowed phrases', () => {
  const text = [
    '回到主对话继续。',
    '',
    '```',
    '主对话',
    '```',
    '',
    '运行 `主对话` 命令。',
    '',
    '> 请在主对话里继续写。',
    '',
    '> [!NOTE]',
    '> 不要回到主对话。',
    '',
    '界面写着「主对话」。',
    '',
    '先核对宿主版本，再启动宿主。',
    '',
    '见 [排错](troubleshooting.md)。',
  ].join('\n')
  const result = analyzeMarkdown(text, glossary)
  const hits = result.termHits.map(item => `${item.line}:${item.term}`).sort()
  assert.deepEqual(hits, ['1:主对话', '12:主对话', '16:宿主', '18:排错'].sort())
})

test('report counts passive voice, double negatives and long paragraphs', () => {
  const text = [
    '文件被写入磁盘。',
    '你不能不备份。',
    '这不是不重要。',
    '这并非不需要确认。',
    '',
    '第一句说明范围。第二句说明对象。第三句说明限制。第四句说明结果。第五句说明例外。第六句说明下一步。第七句说明风险。',
  ].join('\n')
  const result = analyzeMarkdown(text, glossary)
  assert.equal(result.passive, 1)
  assert.equal(result.doubleNegatives, 3)
  assert.equal(result.longParagraphs, 1)
})

test('glossary table is the only source of banned synonyms', () => {
  const glossaryFile = loadGlossary(root)
  assert.ok(glossaryFile.banned.some(item => item.term === '主对话' && item.preferred === '主会话'))
  assert.ok(glossaryFile.allowances.includes('宿主版本'))
})

test('user guides pass the STE check', () => {
  assert.deepEqual(checkFailures(report(root)), [])
})
