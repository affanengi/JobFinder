import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  AtsScanResult,
  KeywordMatrix,
  KeywordMatchDetail,
  BulletAuditItem,
  ChecklistItem,
} from '../types/scanner';

/**
 * Escapes unsafe characters for safe inclusion in raw HTML.
 */
export function escapeHtml(unsafe: any): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface ReportMeta {
  reportName: string;
  sourceType?: 'tailored_resume' | 'file_upload';
  overallScore: number;
  grade: string;
  createdAt?: string;
  summary?: string;
}

// Standard A4 dimensions at 96 DPI
const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
const PAGE_PADDING_X = 28;
const PAGE_PADDING_Y = 24;
const PAGE_BODY_MAX_HEIGHT = 970; // Guaranteed safe budget between header and footer
const GAP_BETWEEN_BLOCKS = 12;
const PREFERRED_BULLETS_PER_PAGE = 5;

function getScoreColor(score: number): string {
  if (score >= 80) return '#34d399';
  if (score >= 65) return '#fbbf24';
  return '#f87171';
}

function getScoreBg(score: number): string {
  if (score >= 80) return 'rgba(52, 211, 153, 0.12)';
  if (score >= 65) return 'rgba(251, 191, 36, 0.12)';
  return 'rgba(248, 113, 113, 0.12)';
}

function getStatusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'pass' || s === 'strong') return '#34d399';
  if (s === 'warning' || s === 'moderate') return '#fbbf24';
  return '#f87171';
}

function getStatusBg(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'pass' || s === 'strong') return 'rgba(52, 211, 153, 0.12)';
  if (s === 'warning' || s === 'moderate') return 'rgba(251, 191, 36, 0.12)';
  return 'rgba(248, 113, 113, 0.12)';
}

interface PageHandle {
  pageEl: HTMLElement;
  bodyEl: HTMLElement;
  pageIndex: number;
}

/**
 * Creates an offscreen measurement sandbox to compute actual rendered heights
 * before placing content elements onto A4 pages.
 */
function createMeasureSandbox(): {
  sandbox: HTMLElement;
  measure: (el: HTMLElement) => number;
  cleanup: () => void;
} {
  const sandbox = document.createElement('div');
  sandbox.id = 'ats-render-measure-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-9999px';
  sandbox.style.top = '0';
  sandbox.style.width = `${PAGE_WIDTH_PX}px`;
  sandbox.style.padding = `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`;
  sandbox.style.boxSizing = 'border-box';
  sandbox.style.visibility = 'hidden';
  sandbox.style.pointerEvents = 'none';
  sandbox.style.zIndex = '-9999';
  sandbox.style.background = '#121212';
  sandbox.style.color = '#ffffff';
  sandbox.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  document.body.appendChild(sandbox);

  const measure = (el: HTMLElement): number => {
    sandbox.appendChild(el);
    const height = Math.ceil(el.getBoundingClientRect().height || el.offsetHeight);
    sandbox.removeChild(el);
    return height;
  };

  const cleanup = () => {
    if (document.body.contains(sandbox)) {
      document.body.removeChild(sandbox);
    }
  };

  return { sandbox, measure, cleanup };
}

/**
 * Creates a discrete A4 page frame with uniform running header and running footer.
 */
