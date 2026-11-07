import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { hasExplicitAutoIndex, normalizeWebnovelPreferences, WEBNOVEL_SETTINGS_NAMESPACE } from './preferences'
import type { IndexAutoPreference } from './indexing/manager'

type Settings = Pick<SettingsForms, 'describe' | 'update'>
/** Host settings owns the one persisted control; failed migration preserves the old book flag. */
export function createIndexAutoPreference(settings: () => Settings | undefined, fallback: () => unknown): IndexAutoPreference {
  const descriptor = () => settings()?.describe().find(item => item.ns === WEBNOVEL_SETTINGS_NAMESPACE)
  const selected = (raw: unknown): boolean | undefined => hasExplicitAutoIndex(raw) ? normalizeWebnovelPreferences(raw).autoIndexOnCommit : undefined
  const get = () => {
    const row = descriptor()
    return selected(row?.user) ?? selected(row?.value) ?? selected(fallback())
  }
  const write = async (value: boolean, migrating: boolean) => {
    const host = settings(), row = descriptor()
    if (migrating && get() !== undefined) return
    if (!host || !row) throw new Error('DSH 设置尚不可写，原自动索引设置已保留')
    try {
      await host.update(WEBNOVEL_SETTINGS_NAMESPACE, { autoIndexOnCommit: value }, row.revision)
    } catch (error) {
      // A concurrent author's choice (including false) wins over the old book.
      if (migrating && (error as { code?: string })?.code === 'SETTINGS_CONFLICT' && get() !== undefined) return
      throw error
    }
  }
  let migration: Promise<void> | undefined
  return {
    get,
    set: enabled => write(enabled, false),
    migrateIfUnset() {
      if (!migration) {
        migration = write(true, true).finally(() => { migration = undefined })
      }
      return migration
    },
  }
}
