import type { JsonSchemaNode, ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import { BOOK_INSPECTION_OUTPUT_SCHEMA } from './maintenance-output'

const text = { type: 'string' } as const
const texts: JsonSchemaNode = { type: 'array', items: text }
const bookId = { type: 'string', description: '当前工作范围内的非空书id' } as const
const fingerprint = { type: 'string', description: '只读预览返回的64位小写十六进制计划指纹，原样传入' } as const
const operationId = { type: 'string', description: '原维护结果或预览列出的64位小写十六进制操作编号，原样传入' } as const

export const BOOK_UPGRADE_PREVIEW_PARAMETERS = {
  type: 'object', additionalProperties: false, properties: { bookId }, required: ['bookId'],
} satisfies JsonSchemaNode
export const BOOK_UPGRADE_APPLY_PARAMETERS = {
  type: 'object', additionalProperties: false, properties: { bookId, fingerprint }, required: ['bookId', 'fingerprint'],
} satisfies JsonSchemaNode
export const BOOK_UPGRADE_RESUME_PARAMETERS = {
  type: 'object', additionalProperties: false, properties: { bookId, operationId }, required: ['bookId', 'operationId'],
} satisfies JsonSchemaNode

const properties = {
  ok: { type: 'boolean' }, maintenance: { type: 'string', const: 'book-upgrade' },
  bookId: text, state: text, fingerprint: text, operationId: text, baseHead: text, commit: text,
  ruleVersion: { type: 'integer', const: 2 },
  changes: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: { relPath: text, before: { oneOf: [text, { type: 'null' }] }, after: text, rules: texts, evidence: texts },
    required: ['relPath', 'before', 'after', 'rules', 'evidence'],
  } },
  activeWork: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 路径: text, 种类: text, 说明: text }, required: ['路径', '种类', '说明'] } },
  effects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: text, sources: texts, reason: text }, required: ['path', 'sources', 'reason'] } },
  issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 代码: text, 路径: text, 说明: text, 字段: text, 行: { type: 'integer' }, 来源形态: text }, required: ['代码', '路径', '说明'] } },
  notices: { type: 'array', description: '单独呈报的留档提示，不构成执行阻断', items: { type: 'object', additionalProperties: false, properties: { 代码: text, 路径: text, 说明: text, 字段: text, 行: { type: 'integer' }, 来源形态: text }, required: ['代码', '路径', '说明'] } },
  inspectionBefore: { ...BOOK_INSPECTION_OUTPUT_SCHEMA, description: '当前原书的只读检查；旧格式问题保留在这里' },
  inspectionAfter: { ...BOOK_INSPECTION_OUTPUT_SCHEMA, description: '拟写字节的内存检查，不代表已写入或原书当前健康' },
  expectedStaleIssues: { type: 'array', description: '仅本计划造成的预期材料过期；仍列在检查后态，不计为执行阻断', items: { type: 'object', additionalProperties: false, properties: { 代码: text, 路径: text, 说明: text, 字段: text, 行: { type: 'integer' }, 来源形态: text }, required: ['代码', '路径', '说明'] } },
  resumable: texts, paths: texts, message: text, reason: text, code: text, next: text,
} satisfies Record<string, JsonSchemaNode>
const render: ToolOutputDefinition['render'] = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

export const BOOK_UPGRADE_PREVIEW_OUTPUT = {
  schema: {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: true }, state: { type: 'string', enum: ['ready', 'unchanged', 'blocked'] } }, required: ['ok', 'state', 'maintenance', 'ruleVersion', 'changes', 'effects', 'issues', 'resumable'] },
      { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: false } }, required: ['ok', 'reason'] },
    ],
  }, render,
} satisfies ToolOutputDefinition

export const BOOK_UPGRADE_WRITE_OUTPUT = {
  schema: {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: true }, state: { type: 'string', enum: ['committed', 'already-committed', 'recovered'] } }, required: ['ok', 'state', 'maintenance'] },
      { type: 'object', additionalProperties: false, properties: { ...properties, ok: { type: 'boolean', const: false }, state: { type: 'string', enum: ['written-pending-commit', 'blocked'] } }, required: ['ok', 'reason'] },
    ],
  }, render,
} satisfies ToolOutputDefinition
