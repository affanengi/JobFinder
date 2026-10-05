import { extractJobFromDocument } from "./extractors";
import { ExtractedJobData } from "../types";
import { isSupportedJobUrl } from "./url-guard";

export const READINESS_TIMEOUT_MS = 1200;
export const STABLE_FRAME_COUNT = 2;
export const FRAME_INTERVAL_MS = 60;

export function resolveTargetJobId(doc: Document, urlString: string): string | null {
  try {
    const url = new URL(urlString);
    const paramId = url.searchParams.get("currentJobId");
    if (paramId && /^\d+$/.test(paramId)) return paramId;

    const viewMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];

    const activeItem = doc.querySelector(
      ".jobs-search-results-list__list-item--active, .scaffold-layout__list-item.active, [data-occludable-job-id].active, [data-job-id].active"
    );
    if (activeItem) {
      const dataId = activeItem.getAttribute("data-occludable-job-id") || activeItem.getAttribute("data-job-id");
      if (dataId && /^\d+$/.test(dataId)) return dataId;
    }
  } catch {}
  return null;
}

export function isHeaderSkeleton(detailPane: Element | Document): boolean {
  // Only check primary top-card container for skeleton or loading state.
  // Explicitly ignore auxiliary widgets (recruiter, similar jobs, skill match) and global nav header.
  const topCard = detailPane.querySelector(
    '.job-details-jobs-unified-top-card, .jobs-unified-top-card, .jobs-details__top-card, [data-view-name="job-details-top-card"], .top-card-layout'
  );
  if (topCard) {
    return !!topCard.querySelector('.artdeco-skeleton, .skeleton-loader, [aria-busy="true"], .jobs-details__loading');
  }
  const titleContainer = detailPane.querySelector('h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]')?.parentElement;
  if (titleContainer) {
    return !!titleContainer.querySelector('.artdeco-skeleton, .skeleton-loader, [aria-busy="true"]');
  }
  return false;
}

export function findDetailPane(doc: Document): Element | Document {
  return (
    (doc.querySelector('.scaffold-layout__detail') as Element | null) ||
    (doc.querySelector('.jobs-search__job-details--container') as Element | null) ||
    (doc.querySelector('.jobs-search__job-details') as Element | null) ||
    (doc.querySelector('.jobs-details__main-content') as Element | null) ||
    (doc.querySelector('[data-view-name="job-details"]') as Element | null) ||
    (doc.querySelector('.job-view-layout') as Element | null) ||
    (doc.querySelector('.decorated-job-posting__details') as Element | null) ||
    (doc.querySelector('main#main-content, main, .core-rail') as Element | null) ||
    doc
  );
}

export function verifyDetailPaneIdentity(
  detailPane: Element | Document,
  targetJobId: string | null,
  doc?: Document
): boolean {
  if (!targetJobId) return true;

  // 1. Direct title link check (catches stale navigation when clicking next job in rail)
  const titleLink = detailPane.querySelector(
    'h1 a[href*="/jobs/view/"], h2.t-24 a[href*="/jobs/view/"], .job-details-jobs-unified-top-card__job-title a[href*="/jobs/view/"], .jobs-unified-top-card__job-title a[href*="/jobs/view/"], .top-card-layout__title a[href*="/jobs/view/"]'
  );
  if (titleLink) {
    const match = (titleLink.getAttribute('href') || '').match(/\/jobs\/view\/(\d+)/);
    if (match) {
      return match[1] === targetJobId;
    }
  }

  // 2. Topcard container scope (look for targetJobId links in topcard only, avoiding footer "similar jobs")
  const topCard = detailPane.querySelector(
    '.job-details-jobs-unified-top-card, .jobs-unified-top-card, .top-card-layout, [class*="top-card"]'
  );
  if (topCard) {
    const matchingLink = topCard.querySelector(`a[href*="${targetJobId}"]`);
    if (matchingLink) return true;
  }

  // 3. Container attributes
  const containerId = 'getAttribute' in detailPane ? (detailPane.getAttribute('data-job-id') || detailPane.getAttribute('data-entity-urn')) : null;
  if (containerId && containerId.includes(targetJobId)) return true;
  const innerWithId = detailPane.querySelector(`[data-job-id*="${targetJobId}"], [data-entity-urn*="${targetJobId}"]`);
  if (innerWithId) return true;

  // 4. Compare active rail card title with detail pane title ONLY if a search rail list exists
  const activeDoc = doc || ('ownerDocument' in detailPane && (detailPane as Element).ownerDocument ? (detailPane as Element).ownerDocument : (detailPane as Document));
  if (activeDoc) {
    const searchRail = activeDoc.querySelector('.jobs-search-results-list, .scaffold-layout__list, .jobs-search__left-rail');
    if (searchRail) {
      const activeRailCard = searchRail.querySelector(
        `[data-job-id="${targetJobId}"], [data-occludable-job-id="${targetJobId}"], .jobs-search-results-list__list-item--active, [data-occludable-job-id].active`
      );
      const railTitle = activeRailCard?.querySelector('.job-card-list__title, a[class*="job-title"]')?.textContent?.trim();
      const paneTitle = detailPane.querySelector('h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]')?.textContent?.trim();
      if (railTitle && paneTitle) {
        const cleanRail = railTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanPane = paneTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanRail && cleanPane && (cleanRail.includes(cleanPane) || cleanPane.includes(cleanRail))) {
          return true;
        }
        // Contradicting rail and pane titles indicate stale detail context
        return false;
      }
    }
  }

  // 5. Fallback: Detail pane has substantive non-generic title
  const h1 = detailPane.querySelector('h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]');
  const h1Text = (h1?.textContent || '').trim();
  if (h1Text && !/^(linkedin|jobs|search|feed)$/i.test(h1Text)) {
    return true;
  }

  return false;
}

