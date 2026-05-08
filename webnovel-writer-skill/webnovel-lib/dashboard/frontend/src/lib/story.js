function parseChapter(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
}

function parseRange(value) {
    const text = String(value || '').trim()
    if (!text.includes('-')) return null
    const [left, right] = text.split('-', 2)
    const start = parseChapter(left)
    const end = parseChapter(right)
    if (!start || !end || start > end) return null
    return { start, end }
}

export function getLatestChapter(projectInfo) {
    return parseChapter(projectInfo?.progress?.current_chapter) || 1
}

export function resolveVolumeForChapter(projectInfo, chapter) {
    const target = parseChapter(chapter)
    if (!target) return null

    const planned = Array.isArray(projectInfo?.progress?.volumes_planned)
        ? projectInfo.progress.volumes_planned
        : []

    for (const item of planned) {
        const volume = parseChapter(item?.volume)
        const range = parseRange(item?.chapters_range)
        if (volume && range && range.start <= target && target <= range.end) {
            return volume
        }
    }

    return null
}

export function groupChaptersByVolume(chapters, projectInfo) {
    const groups = new Map()

    for (const chapter of chapters || []) {
        const volume = resolveVolumeForChapter(projectInfo, chapter?.chapter)
        const key = volume || 0
        if (!groups.has(key)) {
            groups.set(key, {
                volume,
                label: volume ? `卷 ${volume}` : '未分卷',
                totalWords: 0,
                chapterCount: 0,
                values: [],
            })
        }

        const bucket = groups.get(key)
        const wordCount = Number(chapter?.word_count || 0)
        bucket.totalWords += Number.isFinite(wordCount) ? wordCount : 0
        bucket.chapterCount += 1
        if (Number.isFinite(wordCount) && wordCount > 0) {
            bucket.values.push(wordCount)
        }
    }

    return [...groups.values()].sort((left, right) => {
        if (left.volume === null) return 1
        if (right.volume === null) return -1
        return (left.volume || 0) - (right.volume || 0)
    })
}
