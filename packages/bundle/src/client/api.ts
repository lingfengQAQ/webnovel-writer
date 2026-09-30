export class StudyApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'StudyApiError' }
}

export async function callStudy<T>(sessionId: string, method: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/webnovel/study/' + method, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'content-type': 'application/json', 'x-webnovel-request': '1' },
    body: JSON.stringify({ ...body, sessionId }),
  })
  let result: { ok: boolean; value?: T; error?: string; code?: string }
  try { result = await response.json() as typeof result } catch { throw new StudyApiError('unavailable', '书房服务尚未就绪，请刷新后重试') }
  if (!response.ok || !result.ok) throw new StudyApiError(result.code ?? 'failed', result.error ?? '书房服务未响应')
  return result.value as T
}