export function evaluateMinimumSafeCriteria(
  detailPane: Element | Document,
  targetJobId: string | null,
  doc?: Document
): boolean {
  const isMatching = verifyDetailPaneIdentity(detailPane, targetJobId, doc);
  const title = detailPane.querySelector(
    'h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]'
  )?.textContent?.trim();
  const company = detailPane.querySelector(
    '[class*="company-name"], .topcard__flavor, a[href*="/company/"]'
  )?.textContent?.trim();

  // Minimum safe criteria: identity match is valid and at least substantive title or company anchor is present
  const isSubstantiveTitle = Boolean(title && title.length > 0 && !/^(linkedin|jobs|search|feed)$/i.test(title));
  const isSubstantiveCompany = Boolean(company && company.length > 0 && !/^(linkedin)$/i.test(company));
  return isMatching && (isSubstantiveTitle || isSubstantiveCompany);
}

export function computeDetailSubtreeHash(detailPane: Element | Document): string {
  const titleText = detailPane.querySelector('h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]')?.textContent?.trim() || '';
  const companyText = detailPane.querySelector('[class*="company-name"], .topcard__flavor, a[href*="/company/"]')?.textContent?.trim() || '';
  const descCandidate = detailPane.querySelector(
    '#job-details, .show-more-less-html__markup, .description__text--rich, .jobs-description__content, .jobs-box__html-content, article, [class*="description"]'
  );
  const descLength = descCandidate?.textContent?.trim().length || 0;
  return `${titleText.slice(0, 40)}:${companyText.slice(0, 30)}:${descLength}`;
}

export interface ReadinessResult {
  isReady: boolean;
  isDegraded: boolean;
  detailContainer: Element | Document | null;
  reason?: string;
}

export async function waitForJobDetailReady(
  doc: Document,
  initialUrl: string,
  maxWaitMs = READINESS_TIMEOUT_MS
): Promise<ReadinessResult> {
  const startTime = Date.now();
  let lastHash = '';
  let stableFrames = 0;
  const targetJobId = resolveTargetJobId(doc, initialUrl);

  while (Date.now() - startTime < maxWaitMs) {
    // 1. Navigation abort check: did active job ID mutate while waiting?
    const currentUrl = doc.defaultView ? doc.defaultView.location.href : (typeof window !== 'undefined' ? window.location.href : initialUrl);
    const currentActiveId = resolveTargetJobId(doc, currentUrl);
    if (targetJobId && currentActiveId && currentActiveId !== targetJobId) {
      return { isReady: false, isDegraded: false, detailContainer: null, reason: 'NAV_ABORT' };
    }

    // 2. Locate detail container
    const detailPane = findDetailPane(doc);

    // 3. Loading / Header Skeleton check (scoped to header only, ignores auxiliary widgets)
    if (isHeaderSkeleton(detailPane)) {
      stableFrames = 0;
      await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      continue;
    }

    // 4. Detail pane identity match check
    const isMatching = verifyDetailPaneIdentity(detailPane, targetJobId, doc);
    if (!isMatching) {
      stableFrames = 0;
      await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      continue;
    }

    // 5. Meaningful Content & Subtree Stability Check
    const titleEl = detailPane.querySelector(
      'h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.job-details-jobs-unified-top-card__job-title, h2.jobs-unified-top-card__job-title, h2.t-24, h1:not(.visually-hidden), [class*="job-title"]'
    );
    const companyEl = detailPane.querySelector('[class*="company-name"], .topcard__flavor, a[href*="/company/"]');
    const descEl = detailPane.querySelector(
      '#job-details, .show-more-less-html__markup, .description__text--rich, .jobs-description__content, .jobs-box__html-content, article, [class*="description"]'
    );

    const titleText = (titleEl?.textContent || '').trim();
    const companyText = (companyEl?.textContent || '').trim();

    // Fast-path: title + company exist, detail pane identity verified, and topcard is not a skeleton
    if (titleText && companyText && isMatching) {
      const currentHash = computeDetailSubtreeHash(detailPane);
      if (currentHash === lastHash) {
        stableFrames++;
        if (stableFrames >= STABLE_FRAME_COUNT) {
          // Fast-path identity stability reached! Proceed to extraction.
          // Note: Field completeness is assessed independently by the extractor.
          return { isReady: true, isDegraded: false, detailContainer: detailPane };
        }
      } else {
        stableFrames = 0;
        lastHash = currentHash;
      }
    } else if (titleEl && descEl && (descEl.textContent || '').trim().length > 0) {
      const currentHash = computeDetailSubtreeHash(detailPane);
      if (currentHash === lastHash) {
        stableFrames++;
        if (stableFrames >= STABLE_FRAME_COUNT) {
          return { isReady: true, isDegraded: false, detailContainer: detailPane };
        }
      } else {
        stableFrames = 0;
        lastHash = currentHash;
      }
    }

    await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
  }

  // 6. Safe Timeout Fallback Evaluation
  const fallbackPane = findDetailPane(doc);

  const minimumSafe = evaluateMinimumSafeCriteria(fallbackPane, targetJobId, doc);

  if (minimumSafe) {
    // Minimum safe criteria satisfied -> controlled extraction with degraded quality state
    return { isReady: true, isDegraded: true, detailContainer: fallbackPane, reason: 'TIMEOUT_DEGRADED' };
  } else {
    // Minimum safe criteria NOT satisfied -> safe failure
    return { isReady: false, isDegraded: false, detailContainer: null, reason: 'TIMEOUT_INSUFFICIENT' };
  }
}

