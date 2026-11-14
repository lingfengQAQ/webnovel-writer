import type { JsonSchemaNode, ToolOutputDefinition } from '@deepseek-ai/dsh-tools'

const text = { type: 'string' } as const
const texts: JsonSchemaNode = { type: 'array', items: text }
const chapterProperties = {
  // The DSH schema subset has no `minimum`; the tool rejects non-positive numbers before reading the book.
  卷: { type: 'integer', description: '已有定稿章的卷号（正整数）' },
  章: { type: 'integer', description: '已有定稿章的全书连续章号（正整数）' },
  章名: { type: 'string', description: '已有定稿章的完整章名' },
} satisfies Record<string, JsonSchemaNode>
const chapter: JsonSchemaNode = { type: 'object', additionalProperties: false, properties: chapterProperties, required: ['卷', '章', '章名'] }
const issue: JsonSchemaNode = {
  type: 'object', additionalProperties: false,
  properties: { 代码: text, 路径: text, 说明: text, 字段: text, 行: { type: 'integer' }, 来源形态: text },
  required: ['代码', '路径', '说明'],
}
const manifest: JsonSchemaNode = {
  type: 'object', additionalProperties: false,
  properties: {
    schema: { type: 'integer', const: 1 }, bookId: text, chapter, directory: text, sourceDraft: text, sourceProseSha256: text,
    files: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { relPath: text, kind: { type: 'string', enum: ['draft', 'staging'] }, sha256: text },
      required: ['relPath', 'kind', 'sha256'],
    } },
  },
  required: ['schema', 'bookId', 'chapter', 'directory', 'sourceDraft', 'sourceProseSha256', 'files'],
}
const parameters = { bookId: { type: 'string', description: '当前工作范围内的非空书id' }, ...chapterProperties } satisfies Record<string, JsonSchemaNode>
export const DRAFT_RETENTION_PREVIEW_PARAMETERS = {
  type: 'object', additionalProperties: false, properties: parameters, required: ['bookId', '卷', '章', '章名'],
} satisfies JsonSchemaNode
export const DRAFT_RETENTION_CONFIRM_PARAMETERS = {
  type: 'object', additionalProperties: false,
  properties: { ...parameters, fingerprint: { type: 'string', description: '本次只读预览返回的64位小写十六进制指纹，原样传入' } },
  required: ['bookId', '卷', '章', '章名', 'fingerprint'],
} satisfies JsonSchemaNode
const properties = {
  ok: { type: 'boolean' }, maintenance: { type: 'string', const: 'draft-retention' }, bookId: text, chapter,
  state: text, action: { type: 'string', enum: ['confirm', 'resume'] }, fingerprint: text, operationId: text, baseHead: text, commit: text,
  manifest, change: { type: 'object', additionalProperties: false, properties: { relPath: text, before: text, after: text }, required: ['relPath', 'before', 'after'] },
  issues: { type: 'array', items: issue }, notices: { type: 'array', items: issue }, paths: texts,
  message: text, reason: text, code: text, next: text,
} satisfies Record<string, JsonSchemaNode>
const render: ToolOutputDefinition['render'] = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

export const DRAFT_RETENTION_PREVIEW_OUTPUT = {
  schema: { oneOf: [
    { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: true }, state: { type: 'string', enum: ['ready', 'unchanged'] } }, required: ['ok', 'state', 'maintenance', 'chapter', 'issues', 'notices'] },
    { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: false }, state: { type: 'string', const: 'blocked' } }, required: ['ok', 'reason'] },
  ] }, render,
} satisfies ToolOutputDefinition
export const DRAFT_RETENTION_CONFIRM_OUTPUT = {
  schema: { oneOf: [
    { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: true }, state: { type: 'string', enum: ['committed', 'already-committed'] } }, required: ['ok', 'state', 'maintenance'] },
    { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: false }, state: { type: 'string', enum: ['written-pending-commit', 'blocked'] } }, required: ['ok', 'reason'] },
  ] }, render,
} satisfies ToolOutputDefinition
