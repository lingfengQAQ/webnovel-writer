import { MEMORY_KINDS, validateSegment } from './paths'

export type DocumentUnitId =
  | 'I01' | 'I02' | 'I03' | 'I04' | 'I05' | 'I06' | 'I07' | 'I08' | 'I09'
  | 'I10' | 'I11' | 'I12' | 'I13' | 'I14' | 'I15' | 'I16' | 'I17' | 'I18' | 'I19'
  | 'I20' | 'I21' | 'I22' | 'I23' | 'I24' | 'I25' | 'I26' | 'I27' | 'I28' | 'I29'
  | 'I30' | 'I31' | 'I32' | 'I33' | 'I34' | 'I35'

export interface DocumentCodeReference {
  readonly file: string
  readonly symbols: readonly string[]
}

/** References describe existing contracts; they are not dynamically called validators. */
export interface DocumentContractDescriptor {
  readonly id: DocumentUnitId
  readonly title: string
  /** Persistence policy: source includes tracked indexes, not only narrative facts;
   * derived is disposable runtime cache, while runtime-control must be preserved. */
  readonly storage: 'source' | 'draft' | 'derived' | 'runtime-control' | 'protocol'
  readonly encoding: 'markdown' | 'json' | 'sqlite' | 'mixed'
  readonly implementation: 'implemented' | 'declared-only'
  readonly validation: 'domain-context' | 'syntax-only' | 'not-implemented'
  readonly producers: readonly DocumentCodeReference[]
  readonly consumers: readonly DocumentCodeReference[]
  readonly fieldDefinitionSources: readonly DocumentCodeReference[]
}

const ref = (file: string, ...symbols: string[]): DocumentCodeReference => ({
  file: file.startsWith('packages/') || file.startsWith('docs/') ? file : `packages/core/src/${file}`,
  symbols,
})
const contract = (
  id: DocumentUnitId,
  definition: Omit<DocumentContractDescriptor, 'id' | 'implementation' | 'validation'>
    & Partial<Pick<DocumentContractDescriptor, 'implementation' | 'validation'>>,
): DocumentContractDescriptor => ({ id, implementation: 'implemented', validation: 'domain-context', ...definition })

