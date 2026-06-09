export {
  hashSecret,
  randomSecret,
  issueMagicLink,
  verifyMagicLink,
  reapExpiredMagicLinks,
} from "./magic-link.js";
export type {
  AuthSubject,
  IssueParams,
  IssueDeps,
  IssuedLink,
  VerifyDeps,
  VerifyFailure,
  VerifyResult,
  ReapResult,
} from "./magic-link.js";
export { signSession, verifySession, shouldRenew } from "./session.js";
export type { Session, SessionResult, SessionFailure } from "./session.js";
