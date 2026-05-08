export default function Pager({
    page,
    totalPages,
    currentStart,
    currentEnd,
    totalItems,
    onPrevious,
    onNext,
    onLatest,
    stepLabel = '50',
}) {
    if (totalItems <= 0) return null

    return (
        <div className="pager">
            <button className="page-btn" type="button" onClick={onPrevious} disabled={page <= 1}>
                ← 前 {stepLabel}
            </button>
            <span className="page-info">
                第 {currentStart}-{currentEnd} 章 · 第 {page}/{totalPages} 页
            </span>
            <div className="pager-actions">
                <button className="page-btn" type="button" onClick={onNext} disabled={page >= totalPages}>
                    下一页 →
                </button>
                <button className="page-btn" type="button" onClick={onLatest} disabled={page >= totalPages}>
                    跳到最新 →
                </button>
            </div>
        </div>
    )
}
