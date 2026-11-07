/**
 * 故事骨架与分卷布局写入器(格式规格 §3.2):设计侧覆盖式写入,版本协议沿用 provenance。
 * 写入器只写文件不碰 git;提交由工具层在作者确认时经 commitConfirmed 执行(拍板 1/7)。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { writeFileAtomic, type FileOp } from '../repo/atomic'
import { applyVersionFields, bumpVersion, initialVersion } from '../provenance'
import { paths } from '../repo/paths'
import { bookWriter } from '../repo/atomic'
import { volumeAllocationConflict } from '../derive/design'

function readTextOrNull(bookRoot: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(bookRoot, rel), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export interface DesignWriteResult {
  readonly relPath: string
  readonly 版本: number
  readonly 首次写入: boolean
}

/** 设计文档覆盖式准备(版本协议:首次 v1、正文变化 +1、原样重跑复用版本);只读旧文件,不写盘。 */
export function prepareDesignDoc(bookRoot: string, rel: string, body: string, 生成模块: string): FileOp & { result: DesignWriteResult } {
  const prevText = readTextOrNull(bookRoot, rel)
  const 首次写入 = prevText === null
  const base = { 状态: '已确认' }
  const prev = prevText === null ? undefined : parseDocument(prevText)
  if (prev !== undefined && !prev.ok) throw new Error(`${rel} 解析失败：${prev.detail}`)
  const previous = prev?.ok ? prev.data : undefined
  const prevVersion = typeof previous?.fields['版本'] === 'number' ? previous.fields['版本'] : 1
  // A retry after a successful write must not create another version before committing.
  if (previous?.fields['状态'] === '已确认'
    && serializeDocument({}, previous.body) === serializeDocument({}, body)) {
    return { relPath: rel, content: prevText!, result: { relPath: rel, 版本: prevVersion, 首次写入: false } }
  }
  const { 来源快照: _unchangedSource, ...revision } = bumpVersion(prevVersion, 生成模块)
  const fields =
    prevText === null
      ? applyVersionFields(base, initialVersion(生成模块, null))
      : { ...previous!.fields, ...base, ...revision }
  return { relPath: rel, content: serializeDocument(fields, body), result: { relPath: rel, 版本: Number(fields['版本']), 首次写入 } }
}

export function prepareSkeleton(bookRoot: string, body: string) {
  return prepareDesignDoc(bookRoot, paths.故事骨架(), body, '骨架更新')
}

export function prepareVolumeLayout(bookRoot: string, body: string) {
  const conflict = volumeAllocationConflict(body)
  if (conflict) throw new Error(`${paths.分卷布局()}：${conflict}`)
  return prepareDesignDoc(bookRoot, paths.分卷布局(), body, '分卷更新')
}

/** 更新故事骨架(真源,覆盖式;正文变化版本+1,原样重跑复用版本)。 */
function updateSkeletonLocked(bookRoot: string, body: string): DesignWriteResult {
  const op = prepareSkeleton(bookRoot, body)
  writeFileAtomic(bookRoot, op.relPath, op.content)
  return op.result
}

export const updateSkeleton = bookWriter(updateSkeletonLocked)

/** 更新分卷布局(真源,覆盖式;正文变化版本+1,原样重跑复用版本)。 */
function updateVolumeLayoutLocked(bookRoot: string, body: string): DesignWriteResult {
  const op = prepareVolumeLayout(bookRoot, body)
  writeFileAtomic(bookRoot, op.relPath, op.content)
  return op.result
}

export const updateVolumeLayout = bookWriter(updateVolumeLayoutLocked)
