/** 当前缓冲文档正是这次保存返回的那一份：正文差异来自服务端规范化，不是外部同步。 */
export function isOwnSaveEcho(saved: { readonly document: unknown } | undefined, document: unknown): boolean {
  return !!saved && saved.document === document
}
