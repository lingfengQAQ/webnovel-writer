/* @webnovel/review —— 行为规格见 docs/book-format.md(单一真源);本包只放实现 */
export const pkg = '@webnovel/review'

export { makeFinding, type Finding } from './finding'
export { getCheck, listChecks, registerCheck, resetChecks, type CheckInput, type CheckModule } from './registry'
export {
  M0_REQUIRED_CHECKS,
  registerDefaultChecks,
  runCanonCheck,
  runTextNorm,
  findingId,
  设定与时序核对,
  设定与时序核对名,
  文本规范检查,
  文本规范检查名,
} from './checks'
export { computeReview, ingestFindings, planReview, recordAuthorFinding, runReview, type ReviewKey, type RunReviewResult, type ReviewProseStats } from './run'
