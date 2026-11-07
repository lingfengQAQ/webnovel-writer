/** Reproduce historical serializer outputs; never opens an author's book. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceManifest = []
function historical(commit, relative, names, output) {
  const bytes = execFileSync('git', ['show', `${commit}:${relative}`], { cwd: root, windowsHide: true })
  const fullCommit = execFileSync('git', ['rev-parse', `${commit}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const blob = execFileSync('git', ['rev-parse', `${commit}:${relative}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const source = bytes.toString('utf8'), ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  const selected = names === null ? source : ast.statements.filter(statement =>
    (ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text))
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))))
    .map(statement => source.slice(statement.getStart(ast), statement.end)).join('\n\n') + '\n'
  if (!selected.trim()) throw new Error(`No source selected for ${relative}`)
  fs.writeFileSync(path.join(directory, output), selected)
  sourceManifest.push({ file: output, sourceCommit: fullCommit, sourcePath: relative, sourceBlob: blob, sourceSha256: hash(bytes), extractedNames: names, sha256: hash(selected) })
  return selected
}
function run(source, exportNames, context = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const sandbox = { exports: {}, ...context }
  vm.runInNewContext(js + `\nexports.selected = { ${exportNames.map(name => `${name}: typeof ${name} === 'undefined' ? exports.${name} : ${name}`).join(',')} };`, sandbox, { timeout: 1000 })
  return sandbox.exports.selected
}

const oldPaths = historical('d6659e09715f67ec6481fc075ffa552574854b41', 'packages/core/src/repo/paths.ts', null, 'history-paths.ts.txt')
const pathFunctions = run(oldPaths, ['paths', 'assertSegment'])
const legacyPaths = pathFunctions.paths
const clueSource = historical('d6659e09715f67ec6481fc075ffa552574854b41', 'packages/core/src/settlement/index.ts', ['checkLedgerSectionFields', 'ledgerBlock', 'extractField', 'stripFields'], 'history-clue.ts.txt')
const clueProducer = run(clueSource, ['ledgerBlock'], { paths: legacyPaths, sectionLine: new WeakMap(), parseFail: (...args) => { throw new Error(JSON.stringify(args)) } })
const memorySource = historical('dc0a5d8638e0a6bbc6d8b90e6fd4f09ee8ef2ea9', 'packages/core/src/settlement/index.ts', ['memoryBlock', 'extractField', 'stripFields'], 'history-memory.ts.txt')
const memoryProducer = run(memorySource, ['memoryBlock'])
const timelineSource = historical('23d3e5ab', 'packages/core/src/settlement/index.ts', ['timelineBlock', 'withoutLeadingFields', 'TIMELINE_FIELDS'], 'history-timeline.ts.txt')
const leadSource = historical('23d3e5ab', 'packages/core/src/ledger/clue.ts', ['leadingFields', 'FIELD_RE'], 'history-leading-fields.ts.txt')
const timelineProducer = run(leadSource + '\n' + timelineSource, ['timelineBlock'])
const frontmatterSource = historical('23d3e5ab', 'packages/core/src/repo/frontmatter.ts', ['parseDocument', 'serializeDocument', 'COMMON_FIELD_KEYS', 'FM_OPEN', 'FM_CLOSE'], 'history-frontmatter.ts.txt')
const frontmatter = run(frontmatterSource, ['parseDocument', 'serializeDocument'], { yamlParse, yamlStringify })
const indexSource = historical('23d3e5ab', 'packages/core/src/memory/write.ts', ['memoryIndex'], 'history-index.ts.txt')
const indexProducer = run(indexSource, ['memoryIndex'], { parseDocument: frontmatter.parseDocument, path, MemoryWriteError: Error })
const versionsSource = historical('23d3e5ab', 'packages/core/src/provenance/index.ts', ['extractVersionFields', 'applyVersionFields', 'initialVersion', 'bumpVersion'], 'history-versions.ts.txt')
const versions = run(versionsSource, ['extractVersionFields', 'applyVersionFields', 'initialVersion', 'bumpVersion'])
const factSource = historical('23d3e5ab', 'packages/core/src/settlement/index.ts', ['factOps', 'readExisting'], 'history-worldbook.ts.txt')
const chapter = { 卷: 1, 章: 3, 章名: '渡口' }, source = '定稿/卷01/0003-渡口.md', decision = '作者批准：历史夹具'
const inputs = {
  clue: { kind: '线索', title: '渡口印记', body: '状态：已埋\n计划来源：本章新增\n埋设点：第0003章\n预期兑现区间：第4-8章\n石上留有半枚印记。' },
  timeline: { title: '渡口会面', body: '事件：林舟在渡口遇见摆渡人\n时点：次日清晨\n两人相约第三次潮落后出发。' },
  memory: { kind: '决策', title: '保留渡口视角', body: '类：决策\n状态：候选\n保留摆渡人的观察，不提前写明他的来历。' },
  index: [{ relPath: '本书记忆/%41.md', text: frontmatter.serializeDocument({ 名称: '%41', 类: '对话', 来源: '作者对谈' }, '百分号是文件名的一部分。') }],
  worldbook: {
    before: frontmatter.serializeDocument({ 名称: '林舟', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创', 版本: 3 }, '更正前的计划。'),
    sections: [{ module: '人物档案', title: '林舟', body: '更正后的事实。' }], mode: '更正',
  },
}
const worldbookProducer = run(factSource, ['factOps'], {
  ...frontmatter, ...versions, paths: legacyPaths, path, assertSegment: pathFunctions.assertSegment,
  fs: {
    existsSync: target => target === path.join('fixture-book', '世界书', '人物档案'),
    statSync: target => ({ isDirectory: () => target === path.join('fixture-book', '世界书', '人物档案') }),
    readFileSync: target => { if (target === path.join('fixture-book', '世界书/人物档案/林舟.md')) return inputs.worldbook.before; throw new Error('Unknown fixture path') },
  },
})
const outputs = {
  'historical-clue.md': '# 线索\n\n' + clueProducer.ledgerBlock(inputs.clue, chapter, source, decision),
  'historical-timeline.md': '# 时间线\n\n' + timelineProducer.timelineBlock(inputs.timeline, chapter, source, decision),
  'historical-memory.md': '# 决策\n\n' + memoryProducer.memoryBlock(inputs.memory, chapter, source, decision),
  'historical-index.md': indexProducer.memoryIndex('本书记忆索引', inputs.index, []),
  'historical-worldbook.md': worldbookProducer.factOps('fixture-book', inputs.worldbook.sections, chapter, inputs.worldbook.mode)[0].content,
}
for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(directory, name), text)
fs.writeFileSync(path.join(directory, 'history-manifest.json'), JSON.stringify({
  schema: 1, evidence: 'G: original historical serializer functions executed with explicit synthetic input; not a real book or full historical runtime',
  sourceManifest, inputs: { chapter, source, decision, ...inputs },
  adaptation: 'The original clue validator is executed. Its line-number WeakMap is empty; its diagnostic thrower is a fixture function. Worldbook file reads use an explicit in-memory input map. Original frontmatter and version helpers execute unchanged with the installed YAML library. No output-producing function is replaced.',
  outputs: Object.entries(outputs).map(([file, text]) => ({ file, sha256: hash(text) })),
}, null, 2) + '\n')
