import { useEffect, useState } from 'react'
import { formatTableValue } from '../lib/format.js'

function resolveRowKey(row, rowKey, index) {
    if (typeof rowKey === 'function') return rowKey(row, index)
    if (typeof rowKey === 'string' && row?.[rowKey] !== undefined) return row[rowKey]
    return index
}

export default function DataTable({
    columns,
    rows,
    rowKey = 'id',
    pageSize = 8,
    emptyText = '暂无数据',
    minWidth = 640,
}) {
    const [page, setPage] = useState(1)

    useEffect(() => {
        setPage(1)
    }, [rows, pageSize])

    if (!rows?.length) {
        return (
            <div className="empty-state compact">
                <p>{emptyText}</p>
            </div>
        )
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    const pageRows = rows.slice(start, start + pageSize)

    return (
        <>
            <div className="table-wrap">
                <table className="data-table" style={{ minWidth }}>
                    <thead>
                        <tr>
                            {columns.map(column => (
                                <th key={column.key}>{column.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((row, index) => (
                            <tr key={resolveRowKey(row, rowKey, index)}>
                                {columns.map(column => (
                                    <td
                                        key={column.key}
                                        className={column.className || ''}
                                        style={column.style || undefined}
                                    >
                                        {column.render
                                            ? column.render(row)
                                            : formatTableValue(row?.[column.key])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 ? (
                <div className="table-pagination">
                    <button
                        className="page-btn"
                        type="button"
                        onClick={() => setPage(current => Math.max(1, current - 1))}
                        disabled={safePage <= 1}
                    >
                        上一页
                    </button>
                    <span className="page-info">
                        第 {safePage}/{totalPages} 页 · 共 {rows.length} 条
                    </span>
                    <button
                        className="page-btn"
                        type="button"
                        onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                        disabled={safePage >= totalPages}
                    >
                        下一页
                    </button>
                </div>
            ) : null}
        </>
    )
}
