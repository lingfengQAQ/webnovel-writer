/**
 * Return the configured closed interval used by all style-baseline consumers.
 * Invalid values are treated as unavailable so callers fail closed instead of
 * falling back to a historical fingerprint.
 *
 * @param {object|null|undefined} config Parsed book.yaml data
 * @returns {{start: number, end: number}|null}
 */
export function configuredBaselineRange(config) {
  const start = config?.文体基线起
  const end = config?.文体基线止
  if (!Number.isInteger(start) || start < 1) return null
  if (!Number.isInteger(end) || end < 1 || start > end) return null
  return { start, end }
}

/**
 * Read only the active fingerprint for the current configured interval.
 * Historical baseline rows are intentionally ignored; health-check is the
 * sole producer and may remove them when the configuration changes.
 *
 * @param {{query: Function}} cache
 * @param {object|null|undefined} config Parsed book.yaml data
 * @returns {Promise<object|null>}
 */
export async function readCurrentBaselineFingerprint(cache, config) {
  const range = configuredBaselineRange(config)
  if (!range) return null
  try {
    const rows = await cache.query(
      `SELECT * FROM fingerprints
       WHERE is_baseline = 1
         AND chapter_range_start = ?
         AND chapter_range_end = ?
       LIMIT 1`,
      [range.start, range.end]
    )
    return rows[0] || null
  } catch {
    return null
  }
}
