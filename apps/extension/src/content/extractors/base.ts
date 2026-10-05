import { EmploymentType, ExtractedJobData, SourcePlatform, WorkMode } from '../../types';

export const BANNED_COMPANIES: readonly string[] = [
  'linkedin',
  'linkedin corporation',
  'indeed',
  'glassdoor',
  'ziprecruiter',
  'google',
  'greenhouse',
  'lever',
  'ashby',
  'workday',
];

export function isBannedCompany(name: string | null | undefined): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  return BANNED_COMPANIES.some((banned) => lower === banned || lower.startsWith(`${banned} `));
}

export function cleanLocation(
  text: string | null | undefined,
  companyName?: string | null,
  jobTitle?: string | null
): {
  location: string | null;
  detectedWorkMode: WorkMode;
} {
  if (!text) return { location: null, detectedWorkMode: null };

  let detectedWorkMode: WorkMode = null;

  // 1. Check for parenthetical work modes in raw text before splitting
  if (/\((?:on-site|onsite|in-office)\)/i.test(text)) {
    detectedWorkMode = 'onsite';
  } else if (/\(hybrid\)/i.test(text)) {
    detectedWorkMode = 'hybrid';
  } else if (/\(remote|wfh\)/i.test(text)) {
    detectedWorkMode = 'remote';
  }

  // 2. Tokenize by primary delimiters: middle dots, bullets, pipes, slashes, dashes, or newlines
  // NOTE: En/Em-dashes (\u2013, \u2014) and hyphens are ONLY split when surrounded by whitespace (\s+[-–—/|]\s+)
  // to avoid breaking words or compound titles/names.
  const segments = text
    .split(/[·•‧∙⋅●○◦\u00b7\u2022\u2024\u2027\u2219\u22c5\u25cf\u25cb\u25e6|\n\t]|(?:\s+[-–—/|]\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    let candidate = seg;

    if (!detectedWorkMode) {
      if (/\b(?:on-site|onsite|in-office)\b/i.test(candidate)) {
        detectedWorkMode = 'onsite';
      } else if (/\bhybrid\b/i.test(candidate)) {
        detectedWorkMode = 'hybrid';
      } else if (/\b(?:remote|wfh)\b/i.test(candidate)) {
        detectedWorkMode = 'remote';
      }
    }

    // Strip parenthetical expressions from candidate location
    candidate = candidate.replace(/\s*\([^)]*\)/g, '').trim();

    // Scrub relative timestamps, telemetry, social proof badges, and UI text
    candidate = candidate
      .replace(
        /\b(?:\d+\s+)?(?:just\s+now|\d+\s*(?:sec|second|min|minute|hr|hour|day|wk|week|mo|month|yr|year)s?\s*ago)\b/gi,
        ''
      )
      .replace(/\b(?:over\s+)?\d+\s+(?:people|applicants?|clicks?)(?:\s+(?:clicked\s+apply|applied))?\b/gi, '')
      .replace(
        /\b(?:reposted|promoted|viewed|easy\s+apply|responses\s+managed\s+off\s+linkedin|responses\s+managed|managed\s+off\s+linkedin|be\s+an\s+early\s+applicant)\b/gi,
        ''
      )
      .replace(
        /\b(?:show\s+match\s+details|help\s+me\s+update\s+my\s+profile|beta|is\s+this\s+information\s+helpful|are\s+these\s+results\s+helpful)\b/gi,
        ''
      )
      .replace(
        /\b(?:date\s+posted|in\s+my\s+network|under\s+\d+\s+applicants?|all\s+filters?|filter\s+by)\b/gi,
        ''
      )
      .trim();

    // Trim leading/trailing punctuation (middle dots, bullets, commas, pipes, dashes, slashes, spaces)
    candidate = candidate
      .replace(/^[\s,·•‧∙⋅●○◦\u00b7\u2022\u2024\u2027\u2219\u22c5\u25cf\u25cb\u25e6\u2013\u2014|/-]+|[\s,·•‧∙⋅●○◦\u00b7\u2022\u2024\u2027\u2219\u22c5\u25cf\u25cb\u25e6\u2013\u2014|/-]+$/g, '')
      .trim();

    // Validation guards:
    // Must have at least 2 chars, max 80 chars, must contain alphabet characters, not pure numbers, time units, or salary/currency tokens
    if (
      candidate.length < 2 ||
      candidate.length > 80 ||
      !/[a-zA-Z]/.test(candidate) ||
      /^\d+$/.test(candidate) ||
      /^(yesterday|today|now|yr|yrs|year|years|mo|mos|month|months|wk|wks|week|weeks|day|days|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs|second|seconds)$/i.test(candidate) ||
      /^[$€£₹]|\b(?:usd|eur|gbp|inr|cad|aud)\b/i.test(candidate)
    ) {
      continue;
    }

    // Skip if candidate matches or contains company name (or company contains candidate)
    if (companyName) {
      const cLow = companyName.trim().toLowerCase();
      const candLow = candidate.toLowerCase();
      if (candLow === cLow || candLow.includes(cLow) || (cLow.length > 3 && cLow.includes(candLow))) {
        continue;
      }
    }

    // Skip if candidate matches or contains job title
    if (jobTitle) {
      const tLow = jobTitle.trim().toLowerCase();
      const candLow = candidate.toLowerCase();
      if (candLow === tLow || candLow.includes(tLow) || (tLow.length > 5 && tLow.includes(candLow))) {
        continue;
      }
      // Check if candidate matches a role keyword from the job title (e.g. "intern", "engineer", "modeler")
      const titleWords = tLow.split(/[\s—–\-/|,]+/).filter((w) => w.length >= 4);
      if (titleWords.some((w) => candLow === w || candLow.startsWith(w) || candLow.endsWith(w))) {
        if (candidate.length < 30) {
          continue;
        }
      }
    }

    // Skip common search filter keywords or UI labels
    if (/\b(?:date\s+posted|easy\s+apply|in\s+my\s+network|under\s+\d+\s+applicants?|filter\s+by|all\s+filters?|sort\s+by|search\s+by)\b/i.test(candidate)) {
      continue;
    }

    // Skip common non-location UI action keywords, work modes, and employment types
    if (
      /^(?:apply|easy apply|save|saved|share|follow|more|details|fit|match|update|profile|beta|internship|intern|full[ -]?time|part[ -]?time|contract|temporary|freelance|remote|on-site|onsite|hybrid|in-office|responses managed|managed off linkedin|viewed|reposted|promoted|date posted|in my network)$/i.test(
        candidate
      )
    ) {
      continue;
    }

    // Skip other non-location indicator phrases
    if (/\b(?:results?|qualifications?|missing|applicant|applicants|viewed|reposted|feedback)\b/i.test(candidate)) {
      continue;
    }

    return { location: candidate, detectedWorkMode };
  }

  return { location: null, detectedWorkMode };
}