function createA4Page(pageIndex: number, meta: ReportMeta, report: AtsScanResult): PageHandle {
  const pageEl = document.createElement('div');
  pageEl.className = 'ats-export-page';
  pageEl.style.width = `${PAGE_WIDTH_PX}px`;
  pageEl.style.minHeight = `${PAGE_HEIGHT_PX}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.padding = `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`;
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';
  pageEl.style.justifyContent = 'space-between';
  pageEl.style.backgroundColor = '#121212';
  pageEl.style.color = '#ffffff';
  pageEl.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  pageEl.style.position = 'relative';
  pageEl.style.overflow = 'visible';

  const scoreColor = getScoreColor(report.overall_score);
  const scoreBg = getScoreBg(report.overall_score);
  const dateStr = new Date(meta.createdAt || Date.now()).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const sourceLabel = meta.sourceType === 'file_upload' ? 'DIRECT FILE AUDIT' : 'TAILORED RESUME AUDIT';

  // Running Header
  const headerEl = document.createElement('div');
  headerEl.className = 'ats-page-header';
  headerEl.style.display = 'flex';
  headerEl.style.justifyContent = 'space-between';
  headerEl.style.alignItems = 'center';
  headerEl.style.borderBottom = '1px solid rgba(255, 255, 255, 0.12)';
  headerEl.style.paddingBottom = '8px';
  headerEl.style.marginBottom = '12px';
  headerEl.style.boxSizing = 'border-box';

  headerEl.innerHTML = `
    <div style="max-width: 490px;">
      <div style="font-size: 13px; font-weight: 700; color: #ffffff; letter-spacing: -0.01em; line-height: 1.4; padding-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(meta.reportName)}
      </div>
      <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em;">
        ${sourceLabel} • Evaluated on ${dateStr}
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); color: #e4e4e7; border: 1px solid rgba(255, 255, 255, 0.15);">
        Score: ${report.overall_score}/100
      </span>
      <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 3px 10px; border-radius: 6px; color: ${scoreColor}; background: ${scoreBg}; border: 1px solid ${scoreColor};">
        Grade ${escapeHtml(report.grade)}
      </span>
    </div>
  `;
  pageEl.appendChild(headerEl);

  // Body Slot
  const bodyEl = document.createElement('div');
  bodyEl.className = 'ats-page-body';
  bodyEl.style.flex = '1';
  bodyEl.style.display = 'flex';
  bodyEl.style.flexDirection = 'column';
  bodyEl.style.gap = `${GAP_BETWEEN_BLOCKS}px`;
  bodyEl.style.overflow = 'visible';
  bodyEl.style.boxSizing = 'border-box';
  pageEl.appendChild(bodyEl);

  // Running Footer
  const footerEl = document.createElement('div');
  footerEl.className = 'ats-page-footer';
  footerEl.style.display = 'flex';
  footerEl.style.justifyContent = 'space-between';
  footerEl.style.alignItems = 'center';
  footerEl.style.borderTop = '1px solid rgba(255, 255, 255, 0.10)';
  footerEl.style.paddingTop = '8px';
  footerEl.style.marginTop = '8px';
  footerEl.style.fontSize = '9px';
  footerEl.style.fontFamily = "'JetBrains Mono', monospace";
  footerEl.style.color = '#71717a';
  footerEl.style.boxSizing = 'border-box';

  footerEl.innerHTML = `
    <span>JobFinder Career OS • Verified Grounded ATS Evaluation</span>
    <span class="ats-page-number">Page ${pageIndex}</span>
  `;
  pageEl.appendChild(footerEl);

  return { pageEl, bodyEl, pageIndex };
}

/**
 * Builds the Executive Summary Hero Card from report data.
 */
function createHeroCard(report: AtsScanResult): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ats-hero-card';
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  card.style.borderRadius = '14px';
  card.style.padding = '18px';
  card.style.boxSizing = 'border-box';

  const score = report.overall_score;
  const scoreColor = getScoreColor(score);
  const scoreBg = getScoreBg(score);

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(Math.max(score, 0), 100) / 100) * circumference;

  const wordCount = report.metadata?.word_count || 0;
  const readTime = report.metadata?.estimated_read_time || '2 min';
  const matchedKeywords = report.keyword_matrix?.matched_count ?? (report.keyword_matrix?.matched?.length || 0);
  const totalKeywords = report.keyword_matrix?.total_jd_keywords || (matchedKeywords + (report.keyword_matrix?.missing_count ?? 0));
  const strongBullets = (report.bullet_audits || []).filter((b) => b.status === 'strong').length;
  const totalBullets = (report.bullet_audits || []).length;
  const actionVerbs = (report.bullet_audits || []).filter((b) => b.has_action_verb).length;
  const quantified = (report.bullet_audits || []).filter((b) => b.has_metric).length;

  card.innerHTML = `
    <div style="display: flex; gap: 20px; align-items: center;">
      <!-- Pure SVG Radial Gauge -->
      <div style="position: relative; width: 92px; height: 92px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
        <svg width="92" height="92" viewBox="0 0 100 100" style="transform: rotate(-90deg);">
          <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="#262626" stroke-width="8"></circle>
          <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="${scoreColor}" stroke-width="8"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round"></circle>
        </svg>
        <div style="position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
          <span style="font-size: 24px; font-weight: 800; color: #ffffff; font-family: 'JetBrains Mono', monospace; line-height: 1;">${score}</span>
          <span style="font-size: 9px; color: #71717a; font-family: 'JetBrains Mono', monospace; margin-top: 1px;">/ 100</span>
        </div>
      </div>

      <!-- Hero Header & Grounded Summary -->
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 2px 8px; border-radius: 4px; color: ${scoreColor}; background: ${scoreBg}; border: 1px solid ${scoreColor};">
            Grade ${escapeHtml(report.grade)}
          </span>
          <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa;">
            ${wordCount} words • ~${escapeHtml(readTime)} read
          </span>
        </div>
        <div style="font-size: 14px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 6px;">
          ATS Executive Diagnostic Summary
        </div>
        <div style="font-size: 11px; color: #d4d4d8; line-height: 1.55; word-wrap: break-word; overflow-wrap: break-word; white-space: normal;">
          ${escapeHtml(report.summary)}
        </div>
      </div>
    </div>

    <!-- Quick Stats Metric Ribbon -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
      <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #888888; text-transform: uppercase;">Matched Keywords</div>
        <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
          ${matchedKeywords} / ${totalKeywords}
        </div>
      </div>
      <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #888888; text-transform: uppercase;">Strong Bullets</div>
        <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
          ${strongBullets} / ${totalBullets}
        </div>
      </div>
      <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #888888; text-transform: uppercase;">Action Verbs</div>
        <div style="font-size: 13px; font-weight: 700; color: ${actionVerbs === totalBullets ? '#34d399' : '#fbbf24'}; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
          ${actionVerbs} / ${totalBullets}
        </div>
      </div>
      <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #888888; text-transform: uppercase;">Quantified Metrics</div>
        <div style="font-size: 13px; font-weight: 700; color: ${quantified >= Math.ceil(totalBullets / 2) ? '#34d399' : '#fbbf24'}; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
          ${quantified} / ${totalBullets}
        </div>
      </div>
    </div>
  `;

  return card;
}

/**
 * Builds Category Score Pillars card, iterating all entries in report.category_scores.
 */
function createCategoryPillarsCard(report: AtsScanResult): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ats-pillars-card';
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  card.style.borderRadius = '14px';
  card.style.padding = '16px';
  card.style.boxSizing = 'border-box';

  const categories = Object.entries(report.category_scores || {});

  const pillarsHtml = categories
    .map(([_key, cat]) => {
      const statusColor = getStatusColor(cat.status);
      const statusBg = getStatusBg(cat.status);
      const pct = Math.min(Math.max(cat.percentage || 0, 0), 100);

      return `
      <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: 700; color: #ffffff; line-height: 1.3;">
              ${escapeHtml(cat.name)}
            </span>
            <span style="font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${statusColor}; flex-shrink: 0;">
              ${cat.score} / ${cat.max_score}
            </span>
          </div>
          <div style="width: 100%; height: 5px; background: #262626; border-radius: 999px; overflow: hidden; margin-bottom: 8px;">
            <div style="height: 100%; width: ${pct}%; background: ${statusColor}; border-radius: 999px;"></div>
          </div>
        </div>
        <div>
          <div style="font-size: 10px; color: #a1a1aa; line-height: 1.45; word-wrap: break-word; overflow-wrap: break-word; margin-bottom: 6px;">
            ${escapeHtml(cat.summary)}
          </div>
          <span style="display: inline-block; font-size: 9px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; color: ${statusColor}; background: ${statusBg};">
            ${escapeHtml(cat.status)}
          </span>
        </div>
      </div>
    `;
    })
    .join('');

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 10px; margin-bottom: 12px;">
      <span style="font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">
        ATS Scoring Pillars (${categories.length} Evaluated)
      </span>
      <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #888888;">
        Deterministic Pillar Weights
      </span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
      ${pillarsHtml}
    </div>
  `;

  return card;
}

