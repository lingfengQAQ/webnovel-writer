import type { BookFormatVersionResult } from '../repo/book-format'
import type { DocumentUnitId } from '../repo/document-types'

export interface MaintenanceIssue {
  readonly 代码: string
  readonly 路径: string
  readonly 说明: string
  readonly 字段?: string
  readonly 行?: number
  readonly 来源形态?: string
}

/** Collapse exact duplicates only; different lines, fields and explanations remain visible. */
export function uniqueMaintenanceIssues(issues: readonly MaintenanceIssue[]): MaintenanceIssue[] {
  const seen = new Set<string>()
  return issues.filter(issue => {
    const key = JSON.stringify([issue.代码, issue.路径, issue.说明, issue.字段, issue.行, issue.来源形态])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface MaintenanceSnapshot {
  readonly 开始时间: string
  readonly 结束时间: string
  readonly 指纹: string
  readonly 稳定: boolean
  readonly 文件数: number
  readonly 目录数: number
  readonly 变更: readonly string[]
}

export interface DocumentInspection {
  readonly 路径: string
  readonly 文档类型: readonly DocumentUnitId[]
  readonly 检查: readonly string[]
  readonly 结果: '已检查' | '失败' | '部分检查'
  readonly 说明?: string
}

export interface UncheckedDocument {
  readonly 路径: string
  readonly 文档类型: readonly DocumentUnitId[]
  readonly 原因: string
}

export interface DocumentTypeCoverage {
  readonly 编号: DocumentUnitId
  readonly 名称: string
  readonly 能力: '结构检查' | '部分结构检查' | '未支持' | '公共语法'
  readonly 检查: readonly string[]
  readonly 文件数: number
}

export interface BookInspection {
  readonly 状态: '已检查' | '部分失败'
  readonly 结论: '未发现已知问题' | '需升级' | '需处理' | '未支持' | '无法核实'
  readonly 书仓格式: BookFormatVersionResult
  readonly 规则版本: number
  readonly 受检范围: readonly DocumentInspection[]
  readonly 未检范围: readonly UncheckedDocument[]
  readonly 类型覆盖: readonly DocumentTypeCoverage[]
  readonly 问题: readonly MaintenanceIssue[]
  readonly 快照: MaintenanceSnapshot
}
