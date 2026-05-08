const RESOLVED_STATUS = new Set(['已回收', '已完成', '已解决', 'resolved', 'done', 'complete'])
const CORE_TIER = new Set(['核心', 'core', 'main'])
const DECOR_TIER = new Set(['装饰', 'decor', 'decoration'])

function toPositiveInt(value) {
    if (value === null || value === undefined || value === '' || value === false) return null
    const number = Number.parseInt(String(value), 10)
    return Number.isFinite(number) && number > 0 ? number : null
}

function resolveChapterField(item, keys) {
    for (const key of keys) {
        const chapter = toPositiveInt(item?.[key])
        if (chapter) return chapter
    }
    return null
}

function isResolvedStatus(status) {
    const text = String(status || '').trim()
    return RESOLVED_STATUS.has(text) || RESOLVED_STATUS.has(text.toLowerCase())
}

function normalizeTier(rawTier) {
    const text = String(rawTier || '').trim()
    const lowered = text.toLowerCase()
    if (CORE_TIER.has(text) || CORE_TIER.has(lowered)) return '核心'
    if (DECOR_TIER.has(text) || DECOR_TIER.has(lowered)) return '装饰'
    return '支线'
}

function tierWeight(tier) {
    if (tier === '核心') return 3
    if (tier === '装饰') return 1
    return 2
}

function urgencyLevel(score, remaining, resolved) {
    if (resolved) return 'resolved'
    if (remaining !== null && remaining < 0) return 'overdue'
    if ((score !== null && score >= 2) || (remaining !== null && remaining <= 5)) return 'urgent'
    return 'active'
}

function urgencyText(level) {
    if (level === 'overdue') return '超期'
    if (level === 'urgent') return '紧急'
    if (level === 'resolved') return '已回收'
    return '活跃'
}

function urgencyBadge(score, level) {
    if (level === 'overdue') return 'critical'
    if (score !== null && score >= 3) return 'high'
    if (score !== null && score >= 2) return 'medium'
    if (level === 'resolved') return 'resolved'
    return 'normal'
}

export function buildForeshadowingRecords(projectInfo) {
    const currentChapter = Number(projectInfo?.progress?.current_chapter || 0)
    const rows = Array.isArray(projectInfo?.plot_threads?.foreshadowing)
        ? projectInfo.plot_threads.foreshadowing
        : []

    return rows.map((item, index) => {
        const resolved = isResolvedStatus(item?.status)
        const tier = normalizeTier(item?.tier)
        const weight = tierWeight(tier)
        const plantedChapter = resolveChapterField(item, [
            'planted_chapter',
            'added_chapter',
            'source_chapter',
            'start_chapter',
            'chapter',
        ])
        const targetChapter = resolveChapterField(item, [
            'target_chapter',
            'due_chapter',
            'deadline_chapter',
            'resolve_by_chapter',
            'target',
        ])
        const resolvedChapter = resolveChapterField(item, ['resolved_chapter', 'resolved'])

        const elapsed = plantedChapter && currentChapter
            ? Math.max(0, currentChapter - plantedChapter)
            : null
        const remaining = targetChapter && currentChapter
            ? targetChapter - currentChapter
            : null

        let urgencyScore = null
        if (plantedChapter && targetChapter && targetChapter > plantedChapter && elapsed !== null) {
            urgencyScore = Number(((elapsed / (targetChapter - plantedChapter)) * weight).toFixed(2))
        } else if (plantedChapter && targetChapter && targetChapter <= plantedChapter && elapsed !== null) {
            urgencyScore = weight * 2
        }

        const level = urgencyLevel(urgencyScore, remaining, resolved)

        return {
            id: `${item?.content || 'foreshadowing'}-${index}`,
            content: String(item?.content || item?.description || '未命名伏笔'),
            tier,
            plantedChapter,
            targetChapter,
            resolvedChapter,
            elapsed,
            remaining,
            urgencyScore,
            level,
            statusText: urgencyText(level),
            urgencyText: urgencyBadge(urgencyScore, level),
            rawStatus: String(item?.status || ''),
        }
    })
}

export function summarizeForeshadowing(records) {
    return records.reduce(
        (summary, record) => {
            summary.total += 1
            if (record.level === 'resolved') {
                summary.resolved += 1
            } else {
                summary.active += 1
            }
            if (record.level === 'urgent' || record.level === 'overdue') {
                summary.attention += 1
            }
            return summary
        },
        { total: 0, active: 0, resolved: 0, attention: 0 },
    )
}
