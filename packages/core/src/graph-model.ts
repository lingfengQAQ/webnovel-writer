/** Auxiliary settled-source extraction. None of these results are authoritative book facts. */
export interface GraphModelInput {
  readonly sourceKind: string
  readonly fields: Readonly<Record<string, unknown>>
  readonly text: string
  readonly entities: readonly { readonly id: string; readonly label: string; readonly aliases: readonly string[] }[]
}
export interface GraphModelProvider {
  readonly metadata: {
    readonly provider: string
    readonly model: string
    readonly revision: string
    readonly timeoutMs: number
  }
  inputChars(input: GraphModelInput): number
  extract(input: GraphModelInput, signal?: AbortSignal): Promise<{
    readonly data: unknown
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  }>
  close(): Promise<void>
}
