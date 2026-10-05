/**
 * Content-script scoped URL guard.
 * Defined within the content script bundle boundary to guarantee zero ES-module code splitting.
 * Chrome content scripts are executed in classic script mode and throw a fatal SyntaxError
 * if any ES module 'import' statement is emitted into the bundle.
 */

export const SUPPORTED_JOB_PATTERNS: readonly RegExp[] = [
  // LinkedIn Jobs (standalone or search; explicitly excludes /feed, /in/, /messaging, etc.)
  /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/jobs\//i,
  // Indeed viewjob and jobs listing pages
  /^https?:\/\/([a-z0-9-]+\.)?indeed\.com\/(viewjob|jobs)/i,
  // Greenhouse job board domains
  /^https?:\/\/(boards|job-boards)\.greenhouse\.io\//i,
  // Lever job postings
  /^https?:\/\/jobs\.lever\.co\//i,
  // Ashby job postings
  /^https?:\/\/jobs\.ashbyhq\.com\//i,
  // Workday job portals
  /^https?:\/\/([a-z0-9-]+\.)?myworkdayjobs\.com\//i,
];

export function isSupportedJobUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  return SUPPORTED_JOB_PATTERNS.some((pattern) => pattern.test(url));
}
