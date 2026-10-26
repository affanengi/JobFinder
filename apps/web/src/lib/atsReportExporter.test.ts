import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHtml,
  buildStructuredA4Pages,
  downloadAtsReportHtml,
  ReportMeta,
} from './atsReportExporter';
import { AtsScanResult } from '../types/scanner';

describe('atsReportExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any remaining sandboxes
    const sandbox = document.getElementById('ats-render-measure-sandbox');
    if (sandbox) sandbox.remove();
  });

  describe('escapeHtml', () => {
    it('escapes special HTML characters safely', () => {
      expect(escapeHtml('<script>alert("xss & \'hack\'")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss &amp; &#039;hack&#039;&quot;)&lt;/script&gt;'
      );
    });

    it('handles null and undefined gracefully', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('handles numbers and booleans gracefully', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(true)).toBe('true');
    });
  });

  describe('buildStructuredA4Pages', () => {
    const meta: ReportMeta = {
      reportName: 'Software Engineer Scan',
      sourceType: 'tailored_resume',
      overallScore: 88,
      grade: 'A',
      createdAt: '2026-10-22T12:00:00Z',
    };

    const legacyReport: AtsScanResult = {
      overall_score: 82,
      grade: 'A',
      summary: 'Solid candidate resume with strong technical background.',
      category_scores: {
        skills: {
          name: 'Technical Skills',
          score: 25,
          max_score: 30,
          percentage: 83,
          status: 'pass',
          summary: 'Good skill alignment',
          checks: [],
        },
      },
      keyword_matrix: {
        matched: [{ id: 'k1', name: 'Python', category: 'Backend', importance: 'High', status: 'matched' }],
        missing: [{ id: 'k2', name: 'GraphQL', category: 'API', importance: 'Medium', status: 'missing' }],
        transferable: [],
        match_percentage: 50,
        total_jd_keywords: 2,
        matched_count: 1,
        missing_count: 1,
        transferable_count: 0,
      },
      bullet_audits: [
        {
          id: 'b1',
          section: 'Experience',
          role_or_project: 'Senior Developer',
          text: 'Architected distributed event-driven pipeline handling 50k req/sec.',
          score: 90,
          status: 'strong',
          has_action_verb: true,
          has_metric: true,
          has_weak_opener: false,
          verb: 'Architected',
          word_count: 9,
          issues: [],
        },
      ],
      actionable_checklist: [
        {
          id: 'c1',
          priority: 'high',
          category: 'Keywords',
          title: 'Include GraphQL',
          description: 'GraphQL is a targeted JD requirement.',
          passed: false,
          impact_points: 6,
        },
      ],
      metadata: {
        source_type: 'tailored_resume',
        page_count: 1,
        word_count: 420,
        estimated_read_time: '2 min',
        taxonomy_version: '2026.1',
      },
      // Note: readiness, requirement_matches, rubric_breakdown, analysis_mode are all undefined (legacy)
    };

    const contextualReport: AtsScanResult = {
      ...legacyReport,
      overall_score: 91,
      grade: 'A+',
      analysis_mode: 'contextual_ai',
      confidence_level: 'high',
      readiness: {
        core_alignment_tier: 'high',
        substance_tier: 'substantive',
        parseability_tier: 'optimal',
        mandatory_coverage_pct: 100,
        summary_verdict: 'Interview Ready: Strong candidate match across all core requirements.',
      },
      requirement_matches: [
        {
          id: 'req-1',
          name: 'Distributed Systems & Microservices',
          category: 'Architecture',
          is_mandatory: true,
          evidence_status: 'demonstrated',
          explanation: 'Supported by 50k req/sec high-throughput event pipeline experience.',
          linked_evidence: [
            {
              bullet_id: 'b1',
              quote: 'Architected distributed event-driven pipeline handling 50k req/sec.',
              role_or_project: 'Senior Developer',
            },
          ],
        },
        {
          id: 'req-2',
          name: 'Kubernetes Orchestration',
          category: 'DevOps',
          is_mandatory: false,
          evidence_status: 'listed',
          explanation: 'Mentioned in skills section but lacks quantified impact bullet.',
          linked_evidence: [],
        },
      ],
      bullet_audits: [
        {
          ...legacyReport.bullet_audits[0],
          rubric_breakdown: {
            action_scope_score: 24,
            technical_substance_score: 23,
            outcome_credibility_score: 22,
            job_relevance_score: 25,
            rubric_notes: ['Strong active verb', 'Clear metric'],
          },
          suggested_focus: 'Clarify failover and latency guarantees',
        },
      ],
    };

    it('renders legacy reports without crashing or fabricating rubric scores', () => {
      const pages = buildStructuredA4Pages(legacyReport, meta);
      expect(pages.length).toBeGreaterThanOrEqual(1);

      const firstPage = pages[0];
      expect(firstPage.innerHTML).toContain('Score: 82/100');
      expect(firstPage.innerHTML).toContain('Legacy Deterministic Report Format');
      // Must NOT contain 4-dimension rubric breakdown because it was not in legacy report
      expect(firstPage.innerHTML).not.toContain('4-Dimension Rubric Evaluation');
      // Must NOT contain requirement match map
      expect(firstPage.innerHTML).not.toContain('Job Description Requirement Match Map');
    });

    it('renders contextual reports with readiness, rubric breakdown, and requirement map', () => {
      const pages = buildStructuredA4Pages(contextualReport, meta);
      expect(pages.length).toBeGreaterThanOrEqual(1);

      const html = pages.map((p) => p.innerHTML).join('');
      expect(html).toContain('Interview Ready: Strong candidate match');
      expect(html).toContain('Mandatory Coverage: 100%');
      expect(html).toContain('contextual_ai');
      expect(html).toContain('Confidence: high');
      expect(html).toContain('Job Description Requirement Match Map');
      expect(html).toContain('Distributed Systems &amp; Microservices');
      expect(html).toContain('4-Dimension Rubric Evaluation');
      expect(html).toContain('24/25'); // action_scope_score
    });

    it('paginates large bullet lists into multiple A4 pages with correct footers', () => {
      const manyBullets = Array.from({ length: 18 }, (_, i) => ({
        id: `bullet-${i}`,
        section: 'Experience',
        role_or_project: `Project ${i + 1}`,
        text: `Accomplished significant technical milestone #${i + 1} with deep distributed architecture systems and extensive benchmarking.`,
        score: 85,
        status: 'strong' as const,
        has_action_verb: true,
        has_metric: true,
        has_weak_opener: false,
        word_count: 14,
        issues: [],
      }));

      const heavyReport: AtsScanResult = {
        ...legacyReport,
        bullet_audits: manyBullets,
      };

      const pages = buildStructuredA4Pages(heavyReport, meta);
      expect(pages.length).toBeGreaterThan(1);

      // Verify page numbering in footers
      const totalPages = pages.length;
      pages.forEach((p, idx) => {
        expect(p.innerHTML).toContain(`Page ${idx + 1} of ${totalPages}`);
      });
    });
  });

  describe('downloadAtsReportHtml', () => {
    it('creates download blob and triggers click without errors', () => {
      const meta: ReportMeta = {
        reportName: 'Frontend Engineer Scan',
        overallScore: 90,
        grade: 'A',
      };

      const report: AtsScanResult = {
        overall_score: 90,
        grade: 'A',
        summary: 'Excellent frontend candidate with React and TypeScript depth.',
        category_scores: {},
        keyword_matrix: {
          matched: [],
          missing: [],
          transferable: [],
          match_percentage: 100,
          total_jd_keywords: 0,
          matched_count: 0,
          missing_count: 0,
          transferable_count: 0,
        },
        bullet_audits: [],
        actionable_checklist: [],
        metadata: {
          source_type: 'tailored_resume',
          page_count: 1,
          word_count: 350,
          estimated_read_time: '2 min',
          taxonomy_version: '2026.1',
        },
      };

      // Mock URL.createObjectURL and URL.revokeObjectURL
      const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/dummy');
      const revokeObjectURLMock = vi.fn();
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      downloadAtsReportHtml(report, meta);

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);

      clickSpy.mockRestore();
    });
  });
});