/**
 * Builds the Keyword Matrix Summary Bar.
 */
function createKeywordSummaryCard(matrix: KeywordMatrix): HTMLElement {
  const card = document.createElement('div');
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 16px';
  card.style.boxSizing = 'border-box';

  const matched = matrix.matched_count ?? (matrix.matched?.length || 0);
  const missing = matrix.missing_count ?? (matrix.missing?.length || 0);
  const transferable = matrix.transferable_count ?? (matrix.transferable?.length || 0);
  const total = matrix.total_jd_keywords || (matched + missing);
  const matchPct = matrix.match_percentage ?? Math.round((matched / Math.max(total, 1)) * 100);

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 8px; margin-bottom: 10px;">
      <span style="font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">
        Technical Keyword &amp; Competency Alignment Matrix
      </span>
      <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #34d399; font-weight: 700;">
        ${matchPct}% Match Rate
      </span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
      <div style="background: #0f0f11; border: 1px solid rgba(52, 211, 153, 0.2); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; text-transform: uppercase;">Matched Skills</div>
        <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">${matched}</div>
      </div>
      <div style="background: #0f0f11; border: 1px solid rgba(248, 113, 113, 0.2); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; text-transform: uppercase;">Missing Keywords</div>
        <div style="font-size: 13px; font-weight: 700; color: #f87171; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">${missing}</div>
      </div>
      <div style="background: #0f0f11; border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px; text-align: center;">
        <div style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; text-transform: uppercase;">Transferable Skills</div>
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">${transferable}</div>
      </div>
    </div>
  `;
  return card;
}

/**
 * Builds Matched Keywords card with emerald chips.
 */
function createMatchedKeywordsCard(matchedList: KeywordMatchDetail[]): HTMLElement {
  const card = document.createElement('div');
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(52, 211, 153, 0.2)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 14px';
  card.style.boxSizing = 'border-box';

  const chips = matchedList
    .map(
      (kw) => `
    <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 600; padding: 4px 8px; border-radius: 6px; background: rgba(52, 211, 153, 0.12); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3);">
      ✓ ${escapeHtml(kw.name)}
      ${kw.category ? `<span style="font-size: 8px; color: #a7f3d0; opacity: 0.8;">• ${escapeHtml(kw.category)}</span>` : ''}
    </span>
  `
    )
    .join('');

  card.innerHTML = `
    <div style="font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; color: #34d399; margin-bottom: 8px; display: flex; justify-content: space-between;">
      <span>Matched Keywords (${matchedList.length})</span>
      <span style="color: #a1a1aa; font-weight: 400;">Verified in Candidate Resume</span>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
      ${chips}
    </div>
  `;
  return card;
}

/**
 * Builds Missing Keywords card with rose chips.
 */
function createMissingKeywordsCard(missingList: KeywordMatchDetail[]): HTMLElement {
  const card = document.createElement('div');
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(248, 113, 113, 0.2)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 14px';
  card.style.boxSizing = 'border-box';

  const chips = missingList
    .map(
      (kw) => `
    <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 600; padding: 4px 8px; border-radius: 6px; background: rgba(248, 113, 113, 0.12); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3);">
      ✕ ${escapeHtml(kw.name)}
      ${kw.importance ? `<span style="font-size: 8px; color: #fecaca; opacity: 0.9;">(${escapeHtml(kw.importance)})</span>` : ''}
    </span>
  `
    )
    .join('');

  card.innerHTML = `
    <div style="font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; color: #f87171; margin-bottom: 8px; display: flex; justify-content: space-between;">
      <span>Missing Keywords (${missingList.length})</span>
      <span style="color: #a1a1aa; font-weight: 400;">Recommended for Next Revision</span>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
      ${chips}
    </div>
  `;
  return card;
}

/**
 * Builds Transferable Keywords card with sky blue chips.
 */
function createTransferableKeywordsCard(transferableList: KeywordMatchDetail[]): HTMLElement {
  const card = document.createElement('div');
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(56, 189, 248, 0.2)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 14px';
  card.style.boxSizing = 'border-box';

  const chips = transferableList
    .map(
      (kw) => `
    <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 600; padding: 4px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
      ⇄ ${escapeHtml(kw.name)}
      ${kw.category ? `<span style="font-size: 8px; color: #bae6fd; opacity: 0.8;">• ${escapeHtml(kw.category)}</span>` : ''}
    </span>
  `
    )
    .join('');

  card.innerHTML = `
    <div style="font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; color: #38bdf8; margin-bottom: 8px; display: flex; justify-content: space-between;">
      <span>Transferable &amp; Adjacent Skills (${transferableList.length})</span>
      <span style="color: #a1a1aa; font-weight: 400;">Complementary Strengths</span>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
      ${chips}
    </div>
  `;
  return card;
}

/**
 * Builds Priority Checklist card from report.actionable_checklist.
 */
function createChecklistCard(items: ChecklistItem[]): HTMLElement {
  const card = document.createElement('div');
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 14px';
  card.style.boxSizing = 'border-box';

  const itemsHtml = items
    .slice(0, 8)
    .map((item) => {
      const isPassed = item.passed;
      const badgeColor = isPassed ? '#34d399' : '#f87171';
      const badgeBg = isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)';
      return `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <div style="min-width: 0;">
          <div style="font-size: 11px; font-weight: 600; color: #ffffff;">${escapeHtml(item.title)}</div>
          <div style="font-size: 10px; color: #a1a1aa; line-height: 1.4;">${escapeHtml(item.description)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${badgeColor}; background: ${badgeBg}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
            ${isPassed ? 'PASSED' : 'ACTION'}
          </span>
          <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa;">
            +${item.impact_points} pts
          </span>
        </div>
      </div>
    `;
    })
    .join('');

  card.innerHTML = `
    <div style="font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; margin-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 6px;">
      Actionable ATS Priority Checklist
    </div>
    <div style="display: flex; flex-direction: column;">
      ${itemsHtml}
    </div>
  `;
  return card;
}

/**
 * Builds a single bullet audit card with real text-wrapping and zero overlap.
 */
function createBulletAuditCard(bullet: BulletAuditItem, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ats-bullet-card';
  card.style.backgroundColor = '#161616';
  card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  card.style.borderRadius = '12px';
  card.style.padding = '12px 14px';
  card.style.boxSizing = 'border-box';

  const statusColor = getStatusColor(bullet.status);
  const statusBg = getStatusBg(bullet.status);
  const scoreColor = getScoreColor(bullet.score);

  const verbBadge = bullet.has_action_verb
    ? `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #34d399; background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.25); padding: 2px 6px; border-radius: 4px;">✓ Verb: ${escapeHtml(bullet.verb || 'Active')}</span>`
    : `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #f87171; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.25); padding: 2px 6px; border-radius: 4px;">✕ No Action Verb</span>`;

  const metricBadge = bullet.has_metric
    ? `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #34d399; background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.25); padding: 2px 6px; border-radius: 4px;">✓ Metric Included</span>`
    : `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #fbbf24; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); padding: 2px 6px; border-radius: 4px;">⚠ Unquantified</span>`;

  const openerBadge = bullet.has_weak_opener
    ? `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #f87171; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.25); padding: 2px 6px; border-radius: 4px;">⚠ Weak Opener</span>`
    : `<span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 2px 6px; border-radius: 4px;">✓ Direct</span>`;

  const issuesHtml =
    bullet.issues && bullet.issues.length > 0
      ? `
      <div style="margin-top: 8px; padding: 6px 10px; background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 6px; font-size: 10px; color: #fde68a; line-height: 1.45;">
        ${bullet.issues.map((iss) => `<div>• ${escapeHtml(iss)}</div>`).join('')}
      </div>
    `
      : '';

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
      <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; min-width: 0; flex: 1;">
        <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #ffffff; background: #262626; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;">
          #${index}
        </span>
        <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #34d399; background: rgba(52, 211, 153, 0.08); border: 1px solid rgba(52, 211, 153, 0.2); padding: 2px 6px; border-radius: 4px; text-transform: uppercase; flex-shrink: 0;">
          ${escapeHtml(bullet.section)}
        </span>
        <span style="font-size: 11px; font-weight: 600; color: #f4f4f5; line-height: 1.4; word-break: break-word; overflow-wrap: break-word; overflow: visible;">
          ${escapeHtml(bullet.role_or_project)}
        </span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding-top: 1px;">
        <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${scoreColor};">
          ${bullet.score}/100
        </span>
        <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${statusColor}40;">
          ${escapeHtml(bullet.status)}
        </span>
      </div>
    </div>

    <!-- Feature Flags Row -->
    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
      ${verbBadge}
      ${metricBadge}
      ${openerBadge}
      <span style="font-size: 9px; font-family: 'JetBrains Mono', monospace; color: #71717a; margin-left: auto;">
        ${bullet.word_count} words
      </span>
    </div>

    <!-- Bullet Text (word-wrap break-word to prevent overlap) -->
    <div style="background: #0f0f11; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #e4e4e7; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; white-space: normal;">
      ${escapeHtml(bullet.text)}
    </div>

    ${issuesHtml}
  `;

  return card;
}

function createBulletSectionHeader(totalBullets: number): HTMLElement {
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.10)';
  header.style.paddingBottom = '8px';
  header.style.marginBottom = '4px';
  header.style.boxSizing = 'border-box';

  header.innerHTML = `
    <span style="font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">
      Bullet-by-Bullet Impact &amp; Metric Audit (${totalBullets} Total)
    </span>
    <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #34d399;">
      Action Verbs &amp; Quantified Outcomes
    </span>
  `;
  return header;
}

function createBulletContinuationHeader(startIndex: number, totalBullets: number): HTMLElement {
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.10)';
  header.style.paddingBottom = '8px';
  header.style.marginBottom = '4px';
  header.style.boxSizing = 'border-box';

  header.innerHTML = `
    <span style="font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.05em; color: #34d399;">
      Bullet Impact Audits (Continued — Items #${startIndex} to #${Math.min(startIndex + PREFERRED_BULLETS_PER_PAGE - 1, totalBullets)})
    </span>
    <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa;">
      Page Breakdown
    </span>
  `;
  return header;
}

/**
 * Builds discrete, beautifully styled A4 page elements directly from the AtsScanResult.
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * The renderer is designed to prevent overlap and clipping by measuring content before
 * placement and inserting page breaks when necessary.
 */
export function buildStructuredA4Pages(
  report: AtsScanResult,
  meta: ReportMeta
): HTMLElement[] {
  const { measure, cleanup } = createMeasureSandbox();

  try {
    const pages: PageHandle[] = [];

    const addNewPage = (): PageHandle => {
      const pageIndex = pages.length + 1;
      const page = createA4Page(pageIndex, meta, report);
      pages.push(page);
      return page;
    };

    let currentPage = addNewPage();
    let currentBodyHeight = 0;

    const appendBlockToPages = (blockEl: HTMLElement, forceNewPageIfOverflow = true): void => {
      const blockHeight = measure(blockEl);
      const gap = currentPage.bodyEl.children.length > 0 ? GAP_BETWEEN_BLOCKS : 0;

      if (forceNewPageIfOverflow && currentBodyHeight + gap + blockHeight > PAGE_BODY_MAX_HEIGHT) {
        if (currentPage.bodyEl.children.length > 0) {
          currentPage = addNewPage();
          currentBodyHeight = 0;
        }
      }

      const actualGap = currentPage.bodyEl.children.length > 0 ? GAP_BETWEEN_BLOCKS : 0;
      currentPage.bodyEl.appendChild(blockEl);
      currentBodyHeight += actualGap + blockHeight;
    };

    // 1. Executive Summary Hero Card (Page 1)
    const heroCard = createHeroCard(report);
    appendBlockToPages(heroCard);

    // 2. Category Pillars Card (Dynamic Pillar Count)
    if (report.category_scores && Object.keys(report.category_scores).length > 0) {
      const pillarsCard = createCategoryPillarsCard(report);
      appendBlockToPages(pillarsCard);
    }

    // 3. Technical Keyword Alignment Matrix
    if (report.keyword_matrix) {
      const kwSummaryCard = createKeywordSummaryCard(report.keyword_matrix);
      appendBlockToPages(kwSummaryCard);

      if (report.keyword_matrix.matched && report.keyword_matrix.matched.length > 0) {
        const matchedCard = createMatchedKeywordsCard(report.keyword_matrix.matched);
        appendBlockToPages(matchedCard);
      }

      if (report.keyword_matrix.missing && report.keyword_matrix.missing.length > 0) {
        const missingCard = createMissingKeywordsCard(report.keyword_matrix.missing);
        appendBlockToPages(missingCard);
      }

      if (report.keyword_matrix.transferable && report.keyword_matrix.transferable.length > 0) {
        const transferableCard = createTransferableKeywordsCard(report.keyword_matrix.transferable);
        appendBlockToPages(transferableCard);
      }
    }

    // 4. Actionable Priority Checklist (if present)
    if (report.actionable_checklist && report.actionable_checklist.length > 0) {
      const checklistCard = createChecklistCard(report.actionable_checklist);
      appendBlockToPages(checklistCard);
    }

    // 5. Bullet-by-Bullet Impact & Metric Audits (Dynamic bullet count & measurement pagination)
    if (report.bullet_audits && report.bullet_audits.length > 0) {
      const totalBullets = report.bullet_audits.length;

      // Clean page break if current page already has substantial content
      if (currentBodyHeight > 380 && currentPage.bodyEl.children.length > 0) {
        currentPage = addNewPage();
        currentBodyHeight = 0;
      }

      const mainBulletHeader = createBulletSectionHeader(totalBullets);
      appendBlockToPages(mainBulletHeader, false);

      let bulletsOnCurrentPage = 0;

      for (let i = 0; i < totalBullets; i++) {
        const bullet = report.bullet_audits[i];
        const bulletEl = createBulletAuditCard(bullet, i + 1);
        const bulletHeight = measure(bulletEl);
        const gap = currentPage.bodyEl.children.length > 0 ? GAP_BETWEEN_BLOCKS : 0;

        const wouldOverflow = currentBodyHeight + gap + bulletHeight > PAGE_BODY_MAX_HEIGHT;
        const reachedPreferredDensity = bulletsOnCurrentPage >= PREFERRED_BULLETS_PER_PAGE;

        if ((wouldOverflow || reachedPreferredDensity) && currentPage.bodyEl.children.length > 0) {
          currentPage = addNewPage();
          currentBodyHeight = 0;
          bulletsOnCurrentPage = 0;

          const contHeader = createBulletContinuationHeader(i + 1, totalBullets);
          currentPage.bodyEl.appendChild(contHeader);
          currentBodyHeight += measure(contHeader);
        }

        const actualGap = currentPage.bodyEl.children.length > 0 ? GAP_BETWEEN_BLOCKS : 0;
        currentPage.bodyEl.appendChild(bulletEl);
        currentBodyHeight += actualGap + bulletHeight;
        bulletsOnCurrentPage++;
      }
    }

    // 6. Patch total page counts on all footers
    const totalPages = pages.length;
    pages.forEach((p, idx) => {
      const numSpan = p.pageEl.querySelector('.ats-page-number');
      if (numSpan) {
        numSpan.textContent = `Page ${idx + 1} of ${totalPages}`;
      }
    });

    return pages.map((p) => p.pageEl);
  } finally {
    cleanup();
  }
}

/**
 * 1. VISUAL RASTERIZED PDF EXPORT (html2canvas + jsPDF)
 * Slices discrete A4 pages with zero DOM scraping and guaranteed overflow protection.
 */
export async function downloadAtsReportPdf(params: {
  report: AtsScanResult;
  meta: ReportMeta;
  fileName: string;
}): Promise<void> {
  const { report, meta, fileName } = params;

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Continue if font readiness throws
    }
  }

  const sandbox = document.createElement('div');
  sandbox.id = 'ats-pdf-render-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-9999px';
  sandbox.style.top = '0';
  sandbox.style.width = `${PAGE_WIDTH_PX}px`;
  sandbox.style.zIndex = '-9999';
  sandbox.style.opacity = '0';
  sandbox.style.pointerEvents = 'none';
  sandbox.style.background = '#121212';
  document.body.appendChild(sandbox);

  try {
    const pages = buildStructuredA4Pages(report, meta);
    pages.forEach((p) => sandbox.appendChild(p));

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    for (let i = 0; i < pages.length; i++) {
      const pageEl = pages[i];
      const canvas = await html2canvas(pageEl, {
        scale: 2, // Crisp 2x resolution
        useCORS: true,
        backgroundColor: '#121212',
        logging: false,
        windowWidth: PAGE_WIDTH_PX,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pageHeightMm = Math.max(297, (canvas.height / canvas.width) * 210);
      if (i === 0) {
        if (pageHeightMm > 297.5) {
          pdf.deletePage(1);
          pdf.addPage([210, pageHeightMm], 'portrait');
        }
      } else {
        pdf.addPage([210, pageHeightMm], 'portrait');
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, pageHeightMm, undefined, 'FAST');
    }

    const cleanName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    pdf.save(cleanName);
  } finally {
    if (document.body.contains(sandbox)) {
      document.body.removeChild(sandbox);
    }
  }
}

/**
 * 2. NATIVE BROWSER VECTOR PRINT / PDF
 * Renders structured pages directly to an isolated iframe with clean vector page breaks.
 */
export function printAtsReportVector(params: {
  report: AtsScanResult;
  meta: ReportMeta;
}): void {
  const { report, meta } = params;

  const printIframe = document.createElement('iframe');
  printIframe.style.position = 'fixed';
  printIframe.style.right = '0';
  printIframe.style.bottom = '0';
  printIframe.style.width = '0';
  printIframe.style.height = '0';
  printIframe.style.border = '0';
  document.body.appendChild(printIframe);

  const doc = printIframe.contentWindow?.document;
  if (!doc) return;

  const pages = buildStructuredA4Pages(report, meta);
  const pagesHtml = pages.map((p) => p.outerHTML).join('\n');

  doc.open();
  doc.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(meta.reportName)} - ATS Resume Audit</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          html, body {
            background-color: #121212 !important;
            color: #ffffff !important;
            margin: 0;
            padding: 0;
            font-family: 'Inter', -apple-system, sans-serif;
          }
          .ats-export-page {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            margin: 0 auto;
          }
        </style>
      </head>
      <body>
        ${pagesHtml}
      </body>
    </html>
  `);
  doc.close();

  printIframe.contentWindow?.focus();
  setTimeout(() => {
    printIframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(printIframe)) {
        document.body.removeChild(printIframe);
      }
    }, 2000);
  }, 500);
}

