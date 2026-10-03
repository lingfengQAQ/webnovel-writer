export const skills = ['novel-director', 'novel-inspiration', 'novel-design', 'novel-outline', 'novel-drafting', 'novel-review', 'novel-polish', 'novel-revision', 'novel-settle', 'novel-export', 'novel-analyze']
/** Dispatch references must travel with the skills that consume them. */
export const referenceDocs = [
  ...['导入与覆盖', '事实提取', '机制与灵感'].map(name => `skills/novel-analyze/工序/${name}.md`),
  ...['全量', '章节结构', '人物与关系', '情节与因果', '信息披露', '线索与伏笔', '节奏与张力', '读者承诺', '文风与表达']
    .map(name => `skills/novel-review/底本/${name}审读.md`),
  ...['1-表达清理', '2-节奏与重塑', '3-平台格式'].map(name => `skills/novel-polish/工序/${name}.md`),
  'skills/novel-revision/底本/改稿章程.md',
  'skills/novel-settle/底本/沉淀对账.md',
]
export const thinScripts = [
  ['skills/novel-review/scripts/确定性检查.mjs', 'runChecksCli'],
  ['skills/novel-design/scripts/影响分析.mjs', 'analyzeImpactCli'],
  ['skills/novel-outline/scripts/影响分析.mjs', 'analyzeImpactCli'],
  ['skills/novel-outline/scripts/材料备料.mjs', 'materialsCli'],
  ['skills/novel-settle/scripts/定稿备包.mjs', 'packCli'],
  ['skills/novel-settle/scripts/卷摘要候选.mjs', 'volumeSummaryCli'],
  ['skills/novel-export/scripts/最小导出.mjs', 'exportCli'],
]
