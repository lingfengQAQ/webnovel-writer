/**
 * 批次 1 冻结的章级旧格式存量清单（front matter 尚未迁到目标 schema）。
 * 目标 schema 见 design 3.1；本清单随批次 2（节拍）/ 3（场景）/ 5（追读）逐批清空，
 * 清单外的任何章级条目立即按目标 schema 严格校验。禁止向本清单新增文件。
 */
export const LEGACY_CHAPTER_ENTRIES = Object.freeze({
  节拍: Object.freeze([]),
  场景: Object.freeze([]),
  追读: Object.freeze([]),
  技法: Object.freeze([]),
})