/**
 * 3. STANDALONE OFFLINE INTERACTIVE HTML REPORT
 * Single-file portable document with all data escaped and complete inline styling.
 */
export function downloadAtsReportHtml(
  report: AtsScanResult,
  meta: ReportMeta
): void {
  const safeTitle = escapeHtml(meta.reportName);
  const safeGrade = escapeHtml(report.grade);
  const safeScore = report.overall_score;
  const safeSummary = escapeHtml(report.summary);
  const safeDate = new Date(meta.createdAt || Date.now()).toLocaleDateString();

  const scoreColor = getScoreColor(safeScore);
  const scoreBg = getScoreBg(safeScore);

  // Build Pillars HTML
  const pillarsHtml = Object.entries(report.category_scores || {})
    .map(([_k, cat]) => {
      const pName = escapeHtml(cat.name);
      const pScore = cat.score;
      const pMax = cat.max_score;
      const pStatus = escapeHtml(cat.status);
      const pColor = getStatusColor(cat.status);
      const pct = Math.min(Math.max(cat.percentage || 0, 0), 100);

      return `
        <div class="pillar-card">
          <div class="pillar-top">
            <span class="pillar-name">${pName}</span>
            <span class="pillar-score" style="color: ${pColor};">${pScore} / ${pMax}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%; background-color: ${pColor};"></div>
          </div>
          <div class="pillar-status">${pStatus}</div>
        </div>
      `;
    })
    .join('\n');

  // Build Keyword Chips HTML
  const matchedKeywordsHtml = (report.keyword_matrix?.matched || [])
    .map((kw) => `<span class="chip chip-matched">✓ ${escapeHtml(kw.name)}</span>`)
    .join('');

  const missingKeywordsHtml = (report.keyword_matrix?.missing || [])
    .map((kw) => `<span class="chip chip-missing">✕ ${escapeHtml(kw.name)}</span>`)
    .join('');

  // Build Bullet Audits HTML
  const bulletsHtml = (report.bullet_audits || [])
    .map((b) => {
      const bSection = escapeHtml(b.section);
      const bRole = escapeHtml(b.role_or_project);
      const bText = escapeHtml(b.text);
      const bScore = b.score;
      const bScoreColor = getScoreColor(bScore);
      const bScoreBg = getScoreBg(bScore);

      return `
        <div class="bullet-card">
          <div class="bullet-header">
            <span class="bullet-tag">${bSection} — ${bRole}</span>
            <span class="bullet-score" style="color: ${bScoreColor}; background: ${bScoreBg}; border: 1px solid ${bScoreColor}40;">
              Score ${bScore}/100
            </span>
          </div>
          <p class="bullet-text">${bText}</p>
        </div>
      `;
    })
    .join('\n');

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(Math.max(safeScore, 0), 100) / 100) * circumference;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — ATS Resume Audit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      background-color: #0f0f10;
      color: #f4f4f5;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 32px 16px;
      line-height: 1.5;
    }
    .container { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    .card { background-color: #141414; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 16px; }
    .header h1 { font-size: 20px; font-weight: 700; color: #ffffff; }
    .header .sub { font-size: 11px; color: #a1a1aa; font-family: 'JetBrains Mono', monospace; margin-top: 2px; }
    .grade-badge { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 6px; }
    
    .hero-layout { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .gauge-box { position: relative; width: 112px; height: 112px; display: flex; align-items: center; justify-content: center; }
    .gauge-svg { width: 112px; height: 112px; transform: rotate(-90deg); }
    .gauge-text { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .gauge-score { font-size: 26px; font-weight: 800; color: #ffffff; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .gauge-sub { font-size: 10px; color: #71717a; font-family: 'JetBrains Mono', monospace; margin-top: 2px; }

    .hero-info { flex: 1; min-width: 280px; }
    .hero-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 11px; color: #a1a1aa; font-family: 'JetBrains Mono', monospace; }
    .hero-title { font-size: 18px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 6px; }
    .hero-summary { font-size: 12px; color: #a1a1aa; line-height: 1.6; }

    .stats-row { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .stat-pill { background-color: #0D0D0D; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 12px 16px; text-align: center; flex: 1; min-width: 130px; }
    .stat-label { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-val { font-size: 15px; font-weight: 700; color: #34d399; margin-top: 2px; }

    .pillars-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
    .pillar-card { background-color: #0D0D0D; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 14px; }
    .pillar-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .pillar-name { font-size: 11px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pillar-score { font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
    .progress-bar-bg { width: 100%; height: 6px; background-color: #27272a; border-radius: 999px; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 999px; }
    .pillar-status { font-size: 10px; color: #a1a1aa; text-transform: capitalize; margin-top: 6px; }

    .section-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 12px; margin-bottom: 16px; }
    .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; }
    .chips-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { font-size: 11px; font-weight: 500; padding: 5px 12px; border-radius: 10px; display: inline-flex; align-items: center; gap: 6px; }
    .chip-matched { background-color: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.3); color: #6ee7b7; }
    .chip-missing { background-color: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.3); color: #fca5a5; }

    .bullet-card { background-color: #0D0D0D; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .bullet-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    .bullet-tag { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #a1a1aa; background-color: #1f1f23; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
    .bullet-score { font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    .bullet-text { font-size: 12px; color: #e4e4e7; line-height: 1.6; }

    .footer-note { text-align: center; font-size: 11px; color: #71717a; font-family: 'JetBrains Mono', monospace; padding-top: 12px; }

    @media print {
      body { background-color: #121212 !important; padding: 0; }
      .container { max-width: 100%; }
      .card { border-color: rgba(255, 255, 255, 0.2); page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>${safeTitle}</h1>
        <div class="sub">Saved on ${safeDate} • ${escapeHtml(meta.sourceType === 'tailored_resume' ? 'Tailored Resume Audit' : 'Direct Upload Scan')}</div>
      </div>
      <div class="grade-badge" style="color: ${scoreColor}; background: ${scoreBg}; border: 1px solid ${scoreColor};">
        Grade ${safeGrade} • ${safeScore}/100
      </div>
    </div>

    <!-- 100-Point Score Card -->
    <div class="card">
      <div class="hero-layout">
        <div class="gauge-box">
          <svg class="gauge-svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="#222" stroke-width="7"></circle>
            <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="${scoreColor}" stroke-width="7"
                    stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round"></circle>
          </svg>
          <div class="gauge-text">
            <div class="gauge-score">${safeScore}</div>
            <div class="gauge-sub">/ 100</div>
          </div>
        </div>

        <div class="hero-info">
          <div class="hero-meta">
            <span class="grade-badge" style="color: ${scoreColor}; background: ${scoreBg}; border: 1px solid ${scoreColor};">Grade ${safeGrade}</span>
            <span>${report.metadata?.word_count || 0} words • ~${escapeHtml(report.metadata?.estimated_read_time || '2.5 min')} read</span>
          </div>
          <div class="hero-title">ATS Executive Diagnostic Summary</div>
          <div class="hero-summary">${safeSummary}</div>
        </div>

        <div class="stats-row">
          <div class="stat-pill">
            <div class="stat-label">Matched Keywords</div>
            <div class="stat-val">${report.keyword_matrix?.matched_count || 0} / ${report.keyword_matrix?.total_jd_keywords || report.keyword_matrix?.matched_count || 0}</div>
          </div>
          <div class="stat-pill">
            <div class="stat-label">Strong Action Verbs</div>
            <div class="stat-val">${(report.bullet_audits || []).filter((b) => b.has_action_verb).length} / ${(report.bullet_audits || []).length}</div>
          </div>
        </div>
      </div>

      <div class="pillars-grid">
        ${pillarsHtml}
      </div>
    </div>

    <!-- Technical Keyword Alignment Matrix -->
    <div class="card">
      <div class="section-head">
        <div class="section-title">Technical Keyword Alignment Matrix</div>
        <div style="font-size: 11px; color: #a1a1aa; font-family: 'JetBrains Mono', monospace;">
          ${report.keyword_matrix?.matched_count || 0} Matched • ${report.keyword_matrix?.missing_count || 0} Missing
        </div>
      </div>
      <div class="chips-wrap">
        ${matchedKeywordsHtml}
        ${missingKeywordsHtml}
      </div>
    </div>

    <!-- Bullet Impact Audits -->
    <div class="card">
      <div class="section-head">
        <div class="section-title">Bullet Impact Audits (${(report.bullet_audits || []).length})</div>
      </div>
      <div>
        ${bulletsHtml}
      </div>
    </div>

    <div class="footer-note">
      Immutable Historical Record • Evaluated by JobFinder Career OS ATS Engine
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeFile = meta.reportName.replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `${safeFile}_ATS_Report.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
