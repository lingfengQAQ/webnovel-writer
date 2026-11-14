import type { JsonSchemaNode, ToolOutputDefinition } from '@deepseek-ai/dsh-tools'

const text = { type: 'string' } as const
const texts: JsonSchemaNode = { type: 'array', items: text }
const issue: JsonSchemaNode = {
  type: 'object', additionalProperties: false,
  properties: { 代码: text, 路径: text, 说明: text, 字段: text, 行: { type: 'integer' }, 来源形态: text },
  required: ['代码', '路径', '说明'],
}
const snapshot: JsonSchemaNode = {
  type: 'object', additionalProperties: false,
  properties: { 开始时间: text, 结束时间: text, 指纹: text, 稳定: { type: 'boolean' }, 文件数: { type: 'integer' }, 目录数: { type: 'integer' }, 变更: texts },
  required: ['开始时间', '结束时间', '指纹', '稳定', '文件数', '目录数', '变更'],
}
const format: JsonSchemaNode = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', const: true }, version: { type: 'integer', const: 1 } }, required: ['ok', 'version'] },
    { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', const: false }, kind: { type: 'string', enum: ['unversioned', 'invalid-format', 'unsupported-version', 'missing', 'read-error'] }, reason: text, version: { type: 'integer' } }, required: ['ok', 'kind', 'reason'] },
  ],
}

/** Domain results are complete, or explicitly unavailable; absence is never a healthy result. */
export const BOOK_INSPECTION_OUTPUT_SCHEMA: JsonSchemaNode = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: {
        状态: { type: 'string', enum: ['已检查', '部分失败'] },
        结论: { type: 'string', enum: ['未发现已知问题', '需升级', '需处理', '未支持', '无法核实'] },
        书仓格式: format, 规则版本: { type: 'integer' },
        受检范围: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 路径: text, 文档类型: texts, 检查: texts, 结果: { type: 'string', enum: ['已检查', '失败', '部分检查'] }, 说明: text }, required: ['路径', '文档类型', '检查', '结果'] } },
        未检范围: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 路径: text, 文档类型: texts, 原因: text }, required: ['路径', '文档类型', '原因'] } },
        类型覆盖: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 编号: text, 名称: text, 能力: { type: 'string', enum: ['结构检查', '部分结构检查', '未支持', '公共语法'] }, 检查: texts, 文件数: { type: 'integer' } }, required: ['编号', '名称', '能力', '检查', '文件数'] } },
        问题: { type: 'array', items: issue }, 提示: { type: 'array', items: issue }, 快照: snapshot,
      },
      required: ['状态', '结论', '书仓格式', '规则版本', '受检范围', '未检范围', '类型覆盖', '问题', '快照'],
    },
    { type: 'object', additionalProperties: false, properties: { 状态: { type: 'string', enum: ['未检查', '部分失败'] }, 原因: text }, required: ['状态', '原因'] },
  ],
}
const opening: JsonSchemaNode = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: {
        状态: { type: 'string', enum: ['边界已核对', '需恢复', '无法核实'] }, 规则版本: { type: 'integer', const: 1 },
        问题: { type: 'array', items: issue },
        提示: { type: 'array', items: issue },
        在途项: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { 路径: text, 种类: text, 说明: text }, required: ['路径', '种类', '说明'] } },
        前章: { type: 'object', additionalProperties: false, properties: { 卷: { type: 'integer' }, 章: { type: 'integer' }, 章名: text }, required: ['卷', '章', '章名'] },
        快照: snapshot,
      },
      required: ['状态', '规则版本', '问题', '在途项', '快照'],
    },
    { type: 'object', additionalProperties: false, properties: { 状态: { type: 'string', const: '无法核实' }, 原因: text }, required: ['状态', '原因'] },
  ],
}

export const MAINTENANCE_PARAMETERS = {
  type: 'object', additionalProperties: false,
  properties: { bookId: { type: 'string', description: '当前工作范围内的书id，只核对这本书，不指定或创建新章' } },
  required: ['bookId'],
} satisfies JsonSchemaNode

export const MAINTENANCE_OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: '是否取得本次只读结果，不代表书仓健康或章节已开始' }, bookId: text,
      状态读取: { type: 'object', properties: { ok: { type: 'boolean' }, design: { type: 'object' }, chapters: { type: 'array', items: { type: 'object' } }, 书仓诊断: texts, reason: text, code: text, next: text }, required: ['ok'] },
      开章核对: opening, 书仓检查: BOOK_INSPECTION_OUTPUT_SCHEMA, 待核对: texts,
      message: text, reason: text,
    },
    required: ['ok'],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
} satisfies ToolOutputDefinition