// Track last known job ID for SPA navigation
let lastKnownJobId: string | null = null;

// Idempotency: Prevent duplicate initialization if script is injected multiple times into the same tab
const INITIALIZED_KEY = '__JOBFINDER_CONTENT_SCRIPT_INITIALIZED__';
const isAlreadyInitialized = typeof window !== 'undefined' && Boolean((window as any)[INITIALIZED_KEY]);

if (typeof window !== 'undefined' && !isAlreadyInitialized) {
  (window as any)[INITIALIZED_KEY] = true;

  // Listen for SPA history state changes - strictly gated to verified supported job platforms (LinkedIn, etc.)
  if (isSupportedJobUrl(window.location.href)) {
    window.addEventListener("popstate", () => {
      // Abort immediately if page transitioned away from a supported job platform
      if (!isSupportedJobUrl(window.location.href)) {
        lastKnownJobId = null;
        return;
      }
      lastKnownJobId = resolveTargetJobId(document, window.location.href);
    });
  }

  // Listen for requests from extension popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "EXTRACT_JOB") {
        (async () => {
          try {
            const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
            const isSupported = isSupportedJobUrl(currentUrl);
            const isCustomSite = Boolean(message.isCustomSite);

            // Hard isolation: If neither supported job platform nor user-authorized custom site, refuse extraction
            if (!isSupported && !isCustomSite) {
              sendResponse({
                success: false,
                error: "JobFinder is dormant on this page.",
                jobId: null,
              });
              return;
            }

            const targetJobId = isSupported ? resolveTargetJobId(document, currentUrl) : null;
            lastKnownJobId = targetJobId;

            // Direct real-time DOM extraction
            let data = extractJobFromDocument(document, currentUrl);

            // Only on supported job platforms (like LinkedIn), if initial extraction yielded empty fields,
            // wait 300ms once and re-check for async rendering.
            // On custom career sites, extraction is strictly one-shot without arbitrary waiting.
            if (isSupported && !data.title && !data.company && !data.descriptionText) {
              await new Promise((r) => setTimeout(r, 300));
              data = extractJobFromDocument(document, currentUrl);
            }

            if (!data.title && !data.company && !data.descriptionText) {
              sendResponse({
                success: false,
                error: "No job posting detected on this page. Please navigate to a job listing.",
                jobId: targetJobId,
              });
              return;
            }

            if (targetJobId && !data.sourceJobId) {
              data.sourceJobId = targetJobId;
            }
            data.extractionStatus = 'normal';

            sendResponse({
              success: true,
              data,
              jobId: targetJobId,
              extractionStatus: 'normal',
            });
          } catch (err: any) {
            console.error("[JobFinder Clipper] Extraction error:", err);
            sendResponse({
              success: false,
              error: err?.message || "Failed to extract job from page",
            });
          }
        })();
        return true; // Keep message channel open for async response
      }
      return false;
    });
  }
}