export const DOCUMENT_CONTRACTS: Readonly<Record<DocumentUnitId, DocumentContractDescriptor>> = {
  I01: contract('I01', {
    title: '作品契约', storage: 'source', encoding: 'markdown',
    producers: [ref('book/scaffold.ts', 'scaffoldBookFiles'), ref('design/contract.ts', 'prepareContract')],
    consumers: [ref('book/identity.ts', 'scanWorkspaceBooks'), ref('design/contract.ts', 'checkContractComplete')],
    fieldDefinitionSources: [ref('derive/design.ts', '契约六部'), ref('repo/book-format.ts', 'BOOK_FORMAT_VERSION_FIELD'), ref('design/chapter-length.ts', 'parseChapterLength')],
  }),
  I02: contract('I02', {
    title: '构想快照', storage: 'source', encoding: 'markdown',
    producers: [ref('inspire/concept.ts', 'serializeConcept'), ref('book/scaffold.ts', 'scaffoldBookFiles')],
    consumers: [ref('inspire/concept.ts', 'parseConcept', 'checkConceptCompleteness')],
    fieldDefinitionSources: [ref('inspire/concept.ts', 'Concept', '构想七要素', '构想必填要素')],
  }),
  I03: contract('I03', {
    title: '故事骨架', storage: 'source', encoding: 'markdown',
    producers: [ref('design/skeleton.ts', 'prepareSkeleton', 'prepareDesignDoc')],
    consumers: [ref('derive/design.ts', 'scanDesign')],
    fieldDefinitionSources: [ref('derive/design.ts', '故事骨架九部', '骨架当前必要分部'), ref('provenance/index.ts', 'VersionProtocol')],
  }),
  I04: contract('I04', {
    title: '分卷布局', storage: 'source', encoding: 'markdown',
    producers: [ref('design/skeleton.ts', 'prepareVolumeLayout', 'prepareDesignDoc')],
    consumers: [ref('derive/design.ts', 'parseVolumeAllocations')],
    fieldDefinitionSources: [ref('derive/design.ts', '分卷布局八部', 'parseVolumeAllocations'), ref('provenance/index.ts', 'VersionProtocol')],
  }),
  I05: contract('I05', {
    title: '卷纲', storage: 'source', encoding: 'markdown',
    producers: [ref('design/volume.ts', 'prepareVolumeOutline')],
    consumers: [ref('design/volume.ts', 'volumeOutlineGaps', 'checkVolumeReady')],
    fieldDefinitionSources: [ref('design/volume.ts', 'volumeOutlineGaps'), ref('design/skeleton.ts', 'prepareDesignDoc')],
  }),
  I06: contract('I06', {
    title: '计划时间线', storage: 'source', encoding: 'markdown',
    producers: [ref('design/volume.ts', 'preparePlanTimeline')],
    consumers: [ref('ledger/index.ts', 'reconcileLedger')],
    fieldDefinitionSources: [ref('ledger/index.ts', 'parsePlanItems'), ref('design/skeleton.ts', 'prepareDesignDoc')],
  }),
  I07: contract('I07', {
    title: '近期窗口', storage: 'source', encoding: 'markdown',
    producers: [ref('design/volume.ts', 'prepareRecentWindow')],
    consumers: [ref('derive/scan.ts', 'parseWindow')],
    fieldDefinitionSources: [ref('design/volume.ts', 'WindowItem'), ref('derive/scan.ts', 'parseWindow')],
  }),
  I08: contract('I08', {
    title: '候选细纲', storage: 'draft', encoding: 'markdown',
    producers: [ref('outline/write.ts', 'writeCandidate')],
    consumers: [ref('outline/parse.ts', 'parseOutline'), ref('outline/write.ts', 'checkConfirmable')],
    fieldDefinitionSources: [ref('outline/template.ts', '定位段小节', '单元字段'), ref('outline/write.ts', 'WriteCandidateInput')],
  }),
  I09: contract('I09', {
    title: '确认细纲', storage: 'source', encoding: 'markdown',
    producers: [ref('outline/write.ts', 'confirmOutline')],
    consumers: [ref('outline/parse.ts', 'parseOutline'), ref('derive/scan.ts', 'scanChapter')],
    fieldDefinitionSources: [ref('outline/template.ts', '定位段小节', '单元字段'), ref('outline/write.ts', 'confirmOutline')],
  }),
  I10: contract('I10', {
    title: '世界书模块声明', storage: 'source', encoding: 'markdown',
    producers: [ref('design/worldbook.ts', 'ensureModulesDeclared')],
    consumers: [ref('derive/design.ts', 'scanDesign')],
    fieldDefinitionSources: [ref('design/worldbook.ts', 'ensureModulesDeclared')],
  }),
  I11: contract('I11', {
    title: '世界书条目', storage: 'source', encoding: 'markdown',
    producers: [ref('design/worldbook.ts', 'prepareEntry'), ref('settlement/index.ts', 'factOps')],
    consumers: [ref('design/worldbook-history.ts', 'parseWorldbookHistory')],
    fieldDefinitionSources: [ref('repo/document-fields.ts', 'WORLDBOOK_INPUT_FIELDS'), ref('design/worldbook.ts', 'WorldbookEntryInput')],
  }),
  I12: contract('I12', {
    title: '可选世界书关系条目', storage: 'source', encoding: 'markdown',
    producers: [ref('design/worldbook.ts', 'prepareEntry'), ref('settlement/index.ts', 'factOps')],
    consumers: [ref('packages/bundle/src/study/graph.ts', 'readStoryGraph')],
    fieldDefinitionSources: [ref('repo/document-fields.ts', 'WORLDBOOK_INPUT_FIELDS'), ref('packages/bundle/src/study/graph.ts', '关系双方', '主体', '客体')],
  }),
  I13: contract('I13', {
    title: '故事线、人物弧线与承诺账本', storage: 'source', encoding: 'markdown',
    producers: [ref('settlement/index.ts', 'checkLedgerSectionFields', 'ledgerBlock')],
    consumers: [ref('ledger/index.ts', 'queryLedger')],
    fieldDefinitionSources: [ref('repo/ledger-field-contract.ts', 'LEDGER_FIELD_RULES', 'LEDGER_STATES'), ref('repo/paths.ts', 'LEDGER_KINDS')],
  }),
  I14: contract('I14', {
    title: '线索账本', storage: 'source', encoding: 'markdown',
    producers: [ref('settlement/index.ts', 'checkLedgerSectionFields', 'ledgerBlock')],
    consumers: [ref('ledger/index.ts', 'queryLedger'), ref('ledger/clue.ts', 'hasLegacyClueFields')],
    fieldDefinitionSources: [ref('repo/ledger-field-contract.ts', 'CLUE_FIELD_RULES', 'CLUE_STATES'), ref('ledger/clue.ts', 'hasLegacyClueFields')],
  }),
  I15: contract('I15', {
    title: '事实时间线', storage: 'source', encoding: 'markdown',
    producers: [ref('settlement/index.ts', 'parseTimelineSections', 'timelineBlock')],
    consumers: [ref('ledger/index.ts', 'queryLedger', 'renderTimelineContent')],
    fieldDefinitionSources: [ref('repo/document-fields.ts', 'DOCUMENT_FIELDS', 'TIMELINE_FIELD_KEYS')],
  }),
  I16: contract('I16', {
    title: '定稿章', storage: 'source', encoding: 'markdown',
    producers: [ref('prepare/pack.ts', 'computePack'), ref('commit/archive.ts', 'archiveChapter')],
    consumers: [ref('retrieval/source.ts', 'scanFinalized'), ref('export/index.ts', 'computeExport')],
    fieldDefinitionSources: [ref('prepare/pack.ts', 'computePack'), ref('retrieval/source.ts', 'scanFinalized')],
  }),
  I17: contract('I17', {
    title: '章摘要', storage: 'source', encoding: 'markdown',
    producers: [ref('prepare/pack.ts', 'computePack'), ref('commit/archive.ts', 'archiveChapter')],
    consumers: [ref('summary/index.ts', 'computeVolumeSummaryCandidate'), ref('assembly/assemble.ts', 'computeMaterials')],
    fieldDefinitionSources: [ref('prepare/pack.ts', '沉淀候选', 'computePack')],
  }),
  I18: contract('I18', {
    title: '卷摘要', storage: 'source', encoding: 'markdown',
    producers: [ref('design/volume.ts', 'prepareVolumeSummary')],
    consumers: [ref('summary/index.ts', 'computeVolumeSummaryCandidate'), ref('assembly/assemble.ts', 'computeMaterials')],
    fieldDefinitionSources: [ref('summary/index.ts', 'computeVolumeSummaryCandidate'), ref('design/volume.ts', 'prepareVolumeSummary')],
  }),
  I19: contract('I19', {
    title: '本书记忆单条目', storage: 'source', encoding: 'markdown',
    producers: [ref('memory/book.ts', 'bookMemoryOps', 'writeBookMemory')],
    consumers: [ref('ledger/index.ts', 'queryMemory'), ref('memory/book.ts', 'listBookMemoryEntries')],
    fieldDefinitionSources: [ref('memory/book.ts', 'BookMemoryInput'), ref('repo/book-memory-contract.ts', 'classifyBookMemoryDocument')],
  }),
  I20: contract('I20', {
    title: '本书记忆索引', storage: 'source', encoding: 'markdown',
    producers: [ref('memory/write.ts', 'memoryIndex'), ref('memory/book.ts', 'rebuildBookMemoryIndex')],
    consumers: [ref('memory/catalog.ts', 'readBookMemoryCatalog')],
    fieldDefinitionSources: [ref('repo/memory-index-links.ts', 'memoryIndexLink', 'parseMemoryIndexLinks'), ref('memory/catalog.ts', 'MemoryCatalog')],
  }),
  I21: contract('I21', {
    title: '旧分类记忆', storage: 'source', encoding: 'markdown',
    producers: [ref('book/scaffold.ts', 'scaffoldBookFiles')],
    consumers: [ref('ledger/index.ts', 'parseEntries', 'queryMemory')],
    fieldDefinitionSources: [ref('repo/book-memory-contract.ts', 'classifyBookMemoryDocument'), ref('repo/paths.ts', 'MEMORY_KINDS')],
  }),
  I22: contract('I22', {
    title: '草稿与候选事实', storage: 'draft', encoding: 'markdown',
    producers: [ref('repo/drafts.ts', 'composeBody'), ref('revise/apply.ts', 'applyRevision')],
    consumers: [ref('repo/drafts.ts', 'listChapterDrafts', 'splitCandidateFacts')],
    fieldDefinitionSources: [ref('repo/drafts.ts', '草稿字段序', 'DraftFile', 'CANDIDATE_HEADING')],
  }),
  I23: contract('I23', {
    title: '基础材料十段', storage: 'draft', encoding: 'markdown',
    producers: [ref('assembly/assemble.ts', 'computeMaterials')],
    consumers: [ref('assembly/read.ts', 'loadMaterialPackage')],
    fieldDefinitionSources: [ref('assembly/sections.ts', '材料包十段', 'SectionRecord')],
  }),
  I24: contract('I24', {
    title: '材料清单与补充', storage: 'draft', encoding: 'mixed',
    producers: [ref('assembly/supplements.ts', 'appendSupplements')],
    consumers: [ref('assembly/read.ts', 'parseMaterialManifest', 'loadMaterialPackage')],
    fieldDefinitionSources: [ref('assembly/sections.ts', 'SupplementRecord', 'SupplementSource'), ref('assembly/read.ts', 'ParsedMaterialManifest')],
  }),
  I25: contract('I25', {
    title: '审核记录', storage: 'draft', encoding: 'json',
    producers: [ref('packages/review/src/run.ts', 'runReview', 'ingestFindings')],
    consumers: [ref('derive/scan.ts', 'scanChapter', 'parseReview')],
    fieldDefinitionSources: [ref('packages/review/src/run.ts', 'runReview'), ref('derive/scan.ts', 'parseReview')],
  }),
  I26: contract('I26', {
    title: '待定稿包与清单', storage: 'draft', encoding: 'mixed',
    producers: [ref('prepare/pack.ts', 'computePack'), ref('commit/archive.ts', 'archiveRetconRequest')],
    consumers: [ref('settlement/index.ts', 'planSettlement'), ref('commit/archive.ts', 'archiveChapter')],
    fieldDefinitionSources: [ref('prepare/pack.ts', '待定稿包七件', '沉淀候选'), ref('commit/archive.ts', 'ArchiveOptions')],
  }),
  I27: contract('I27', {
    title: '连写批次声明', storage: 'protocol', encoding: 'json', implementation: 'declared-only', validation: 'not-implemented',
    producers: [], consumers: [], fieldDefinitionSources: [ref('docs/story-repo-spec.md', '批次.json')],
  }),
  I28: contract('I28', {
    title: '提案与裁决', storage: 'draft', encoding: 'markdown',
    producers: [ref('revise/proposal.ts', 'registerProposal', 'resolveProposal')],
    consumers: [ref('revise/proposal.ts', 'loadProposal')],
    fieldDefinitionSources: [ref('revise/proposal.ts', 'ProposalInput', '提案域', '提案类型', '提案状态')],
  }),
  I29: contract('I29', {
    title: '正式补偿事件', storage: 'source', encoding: 'markdown',
    producers: [ref('revise/proposal.ts', 'retconEventOps')],
    consumers: [ref('revise/proposal.ts', 'retconEventOps')],
    fieldDefinitionSources: [ref('revise/proposal.ts', 'RetconEventInput', 'RetconEventOp')],
  }),
  I30: contract('I30', {
    title: '归档、吃书与维护收据', storage: 'runtime-control', encoding: 'json',
    producers: [ref('commit/receipt.ts', 'makeArchiveReceipt', 'archiveReceiptOp'), ref('maintenance/upgrade-receipt.ts', 'makeUpgradeReceipt', 'serializeUpgradeReceipt')],
    consumers: [ref('commit/receipt.ts', 'readArchiveReceipt', 'verifyArchiveOutputs'), ref('maintenance/upgrade-receipt.ts', 'readUpgradeReceipt', 'verifyUpgradeOutputs')],
    fieldDefinitionSources: [ref('commit/receipt.ts', 'ArchiveReceipt'), ref('maintenance/upgrade-receipt.ts', 'UpgradeReceipt')],
  }),
  I31: contract('I31', {
    title: '共享语法与机器版本信封', storage: 'protocol', encoding: 'mixed', validation: 'syntax-only',
    producers: [ref('repo/frontmatter.ts', 'serializeDocument'), ref('repo/schema.ts', 'serializeMachineJson')],
    consumers: [ref('repo/frontmatter.ts', 'parseDocument'), ref('repo/schema.ts', 'parseMachineJson')],
    fieldDefinitionSources: [ref('repo/frontmatter.ts', 'COMMON_FIELD_KEYS'), ref('repo/schema.ts', 'MACHINE_SCHEMA_VERSION')],
  }),
  I32: contract('I32', {
    title: '定稿搜索缓存', storage: 'derived', encoding: 'sqlite',
    producers: [ref('retrieval/sync.ts', 'syncFinalizedIndex')],
    consumers: [ref('retrieval/search.ts', 'searchFinalized')],
    fieldDefinitionSources: [ref('retrieval/cache.ts', 'SearchCache')],
  }),
  I33: contract('I33', {
    title: '场景缓存', storage: 'derived', encoding: 'json',
    producers: [ref('retrieval/scenes.ts', 'writeSceneRecords')],
    consumers: [ref('retrieval/scenes.ts', 'readSceneRecords', 'currentSceneRecord')],
    fieldDefinitionSources: [ref('retrieval/scenes.ts', 'SceneRecord', 'validateSceneEnds')],
  }),
  I34: contract('I34', {
    title: '索引任务状态', storage: 'runtime-control', encoding: 'json',
    producers: [ref('retrieval/state.ts', 'writeIndexState', 'changeIndexState')],
    consumers: [ref('retrieval/state.ts', 'readIndexState')],
    fieldDefinitionSources: [ref('retrieval/state.ts', 'IndexSyncState')],
  }),
  I35: contract('I35', {
    title: '作者编辑收据', storage: 'runtime-control', encoding: 'json',
    producers: [ref('revise/document.ts', 'saveAuthorDocument')],
    consumers: [ref('revise/document.ts', 'readAuthorSave')],
    fieldDefinitionSources: [ref('revise/document.ts', 'AuthorSaveReceipt')],
  }),
}

