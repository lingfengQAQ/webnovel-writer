/**
 * DSH snapshots every tool result as lossless JSON. An own key whose value is
 * `undefined` makes the host reject the whole result (`value is not lossless
 * JSON`, #213), so the author never sees the actual blocker. JSON drops such
 * keys anyway, so omitting them loses nothing.
 *
 * Only plain-object keys are omitted. Array entries, non-finite numbers,
 * cycles, symbol or non-enumerable keys and non-plain objects stay as they
 * are: rewriting them would change meaning, so the host still rejects them.
 * Unchanged subtrees keep their identity.
 */
export function omitUndefinedFields<T>(value: T): T {
  return omit(value, new Set()) as T
}

function omit(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value !== 'object' || ancestors.has(value)) return value
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      let copy: unknown[] | undefined
      value.forEach((item, index) => {
        const next = omit(item, ancestors)
        if (!Object.is(next, item)) (copy ??= value.slice())[index] = next
      })
      return copy ?? value
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key))) return value
    const record = value as Record<string, unknown>
    let changed = false
    const entries: [string, unknown][] = []
    for (const key of keys as string[]) {
      const item = record[key]
      if (item === undefined) { changed = true; continue }
      const next = omit(item, ancestors)
      if (!Object.is(next, item)) changed = true
      entries.push([key, next])
    }
    return changed ? Object.fromEntries(entries) : value
  } finally {
    ancestors.delete(value)
  }
}
