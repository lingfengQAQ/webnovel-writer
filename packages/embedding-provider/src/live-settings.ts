import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Native profile edits validate before persistence and refresh only this entry. */
export function attachLiveSettings<T>(ctx: Context, validate: (raw: T) => unknown, refresh: () => void): void {
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw = next()
    if (this === ctx.fiber) validate(raw as T)
    return raw
  })
  ctx.on('loader/volatile-update', refresh)
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
}