export interface DocumentPathMatch {
  readonly units: readonly DocumentUnitId[]
  /** Needed to resolve/refine the candidate type; false never means domain-valid. */
  readonly requiresContent: boolean
  readonly pathForm: 'current' | 'historical'
}

const matched = (units: readonly DocumentUnitId[], requiresContent = false, pathForm: DocumentPathMatch['pathForm'] = 'current'): DocumentPathMatch => ({ units, requiresContent, pathForm })
const positive = (text: string): boolean => Number.isSafeInteger(Number(text)) && Number(text) > 0
const name = (text: string): boolean => validateSegment(text).length === 0
const volume = (text: string): boolean => /^卷\d{2,}$/.test(text) && positive(text.slice(1))
const chapterDirectory = (text: string): boolean => {
  const match = /^卷(\d{2,})-(.+)$/.exec(text)
  return match !== null && positive(match[1]!) && name(match[2]!)
}
const chapterFile = (text: string): boolean => {
  const match = /^(\d{4,})-(.+)\.md$/.exec(text)
  return match !== null && positive(match[1]!) && name(match[2]!)
}
const numberedMarkdown = (text: string, prefix: string): boolean => {
  const digits = text.startsWith(prefix) && text.endsWith('.md') ? text.slice(prefix.length, -3) : ''
  return /^\d{4,}$/.test(digits) && positive(digits)
}

