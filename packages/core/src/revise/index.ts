export {
  applyRevision,
  applyRevisionBatch,
  ingestAuthorRevision,
  type ApplyRevisionBatchInput,
  type ApplyRevisionBatchResult,
  type ApplyRevisionInput,
  type ApplyRevisionResult,
  type IngestAuthorRevisionResult,
  type RevisionBatchDisposition,
  type RevisionPatch,
} from './apply'
export { lineDiff, replayLines, type DiffLine } from './diff'
export { followupReport, type FollowupReport } from './followup'
export {
  AuthorDocumentError, authorDocumentPath, authorReadOnlyReason, validateAuthorRelativePath, documentHash, saveAuthorDocument, readAuthorSave, retryAuthorSaveCommit,
  type AuthorSaveInput, type AuthorSaveResult,
} from './document'
export {
  loadProposal,
  nextProposalNumber,
  recordRetconEvent,
  retconEventOps,
  registerProposal,
  resolveProposal,
  type ProposalInput,
  type RetconEventInput,
  type RetconEventOp,
  type 提案状态,
  type 提案类型,
  type 提案域,
} from './proposal'
