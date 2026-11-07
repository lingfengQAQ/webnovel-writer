/**
 * 书仓路径(格式规格 §2)与路径白名单(机制 B2)。
 *
 * 规格即法:目录树以 docs/book-format.md 为唯一依据;
 * 进路径的字段(章名、条目名)一律白名单校验,防路径注入。
 */

export interface RepoPaths {
  readonly root: string
}

export const LEDGER_KINDS = ['故事线', '人物弧线', '承诺', '线索'] as const
export const LEDGER_NAMES = [...LEDGER_KINDS, '时间线'] as const
export const MEMORY_KINDS = ['文风', '决策', '对话', '灵感'] as const
export type LedgerName = (typeof LEDGER_NAMES)[number]
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** 中文卷号映射(全局唯一常量处;账本区间与分卷布局卷行解析共用,任务21 B2)。 */
export const CN_NUMERAL: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 目录树常量(格式规格 §2.1)。 */
export const LAYOUT = {
  契约: '作品契约',
  构想: '构想',
  大纲: '大纲',
  卷规划: (卷: number) => `大纲/卷规划/卷${pad(卷)}`,
  世界书: '世界书',
  定稿: (卷: number) => `定稿/卷${pad(卷)}`,
  账本: '账本',
  本书记忆: '本书记忆',
  草稿区: '草稿区',
} as const

/** 草稿区子目录(格式规格 §9.1,七项全可丢弃)。 */
export const DRAFT_DIRS = [
  '章细纲', '草稿', '材料包', '审核', '定稿准备', '批次', '提案',
] as const

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 章号四位(格式规格 §2.2)。 */
export function chapterNo(n: number): string {
  return String(n).padStart(4, '0')
}

/** Windows 保留名(不带扩展名视角)。 */
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 1 }, () => '').slice(0, 0),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [`COM${i}`, `LPT${i}`]),
])

/** 路径段白名单校验(机制 B2):非法字符、保留名、长度、首尾空白。 */
export function validateSegment(name: string): ReadonlyArray<string> {
  const problems: string[] = []
  if (name !== name.trim()) problems.push('首尾含空白')
  if (name.length === 0) problems.push('为空')
  if (name.length > 100) problems.push('超过 100 字符')
  if (/[\x00-\x1f<>:"/\\|?*]/.test(name)) problems.push('含非法字符(控制符或 <>:"/\\|?*)')
  if (name === '.' || name === '..') problems.push('为路径保留段')
  if (RESERVED.has(name.toUpperCase())) problems.push('为系统保留名')
  if (/[. ]$/.test(name)) problems.push('以点或空格结尾(Windows 不允许)')
  return problems
}

/** 断言式校验:不合法即抛错(写入器入口统一调用)。 */
export function assertSegment(name: string, field: string): void {
  const problems = validateSegment(name)
  if (problems.length > 0) {
    throw new Error(`路径字段「${field}」不合法：${problems.join(';')}。请换一个名称`)
  }
}

/** 常用路径构造(相对书仓根,正斜杠)。 */
export const paths = {
  契约: () => '作品契约/契约.md',
  构想快照: () => '构想/构想快照.md',
  故事骨架: () => '大纲/故事骨架.md',
  分卷布局: () => '大纲/分卷布局.md',
  卷纲: (卷: number) => `${LAYOUT.卷规划(卷)}/卷纲.md`,
  计划时间线: (卷: number) => `${LAYOUT.卷规划(卷)}/计划时间线.md`,
  近期窗口: (卷: number) => `${LAYOUT.卷规划(卷)}/近期窗口.md`,
  确认细纲: (卷: number, 章: number, 章名: string) =>
    `${LAYOUT.卷规划(卷)}/章细纲/${chapterNo(章)}-${章名}.md`,
  章摘要: (卷: number, 章: number, 章名: string) =>
    `${LAYOUT.卷规划(卷)}/章摘要/${chapterNo(章)}-${章名}.md`,
  卷摘要: (卷: number) => `${LAYOUT.卷规划(卷)}/卷摘要.md`,
  定稿章: (卷: number, 章: number, 章名: string) =>
    `${LAYOUT.定稿(卷)}/${chapterNo(章)}-${章名}.md`,
  账本: (名: LedgerName) => `账本/${名}.md`,
  /** @deprecated 旧格式(一类一文件)读侧兼容;新写入走 本书记忆条目/本书记忆索引。 */
  记忆: (类: MemoryKind) => `本书记忆/${类}.md`,
  本书记忆条目: (名: string) => `本书记忆/${名}.md`,
  本书记忆索引: () => '本书记忆/索引.md',
  候选细纲: (卷: number, 章名: string) => `草稿区/章细纲/卷${pad(卷)}-${章名}.md`,
  材料包目录: (卷: number, 章名: string) => `草稿区/材料包/卷${pad(卷)}-${章名}`,
  草稿目录: (卷: number, 章名: string) => `草稿区/草稿/卷${pad(卷)}-${章名}`,
  待定稿包目录: (卷: number, 章名: string) => `草稿区/定稿准备/卷${pad(卷)}-${章名}`,
  审核记录: (卷: number, 章名: string) => `草稿区/审核/卷${pad(卷)}-${章名}.json`,
} as const
