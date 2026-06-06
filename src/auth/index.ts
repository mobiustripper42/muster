export {
  hashSecret,
  randomSecret,
  issueMagicLink,
  verifyMagicLink,
} from "./magic-link.js";
export type {
  AuthSubject,
  IssueParams,
  IssueDeps,
  IssuedLink,
  VerifyDeps,
  VerifyFailure,
  VerifyResult,
} from "./magic-link.js";
