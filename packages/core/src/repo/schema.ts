/**
 * 机器态 JSON 版本纪律(机制 B8):必须带 schemaVersion,遇未知即拒绝。
 */

import type { ReadResult } from './frontmatter'

export const MACHINE_SCHEMA_VERSION = 1
export const KNOWN_SCHEMA_VERSIONS = [MACHINE_SCHEMA_VERSION] as const

export type MachineRecord = Record<string, unknown> & { readonly schemaVersion: number }

export function isKnownSchemaVersion(version: number): boolean {
  return (KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(version)
}

/** 解析机器态 JSON:非法 / 缺版本 / 未知或不匹配一律 parse-error,不静默接受。 */
export function parseMachineJson(text: string, expectedVersion: number): ReadResult<MachineRecord> {
  if (!isKnownSchemaVersion(expectedVersion)) {
    return { ok: false, reason: 'parse-error', detail: `未知 schemaVersion:${expectedVersion}(B8)` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (err) {
    return { ok: false, reason: 'parse-error', detail: `JSON 解析失败:${String(err)}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'parse-error', detail: '机器态 JSON 顶层必须是对象' }
  }
  const obj = parsed as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(obj, 'schemaVersion')) {
    return { ok: false, reason: 'parse-error', detail: '缺 schemaVersion' }
  }
  const ver = obj['schemaVersion']
  if (typeof ver !== 'number' || !Number.isInteger(ver)) {
    return { ok: false, reason: 'parse-error', detail: `schemaVersion 非法:${String(ver)}` }
  }
  if (!isKnownSchemaVersion(ver)) {
    return { ok: false, reason: 'parse-error', detail: `未知 schemaVersion:${ver}(B8)` }
  }
  if (ver !== expectedVersion) {
    return { ok: false, reason: 'parse-error', detail: `schemaVersion 不匹配:期望 ${expectedVersion},实际 ${ver}` }
  }
  return { ok: true, data: obj as MachineRecord }
}

/** 序列化:始终写入 schemaVersion。 */
export function serializeMachineJson(data: Readonly<Record<string, unknown>>, version: number): string {
  if (!isKnownSchemaVersion(version)) {
    throw new Error(`未知 schemaVersion:${version}(B8)`)
  }
  const { schemaVersion: _ignored, ...rest } = data
  return JSON.stringify({ schemaVersion: version, ...rest })
}