export function htmlToStructuredMarkdown(element: Element | null): string | null {
  if (!element) return null;

  // Defensive Guard: If target element is an enormous container (> 2500 elements),
  // attempt to narrow down to a scoped content container to prevent main-thread freezing
  let targetElement = element;
  if (element.getElementsByTagName('*').length > 2500) {
    const scopedCandidate = element.querySelector(
      '.job-description, .job__description, #job-details, article, section, [class*="description"], [class*="content"]'
    );
    if (scopedCandidate && scopedCandidate.getElementsByTagName('*').length < 2500 && (scopedCandidate.textContent || '').trim().length > 40) {
      targetElement = scopedCandidate;
    }
  }

  // 1. Clone element to avoid modifying the live document
  const clone = targetElement.cloneNode(true) as Element;


  // 2. Remove noise and non-content tags
  // Note: We deliberately DO NOT remove [aria-hidden="true"] because LinkedIn renders
  // primary visual text inside aria-hidden="true" spans alongside .visually-hidden duplicates.
  const noiseSelectors = [
    'script',
    'style',
    'noscript',
    'svg',
    'button',
    'form',
    'input',
    'select',
    'textarea',
    'nav',
    'aside',
    '.visually-hidden',
    '.a11y-text',
    '[hidden]',
    '.show-more-less-html__button',
    '.message-the-recruiter',
    '.find-a-referral',
    '.similar-jobs',
    '.jobs-description__footer',
    '.job-details-jobs-unified-top-card',
    '.jobs-unified-top-card',
    '.top-card-layout',
    '[data-view-name="job-details-top-card"]',
    '.premium-upsell',
    '[class*="premium-upsell"]',
    '.job-details-jobs-unified-top-card__primary-description-container',
  ];
  clone.querySelectorAll(noiseSelectors.join(',')).forEach((el) => el.remove());

  // Also remove elements with interactive or UI footer keywords
  clone.querySelectorAll('*').forEach((el) => {
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.classList.contains('artdeco-button') ||
      el.classList.contains('jobs-description__footer-button')
    ) {
      if (/^(show\s+more|show\s+less|report\s+this\s+job|dismiss)$/i.test(text)) {
        el.remove();
      }
    }
  });

  // 3. Node walker tracking structure
  let result = '';
  const listStack: Array<{ type: 'ul' | 'ol'; counter: number }> = [];
  let inListItem = false;

  function ensureNewline(count: number) {
    let currentNewlines = 0;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i] === '\n') {
        currentNewlines++;
      } else if (result[i] !== ' ' && result[i] !== '\t') {
        break;
      }
    }
    const needed = count - currentNewlines;
    for (let i = 0; i < needed; i++) {
      result += '\n';
    }
  }

  function walk(node: Node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node.textContent || '';
      if (!text) return;
      const parentTag = (node.parentElement?.tagName || '').toUpperCase();
      if (parentTag === 'CODE' || parentTag === 'PRE') {
        result += text;
      } else {
        const normalized = text.replace(/[\t\r\n ]+/g, ' ');
        result += normalized;
      }
      return;
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) {
      return;
    }

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    if (!el.hasChildNodes()) {
      if (tag === 'BR') {
        result += '\n';
      }
      return;
    }

    switch (tag) {
      case 'H1':
      case 'H2': {
        ensureNewline(2);
        result += '## ';
        walkChildren(el);
        ensureNewline(2);
        break;
      }
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        ensureNewline(2);
        result += '### ';
        walkChildren(el);
        ensureNewline(2);
        break;
      }
      case 'UL': {
        ensureNewline(1);
        listStack.push({ type: 'ul', counter: 1 });
        walkChildren(el);
        listStack.pop();
        ensureNewline(1);
        break;
      }
      case 'OL': {
        ensureNewline(1);
        listStack.push({ type: 'ol', counter: 1 });
        walkChildren(el);
        listStack.pop();
        ensureNewline(1);
        break;
      }
      case 'LI': {
        ensureNewline(1);
        const prevInListItem = inListItem;
        inListItem = true;
        const currentList = listStack[listStack.length - 1];
        const indent = '  '.repeat(Math.max(0, listStack.length - 1));
        if (currentList && currentList.type === 'ol') {
          result += `${indent}${currentList.counter++}. `;
        } else {
          result += `${indent}- `;
        }
        walkChildren(el);
        inListItem = prevInListItem;
        ensureNewline(1);
        break;
      }
      case 'P': {
        if (inListItem) {
          walkChildren(el);
        } else {
          ensureNewline(2);
          const rawText = el.textContent?.trim() || '';
          if (/^[•*–-]\s+/.test(rawText)) {
            result += '- ';
            const firstChild = el.firstChild;
            if (firstChild && firstChild.nodeType === 3) {
              const stripped = (firstChild.textContent || '').replace(/^[•*–-]\s+/, '');
              result += stripped.replace(/[\t\r\n ]+/g, ' ');
              let sib = firstChild.nextSibling;
              while (sib) {
                walk(sib);
                sib = sib.nextSibling;
              }
            } else {
              walkChildren(el);
            }
            ensureNewline(1);
          } else if (
            el.children.length === 1 &&
            (el.children[0].tagName === 'STRONG' || el.children[0].tagName === 'B') &&
            el.children[0].textContent?.trim() === rawText &&
            rawText.length < 80
          ) {
            result += `### ${rawText}`;
            ensureNewline(2);
          } else {
            walkChildren(el);
            ensureNewline(2);
          }
        }
        break;
      }
      case 'A': {
        const href = el.getAttribute('href')?.trim();
        const anchorText = el.textContent?.trim() || '';
        if (href && href.startsWith('http') && anchorText) {
          result += `[${anchorText}](${href})`;
        } else {
          walkChildren(el);
        }
        break;
      }
      case 'STRONG':
      case 'B': {
        result += '**';
        walkChildren(el);
        result += '**';
        break;
      }
      case 'EM':
      case 'I': {
        result += '*';
        walkChildren(el);
        result += '*';
        break;
      }
      case 'CODE': {
        result += '`';
        walkChildren(el);
        result += '`';
        break;
      }
      case 'BR': {
        result += '\n';
        break;
      }
      case 'HR': {
        ensureNewline(2);
        result += '---';
        ensureNewline(2);
        break;
      }
      default: {
        const hasBlockChildren = Array.from(el.children).some((child) =>
          ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'DIV', 'SECTION', 'ARTICLE'].includes(
            child.tagName.toUpperCase()
          )
        );
        if (hasBlockChildren) {
          walkChildren(el);
        } else {
          const isTopContainer = !inListItem && ['DIV', 'SECTION', 'ARTICLE'].includes(tag);
          if (isTopContainer && (el.textContent || '').trim().length > 0) {
            ensureNewline(2);
            walkChildren(el);
            ensureNewline(2);
          } else {
            walkChildren(el);
          }
        }
        break;
      }
    }
  }

  function walkChildren(parent: Element) {
    let child = parent.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  walk(clone);

  // 4. Post-processing hygiene
  const cleaned = result
    .replace(/^[ \t]*[•*–][ \t]+/gm, '- ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*\s*\*\*/g, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}


export interface CandidateScoreBreakdown {
  totalScore: number;
  pedigreeScore: number;
  containmentScore: number;
  richnessScore: number;
  vocabularyScore: number;
  noisePenalty: number;
}

export function scoreDescriptionCandidate(candidate: Element, activePane: Element | Document | null): CandidateScoreBreakdown {
  let pedigreeScore = 0;
  let containmentScore = 0;
  let richnessScore = 0;
  let vocabularyScore = 0;
  let noisePenalty = 0;

  const text = (candidate.textContent || '').trim();
  const lower = text.toLowerCase();

  // 1. Container Pedigree
  if (
    candidate.matches(
      '.show-more-less-html__markup, .description__text--rich, .jobs-description__content, .jobs-box__html-content'
    )
  ) {
    pedigreeScore += 60;
  } else if (
    candidate.matches('article.jobs-description__container, .jobs-description, .jobs-description-content__text, div[class*="jobs-description"], section[class*="description"]')
  ) {
    pedigreeScore += 40;
  } else if (candidate.matches('section.core-section-container.description')) {
    pedigreeScore += 30;
  } else if (candidate.matches('section.core-section-container, article')) {
    pedigreeScore += 10;
  } else if (candidate.matches('.jobs-details__heading-container, h1, h2, h3, h4, h5, h6')) {
    pedigreeScore -= 80; // Isolated heading shells
  }

  // 2. Detail Pane Containment
  if (activePane && (activePane === candidate.ownerDocument || activePane.contains(candidate))) {
    containmentScore += 25;
  } else {
    containmentScore -= 50;
  }

  // 3. Structural Richness
  const paragraphs = candidate.querySelectorAll('p').length;
  const listItems = candidate.querySelectorAll('li').length;
  const subheadings = candidate.querySelectorAll('strong, b, h3, h4').length;
  richnessScore += Math.min(paragraphs * 3, 20);
  richnessScore += Math.min(listItems * 2, 20);
  richnessScore += Math.min(subheadings * 2, 10);

  // 4. Job Description Semantic Vocabulary
  const vocabMatches = (
    lower.match(
      /\b(?:responsibilities|qualifications|requirements|about the (?:role|company)|looking for|experience|skills|internship|benefits|summary|overview)\b/gi
    ) || []
  ).length;
  vocabularyScore += Math.min(vocabMatches * 5, 25);

  // 5. Anti-Patterns & Rejection Penalties
  // Disqualify candidates that wrap or contain top-card components
  const hasTopCardArtifacts =
    candidate.querySelector(
      '.job-details-jobs-unified-top-card, .jobs-unified-top-card, .top-card-layout, [data-view-name="job-details-top-card"], [class*="topcard__flavor"], .job-details-jobs-unified-top-card__primary-description-container, button.jobs-apply-button, button.jobs-save-button, [class*="job-details-jobs-unified-top-card"]'
    ) !== null;
  if (hasTopCardArtifacts) {
    noisePenalty -= 300;
  }

  if (candidate.querySelector('.premium-upsell, [class*="premium-upsell"]')) {
    noisePenalty -= 100;
  }

  if (/^#*\s*(?:about\s+the\s+job|job\s+details|description|role\s+overview)$/i.test(text.trim()) || text.trim().length < 8) {
    noisePenalty -= 100; // Pure heading shell or trivial noise
  } else if (text.trim().length < 30) {
    noisePenalty -= 15; // Suspiciously short: mild penalty, handled via field quality uncertainty
  }
  if (
    candidate.matches('.message-the-recruiter, .find-a-referral, .similar-jobs') ||
    candidate.closest('.message-the-recruiter, .find-a-referral, .similar-jobs')
  ) {
    noisePenalty -= 100;
  }
  if (candidate.closest('.scaffold-layout__list, .jobs-search-results-list')) {
    noisePenalty -= 100;
  }

  const totalScore = pedigreeScore + containmentScore + richnessScore + vocabularyScore + noisePenalty;
  return { totalScore, pedigreeScore, containmentScore, richnessScore, vocabularyScore, noisePenalty };
}

export function isMeaningfulDescription(markdown: string | null | undefined): boolean {
  if (!markdown) return false;
  const cleaned = markdown.trim();
  if (/^#+\s*about\s+the\s+job$/i.test(cleaned)) return false;
  if (/^about\s+the\s+job$/i.test(cleaned)) return false;
  if (/^show\s+more$/i.test(cleaned)) return false;
  if (/^show\s+less$/i.test(cleaned)) return false;
  if (/^loading\.{3,}$/i.test(cleaned)) return false;
  // Reject pure trivial noise (< 15 characters)
  if (cleaned.length < 15) return false;
  return true;
}

export function parseSalaryStructured(text: string | null | undefined): string | null {
  if (!text) return null;
  const raw = text.trim();
  if (/competitive\s+salary|salary\s+depends\s+on|depends\s+on\s+experience|\bdoe\b|unspecified/i.test(raw)) {
    return null;
  }
  const freq = "(?:annually|annual|years?|yr\\.?|months?|mo\\.?|hours?|hr\\.?|weeks?|wk\\.?)";
  const salaryRegexes = [
    new RegExp("(?:[$₹€£]|(?:USD|INR|EUR|GBP|CAD|AUD|SGD|CHF)\\s*)\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:k|K|M)?(?:\\s*(?:-|–|to)\\s*(?:[$₹€£]|(?:USD|INR|EUR|GBP|CAD|AUD|SGD|CHF)\\s*)?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:k|K|M)?)?(?:\\s*(?:\\/|\\bper\\b|\\ba\\b)\\s*" + freq + ")?", "i"),
    new RegExp("[\\d,]+(?:\\.\\d+)?\\s*(?:k|K|M)?(?:\\s*(?:-|–|to)\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:k|K|M)?)?\\s*(?:[$₹€£]|(?:USD|INR|EUR|GBP|CAD|AUD|SGD|CHF))(?:\\s*(?:\\/|\\bper\\b|\\ba\\b)\\s*" + freq + ")?", "i"),
  ];

  for (const regex of salaryRegexes) {
    const match = raw.match(regex);
    if (match && match[0]) {
      const candidate = match[0].trim();
      const hasCurrency = /[$₹€£]|(?:USD|INR|EUR|GBP|CAD|AUD|SGD|CHF)/i.test(candidate);
      const hasDigit = /\d/.test(candidate);
      if (hasCurrency && hasDigit) {
        if (/^(?:19|20)\d{2}$/.test(candidate)) continue;
        if (/applicant/i.test(candidate)) continue;
        return candidate.replace(/\s+/g, ' ');
      }
    }
  }
  return null;
}

export abstract class BaseJobExtractor {
  abstract readonly platform: SourcePlatform;

  abstract matches(url: string, document: Document): boolean;

  abstract extract(document: Document, url: string): ExtractedJobData;

  protected cleanText(text: string | null | undefined): string | null {
    if (!text) return null;
    const cleaned = text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  protected parseSalary(text: string | null | undefined): string | null {
    return parseSalaryStructured(text);
  }

  protected detectWorkMode(text: string | null | undefined): WorkMode {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/\bremote\b|\bwork from home\b|\bwfh\b|\btelecommute\b/i.test(lower)) {
      return 'remote';
    }
    if (/\bhybrid\b|\bflexible\b/i.test(lower)) {
      return 'hybrid';
    }
    if (/\bonsite\b|\bon-site\b|\bin-office\b|\bon premises\b/i.test(lower)) {
      return 'onsite';
    }
    return null;
  }

  protected detectEmploymentType(text: string | null | undefined): EmploymentType {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/\bfull[_\- ]?time\b|\bpermanent\b|\bregular\b/i.test(lower)) {
      return 'full_time';
    }
    if (/\bpart[_\- ]?time\b/i.test(lower)) {
      return 'part_time';
    }
    if (/\bcontract\b|\bfreelance\b|\btemp\b|\btemporary\b/i.test(lower)) {
      return 'contract';
    }
    if (/\bintern\b|\binternship\b|\bco-op\b/i.test(lower)) {
      return 'internship';
    }
    return null;
  }

  protected sanitizeHtml(html: string | null | undefined, maxChars: number = 50000): string | null {
    if (!html) return null;
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .trim();

    if (cleaned.length > maxChars) {
      cleaned = cleaned.substring(0, maxChars) + '...';
    }
    return cleaned.length > 0 ? cleaned : null;
  }

  protected calculateConfidence(data: {
    title: string | null;
    company: string | null;
    location: string | null;
    descriptionText: string | null;
    salaryRaw: string | null;
    workMode: WorkMode;
    employmentType?: EmploymentType;
  }): { score: number; detected: string[]; missing: string[] } {
    const detected: string[] = [];
    const missing: string[] = [];

    let score = 0.0;

    if (data.title) {
      score += 0.35;
      detected.push('title');
    } else {
      missing.push('title');
    }

    if (data.company) {
      score += 0.30;
      detected.push('company');
    } else {
      missing.push('company');
    }

    if (data.descriptionText && data.descriptionText.length > 50) {
      score += 0.20;
      detected.push('descriptionText');
    } else {
      missing.push('descriptionText');
    }

    if (data.location) {
      score += 0.08;
      detected.push('location');
    } else {
      missing.push('location');
    }

    if (data.workMode) {
      score += 0.025;
      detected.push('workMode');
    } else {
      missing.push('workMode');
    }

    if (data.salaryRaw) {
      score += 0.025;
      detected.push('salaryRaw');
    } else {
      missing.push('salaryRaw');
    }

    if (data.employmentType) {
      score += 0.02;
      detected.push('employmentType');
    } else {
      missing.push('employmentType');
    }

    return {
      score: Math.min(1.0, Math.round(score * 100) / 100),
      detected,
      missing,
    };
  }
}
