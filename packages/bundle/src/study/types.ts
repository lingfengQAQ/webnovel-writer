export interface FileRef {
  readonly space: string
  readonly path: string
}

export interface StudyBook {
  readonly absolutePath?: string
  readonly id: string
  readonly name: string
  readonly progress: string
  readonly error?: string
}

export interface StudyShelf {
  readonly workspace: string
  readonly books: readonly StudyBook[]
  readonly shared: boolean
  readonly sharedError?: string
}

export interface TreeEntry {
  readonly absolutePath?: string
  readonly ref: FileRef
  readonly name: string
  readonly directory: boolean
  readonly draft: boolean
  readonly badge?: string
  readonly error?: string
}

export interface StudyDocument {
  readonly ref: FileRef
  readonly owner: string
  readonly name: string
  readonly absolutePath: string
  readonly body: string
  readonly hash: string
  readonly version: string | number | null
  readonly readOnly?: string
  readonly badge?: string
}

export interface StudySave {
  readonly operationId: string
  readonly document: StudyDocument
  readonly changed: boolean
  readonly previousPath: string
  readonly changes: readonly { readonly added?: boolean; readonly removed?: boolean; readonly value: string }[]
  readonly commit: 'saved' | 'not-required' | 'failed'
  readonly commitError?: string
  readonly notification: 'delivered' | 'failed' | 'not-required'
  readonly notificationError?: string
  readonly route: string
}

export interface ChapterView {
  readonly bookId: string
  readonly bookName: string
  readonly chapters: readonly { readonly volume: number; readonly chapter: number; readonly title: string; readonly status: string; readonly finalized?: boolean; readonly source?: FileRef }[]
}