// Exact routing names are checked against the existing producers in tests.
const PACK_FILES = new Set(['正文.md', '事实变更.md', '时间线变更.md', '账本变更.md', '章摘要.md', '卷对账.md', '本书层记忆候选.md', '清单.json'])
const MATERIAL_FILES = new Set([
  '01-本章任务与确认细纲.md', '02-硬约束禁区完成条件.md', '03-当前事实与连续性.md',
  '04-人物、关系、地点、组织、规则、物件.md', '05-时间位置与信息边界.md', '06-故事线承诺线索.md',
  '07-近期正文衔接.md', '08-文风〔条目切片〕.md', '09-暂定与警告.md', '10-来源与版本清单.md',
])

/** Route known file shapes only. This function performs no IO, parsing, migration or validation. */
export function classifyDocumentPath(relative: string): DocumentPathMatch | undefined {
  const normalized = relative.replace(/\\/g, '/')
  if (/[\x00-\x1f<>:"|?*]/.test(normalized)) return undefined
  const parts = normalized.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.trim() !== part)) return undefined
  const [first, second, third, fourth, fifth] = parts
  if (parts.length === 2) {
    const fixed: Readonly<Record<string, DocumentUnitId>> = {
      '作品契约/契约.md': 'I01', '构想/构想快照.md': 'I02',
      '大纲/故事骨架.md': 'I03', '大纲/分卷布局.md': 'I04', '世界书/模块声明.md': 'I10',
      '本书记忆/索引.md': 'I20', '.webnovel/finalized-search.sqlite': 'I32',
      '.webnovel/finalized-scenes.json': 'I33', '.webnovel/finalized-search-state.json': 'I34',
    }
    const id = fixed[normalized]
    if (id !== undefined) return matched([id])
    if (first === '账本') {
      if (second === '时间线.md') return matched(['I15'])
      if (second === '线索.md') return matched(['I14'])
      if (['故事线.md', '人物弧线.md', '承诺.md'].includes(second!)) return matched(['I13'])
    }
    if (first === '本书记忆' && /^.+\.md$/.test(second!) && name(second!.slice(0, -3))) {
      const categoryName = (MEMORY_KINDS as readonly string[]).includes(second!.slice(0, -3))
      return matched(categoryName ? ['I19', 'I21'] : ['I19'], true)
    }
  }
  if (first === '世界书' && parts.length === 3 && second !== '模块声明.md' && name(second!) && /^.+\.md$/.test(third!) && name(third!.slice(0, -3))) {
    return matched(second === '人物关系' ? ['I11', 'I12'] : ['I11'], true)
  }
  if (first === '大纲' && second === '卷规划' && volume(third!)) {
    if (parts.length === 4) {
      const names: Readonly<Record<string, DocumentUnitId>> = { '卷纲.md': 'I05', '计划时间线.md': 'I06', '近期窗口.md': 'I07', '卷摘要.md': 'I18' }
      const id = Object.hasOwn(names, fourth!) ? names[fourth!] : undefined
      if (id !== undefined) return matched([id])
    }
    if (parts.length === 5 && chapterFile(fifth!)) {
      if (fourth === '章细纲') return matched(['I09'])
      if (fourth === '章摘要') return matched(['I17'])
    }
  }
  if (first === '定稿' && volume(second!)) {
    if (parts.length === 3 && chapterFile(third!)) return matched(['I16'])
    if (parts.length === 4 && third === '补偿' && numberedMarkdown(fourth!, '补偿-')) return matched(['I29'])
  }
  if (first !== '草稿区') return undefined
  if (parts.length === 3) {
    if (second === '章细纲' && third!.endsWith('.md') && chapterDirectory(third!.slice(0, -3))) return matched(['I08'])
    if (second === '审核' && third!.endsWith('.json') && chapterDirectory(third!.slice(0, -5))) return matched(['I25'])
    if ((second === '.archive-receipts' || second === '.maintenance-receipts') && /^[a-f0-9]{64}\.json$/.test(third!)) return matched(['I30'])
    if (second === '.author-edits' && /^[A-Za-z0-9-]{16,80}\.json$/.test(third!)) return matched(['I35'])
    if (second === '提案') {
      if (numberedMarkdown(third!, '补偿-')) return matched(['I29'], false, 'historical')
      if (chapterFile(third!)) return matched(['I28'])
    }
  }
  if (second === '批次' && parts.length >= 4 && parts.at(-1) === '批次.json') return matched(['I27'])
  if (parts.length === 4 && PACK_FILES.has(fourth!)) {
    if (second === '定稿准备' && chapterDirectory(third!)) return matched(['I26'])
    if (second === '提案' && /^retcon-[a-f0-9]{64}$/.test(third!)) return matched(['I26'])
  }
  if (!chapterDirectory(third!)) return undefined
  if (second === '草稿' && parts.length === 4) {
    const file = process.platform === 'win32' ? fourth!.toLowerCase() : fourth!
    if (/^稿\d+\.md$/.test(file)) return matched(['I22'])
  }
  if (second === '材料包') {
    if (parts.length === 4 && MATERIAL_FILES.has(fourth!)) return matched(['I23'])
    if (parts.length === 4 && fourth === '材料清单.json') return matched(['I24'])
    if (parts.length === 5 && fourth === '补充' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md$/.test(fifth!)) return matched(['I24'])
  }
  return undefined
}
