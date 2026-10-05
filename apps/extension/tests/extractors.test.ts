import { verifyDetailPaneIdentity, resolveTargetJobId, waitForJobDetailReady, isHeaderSkeleton, evaluateMinimumSafeCriteria } from '../src/content/content-script';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { extractJobFromDocument } from '../src/content/extractors';
import { LinkedInJobExtractor } from '../src/content/extractors/linkedin';
import { IndeedJobExtractor } from '../src/content/extractors/indeed';
import { GreenhouseJobExtractor } from '../src/content/extractors/greenhouse';
import { LeverJobExtractor } from '../src/content/extractors/lever';
import { AshbyJobExtractor } from '../src/content/extractors/ashby';
import { WorkdayJobExtractor } from '../src/content/extractors/workday';
import { JsonLdJobExtractor } from '../src/content/extractors/jsonld';
import { cleanLocation, htmlToStructuredMarkdown } from '../src/content/extractors/base';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function loadFixture(filename: string): Document {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
  const dom = new JSDOM(html);
  return dom.window.document;
}

describe('Deterministic Multi-Tier Job Extractors', () => {
  it('extracts LinkedIn split-pane search results page with full fidelity', () => {
    const doc = loadFixture('linkedin_search_split_pane.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414';
    const extractor = new LinkedInJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.sourcePlatform).toBe('linkedin');
    expect(data.sourceJobId).toBe('4461976414');
    expect(data.title).toBe('NGO Engagement Intern (Remote)');
    expect(data.company).toBe('Give');
    expect(data.company).not.toBe('LinkedIn');
    expect(data.location).toBe('India');
    expect(data.location).not.toContain('1 week ago');
    expect(data.location).not.toContain('applicants');
    expect(data.workMode).toBe('remote');
    expect(data.employmentType).toBe('internship');
    expect(data.salaryRaw).toBe('5,000 INR/month');
    expect(data.descriptionText).toContain('## About the job');
    expect(data.descriptionText).toContain('### About the Company');
    expect(data.descriptionText).toContain('### About the Role');
    expect(data.descriptionText).toContain('### Responsibilities');
    expect(data.descriptionText).toContain('- NGO Outreach & Engagement: Reach out to NGO partners');
    expect(data.descriptionText).not.toContain('Inderpreet Singh');
    expect(data.descriptionText).not.toContain('Direct message the job poster');
    expect(data.descriptionText?.length).toBeGreaterThan(500);
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(data.detectedFields).toContain('title');
    expect(data.detectedFields).toContain('company');
    expect(data.detectedFields).toContain('location');
    expect(data.detectedFields).toContain('workMode');
    expect(data.detectedFields).toContain('employmentType');
    expect(data.detectedFields).toContain('salaryRaw');
    expect(data.detectedFields).toContain('descriptionText');
    expect(data.fieldQuality?.description.status).toBe('detected');
    expect(data.fieldQuality?.salary.status).toBe('detected');
  });

  it('extracts standalone LinkedIn posting with high fidelity (regression test)', () => {
    const doc = loadFixture('linkedin_job_view.html');
    const url = 'https://www.linkedin.com/jobs/view/4159821034';
    const extractor = new LinkedInJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.sourcePlatform).toBe('linkedin');
    expect(data.title).toBe('Senior AI Engineer');
    expect(data.company).toBe('Scale AI');
    expect(data.location).toBe('San Francisco, CA');
    expect(data.workMode).toBe('hybrid');
    expect(data.salaryRaw).toContain('180,000');
    expect(data.descriptionText).toContain('RLHF systems');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(data.detectedFields).toContain('title');
    expect(data.detectedFields).toContain('company');
  });

  it('gracefully reports missing fields when LinkedIn company is absent', () => {
    const doc = loadFixture('linkedin_missing_company.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=11111';
    const extractor = new LinkedInJobExtractor();

    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Senior Python Architect');
    expect(data.company).toBeNull();
    expect(data.missingFields).toContain('company');
    expect(data.confidenceScore).toBeLessThan(0.70);
  });

  it('gracefully handles missing location and unknown work mode without guessing', () => {
    const doc = loadFixture('linkedin_missing_location.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=22222';
    const extractor = new LinkedInJobExtractor();

    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Systems Engineer');
    expect(data.company).toBe('Nexus Labs');
    expect(data.location).toBeNull();
    expect(data.workMode).toBeNull();
    expect(data.missingFields).toContain('location');
    expect(data.missingFields).toContain('workMode');
    // Invariant: Must NOT guess workMode as remote
    expect(data.workMode).not.toBe('remote');
  });

  it('gracefully reports missing fields on LinkedIn non-job feed pages without forced fallback', () => {
    const doc = loadFixture('linkedin_feed_noise.html');
    const url = 'https://www.linkedin.com/feed/';

    const data = extractJobFromDocument(doc, url);

    expect(data.sourcePlatform).toBe('linkedin');
    expect(data.title).toBeNull();
    expect(data.company).toBeNull();
    expect(data.company).not.toBe('LinkedIn');
    expect(data.confidenceScore).toBeLessThan(0.20);
    expect(data.missingFields).toContain('title');
    expect(data.missingFields).toContain('company');
  });

  it('handles expired LinkedIn job postings safely without crashing', () => {
    const doc = loadFixture('linkedin_expired_job.html');
    const url = 'https://www.linkedin.com/jobs/view/33333';
    const extractor = new LinkedInJobExtractor();

    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Frontend Lead');
    expect(data.company).toBe('Acme Corp');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.60);
  });

  it('cleans compound location telemetry and isolates parenthetical work mode', () => {
    const res1 = cleanLocation('Hyderabad, Telangana, India · 2 weeks ago · Over 100 people clicked apply');
    expect(res1.location).toBe('Hyderabad, Telangana, India');
    expect(res1.detectedWorkMode).toBeNull();

    const res2 = cleanLocation('Bengaluru, Karnataka, India (Hybrid) · Reposted 3 days ago · 45 applicants');
    expect(res2.location).toBe('Bengaluru, Karnataka, India');
    expect(res2.detectedWorkMode).toBe('hybrid');

    const res3 = cleanLocation('San Francisco, CA (On-site)');
    expect(res3.location).toBe('San Francisco, CA');
    expect(res3.detectedWorkMode).toBe('onsite');

    const res4 = cleanLocation('2 weeks ago · 50 applicants');
    expect(res4.location).toBeNull();
  });

  it('converts DOM tree to clean structured Markdown without duplicate text or noise', () => {
    const doc = loadFixture('markdown_nested_noise.html');
    const detailsEl = doc.querySelector('#job-details');
    const markdown = htmlToStructuredMarkdown(detailsEl);

    expect(markdown).toBeDefined();
    // Invariant: "Software Engineer" appears exactly once (no duplication from nested layout divs)
    const occurrences = (markdown?.match(/Software Engineer/g) || []).length;
    expect(occurrences).toBe(1);

    // Headings preserved
    expect(markdown).toContain('## Role Overview');

    // Bullets preserved cleanly
    expect(markdown).toContain('- Distributed stream processing with Apache Flink');
    expect(markdown).toContain('- High-throughput telemetry with Kafka');

    // Pseudo-bullet converted
    expect(markdown).toContain('- Building next-generation data pipelines');

    // Numbered list preserved
    expect(markdown).toContain('1. Submit resume and portfolio');
    expect(markdown).toContain('2. Technical phone interview');

    // Links preserved
    expect(markdown).toContain('[our careers page](https://example.com/careers)');

    // Noise elements stripped
    expect(markdown).not.toContain('Show more');
    expect(markdown).not.toContain('Report this job');
    expect(markdown).not.toContain('Dismiss notification');

    // No runs of 3+ newlines
    expect(markdown).not.toMatch(/\n{3,}/);
  });

  it('extracts Indeed posting with remote work mode', () => {
    const doc = loadFixture('indeed_viewjob.html');
    const url = 'https://www.indeed.com/viewjob?jk=abc12345';
    const extractor = new IndeedJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Full Stack Developer');
    expect(data.company).toBe('Stripe');
    expect(data.location).toBe('Remote in US');
    expect(data.workMode).toBe('remote');
    expect(data.employmentType).toBe('full_time');
    expect(data.salaryRaw).toContain('160,000');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts Greenhouse posting accurately', () => {
    const doc = loadFixture('greenhouse_live.html');
    const url = 'https://boards.greenhouse.io/anthropic/jobs/5579204004';
    const extractor = new GreenhouseJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Research Engineer (Evaluations)');
    expect(data.company).toBe('Anthropic');
    expect(data.location).toContain('San Francisco');
    expect(data.workMode).toBe('hybrid');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts Lever posting with commitment and workplace categories', () => {
    const doc = loadFixture('lever_live.html');
    const url = 'https://jobs.lever.co/openai/1234-5678';
    const extractor = new LeverJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Applied AI Engineer');
    expect(data.company).toBe('OpenAI');
    expect(data.location).toBe('San Francisco, California');
    expect(data.workMode).toBe('onsite');
    expect(data.employmentType).toBe('full_time');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts Ashby posting with logo/title parsing', () => {
    const doc = loadFixture('ashby_live.html');
    const url = 'https://jobs.ashbyhq.com/mistralai/abcd';
    const extractor = new AshbyJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Senior Machine Learning Engineer');
    expect(data.company).toBe('Mistral AI');
    expect(data.location).toContain('Paris');
    expect(data.workMode).toBe('hybrid');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts Workday posting via automation IDs and og tags', () => {
    const doc = loadFixture('workday_live.html');
    const url = 'https://google.myworkdayjobs.com/en-US/Careers/job/Cloud-AI';
    const extractor = new WorkdayJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Software Engineer III, Cloud AI');
    expect(data.company).toBe('Google');
    expect(data.location).toContain('Sunnyvale');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts Schema.org JSON-LD structured data perfectly', () => {
    const doc = loadFixture('generic_jsonld.html');
    const url = 'https://careers.cloudflare.com/jobs/123';
    const extractor = new JsonLdJobExtractor();

    expect(extractor.matches(url, doc)).toBe(true);
    const data = extractor.extract(doc, url);

    expect(data.title).toBe('Principal Platform Engineer');
    expect(data.company).toBe('Cloudflare');
    expect(data.location).toBe('Austin, TX, US');
    expect(data.workMode).toBe('remote');
    expect(data.employmentType).toBe('full_time');
    expect(data.salaryRaw).toContain('$190,000 - $260,000');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('handles malformed noise page safely without throwing and flags missing fields', () => {
    const doc = loadFixture('malformed_noise.html');
    const url = 'https://example.com/blog/random-post';

    const data = extractJobFromDocument(doc, url);

    expect(data).toBeDefined();
    expect(data.confidenceScore).toBeLessThan(0.4);
    expect(data.missingFields).toContain('company');
    expect(data.missingFields).toContain('salaryRaw');
  });

  it('extracts LinkedIn posting where #job-details is an H2 heading without dropping body content', () => {
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="scaffold-layout__main">
          <div class="scaffold-layout__detail">
            <div class="job-details-jobs-unified-top-card">
              <h1 class="job-details-jobs-unified-top-card__job-title">AI / Generative AI Intern</h1>
              <a class="job-details-jobs-unified-top-card__company-name">ZSoft Technologies Pty Ltd</a>
              <div class="topcard__flavor-row">
                ZSoft Technologies Pty Ltd · Hyderabad, Telangana, India (On-site)
              </div>
              <button class="job-details-preference-pill">✓ On-site</button>
              <button class="job-details-preference-pill">✓ Internship</button>
            </div>
            <div class="jobs-description">
              <div class="jobs-description-content__text">
                <h2 id="job-details" class="jobs-details__heading">About the job</h2>
                <div class="jobs-box__html-content">
                  <p>AI / Generative AI Intern - Anywhere in India</p>
                  <p>ZSoft is looking for a hands on AI / Generative AI Intern.</p>
                  <h3>What You will Work On</h3>
                  <p>• Build Generative AI and LLM applications.</p>
                  <p>• Develop RAG-based solutions and AI agents.</p>
                  <p>• Build and integrate APIs and databases.</p>
                  <h3>Skills We are Looking For</h3>
                  <p>Must Have:</p>
                  <p>• Python</p>
                  <p>• Generative AI / LLM fundamentals</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);

    const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4457895182";
    const extractor = new LinkedInJobExtractor();
    expect(extractor.matches(url, dom.window.document)).toBe(true);

    const data = extractor.extract(dom.window.document, url);
    expect(data.title).toBe("AI / Generative AI Intern");
    expect(data.company).toBe("ZSoft Technologies Pty Ltd");
    expect(data.location).toBe("Hyderabad, Telangana, India");
    expect(data.workMode).toBe("onsite");
    expect(data.employmentType).toBe("internship");
    expect(data.descriptionText).toContain("## About the job");
    expect(data.descriptionText).toContain("ZSoft is looking for a hands on AI");
    expect(data.descriptionText).toContain("### What You will Work On");
    expect(data.descriptionText).toContain("- Build Generative AI and LLM applications.");
    expect(data.descriptionText).toContain("- Develop RAG-based solutions and AI agents.");
    expect(data.descriptionText).toContain("- Python");
    expect(data.descriptionText!.length).toBeGreaterThan(200);
  });

  it('cleanLocation skips company name in compound header and detects parenthetical work mode', () => {
    const res = cleanLocation("ZSoft Technologies Pty Ltd · Hyderabad, Telangana, India (On-site)", "ZSoft Technologies Pty Ltd");
    expect(res.location).toBe("Hyderabad, Telangana, India");
    expect(res.detectedWorkMode).toBe("onsite");
  });

  it('adheres to Truth Over Completion invariant: does not invent missing fields', () => {
    const doc = loadFixture('ashby_live.html');
    const url = 'https://jobs.ashbyhq.com/mistralai/abcd';
    const data = extractJobFromDocument(doc, url);

    expect(data.employmentType).toBeNull();
    expect(data.missingFields).toContain('employmentType');
  });
});

describe('Regression and Hardening Tests', () => {
  it('RT-06 & RT-07: handles absent compensation truthfully without fabricating numbers', () => {
    const doc = loadFixture('linkedin_no_compensation.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414';
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(doc, url);

    expect(data.salaryRaw).toBeNull();
    expect(data.missingFields).toContain('salaryRaw');
    expect(data.fieldQuality?.salary.status).toBe('missing');
  });

  it('RT-06b: extracts compensation from description body when topcard pill is absent', () => {
    const doc = loadFixture('linkedin_desc_compensation.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414';
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(doc, url);

    expect(data.salaryRaw).toBe('₹5,000 per month');
    expect(data.fieldQuality?.salary.status).toBe('detected');
    expect(data.fieldQuality?.salary.source).toBe('description-body');
  });

  it('RT-11: accepts short legitimate JD without arbitrary >100 length rejection', () => {
    const doc = loadFixture('linkedin_short_description.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414';
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(doc, url);

    expect(data.descriptionText).toContain('We are hiring a Senior React Engineer in Austin.');
    expect(data.fieldQuality?.description.status).toBe('detected');
  });

  it('RT-08: isolates active detail pane and prevents inactive rail card salary from bleeding', () => {
    const doc = loadFixture('linkedin_rail_isolation.html');
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414';
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(doc, url);

    // Rail has $180,000 - $220,000/yr for Job 9999999999; active job has 5,000 INR/month
    expect(data.salaryRaw).toBe('5,000 INR/month');
    expect(data.salaryRaw).not.toContain('180,000');
    expect(data.title).toBe('NGO Engagement Intern (Remote)');
    expect(data.company).toBe('Give');
  });

  it('RT-09: extracts identical full description from collapsed Show More state without UI button text', () => {
    const docCollapsed = loadFixture('linkedin_show_more_collapsed.html');
    const docExpanded = loadFixture('linkedin_show_more_expanded.html');
    const extractor = new LinkedInJobExtractor();

    const dataCollapsed = extractor.extract(docCollapsed, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    const dataExpanded = extractor.extract(docExpanded, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');

    expect(dataCollapsed.descriptionText).not.toContain('Show more');
    expect(dataCollapsed.descriptionText).not.toContain('Show less');
    expect(dataExpanded.descriptionText).not.toContain('Show more');
    expect(dataExpanded.descriptionText).not.toContain('Show less');
    expect(dataCollapsed.descriptionText).toBe(dataExpanded.descriptionText);
  });

  it('RT-02: marks heading-only candidate as partial and never detected', () => {
    const dom = new JSDOM(`
      <html><body>
        <div class="scaffold-layout__detail">
          <h1>Product Designer</h1>
          <a class="job-details-jobs-unified-top-card__company-name">DesignStudio</a>
          <div class="jobs-details__heading-container">
            <h2 id="job-details">About the job</h2>
          </div>
        </div>
      </body></html>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/view/123456');

    expect(data.fieldQuality?.description.status).toBe('partial');
    expect(data.fieldQuality?.description.reason).toContain('Truncated heading');
  });

  it('RT-12: verifyDetailPaneIdentity correctly validates target job and ignores footer similar jobs', () => {
    // Case 1: Plain H1 title with unrelated footer links
    const dom1 = new JSDOM(`
      <div class="scaffold-layout__detail">
        <div class="job-details-jobs-unified-top-card">
          <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
          <div class="topcard__flavor">India</div>
        </div>
        <div class="jobs-box__html-content">Real job description here</div>
        <div class="similar-jobs">
          <a href="/jobs/view/9999999999/">Unrelated Similar Job</a>
        </div>
      </div>
    `);
    const p1 = dom1.window.document.querySelector('.scaffold-layout__detail')!;
    expect(verifyDetailPaneIdentity(p1, '4461976414', dom1.window.document)).toBe(true);

    // Case 2: Direct title link matching targetJobId
    const dom2 = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="job-details-jobs-unified-top-card__job-title">
          <a href="/jobs/view/4461976414/">NGO Engagement Intern (Remote)</a>
        </h1>
        <div class="similar-jobs"><a href="/jobs/view/9999999999/">Other</a></div>
      </div>
    `);
    const p2 = dom2.window.document.querySelector('.scaffold-layout__detail')!;
    expect(verifyDetailPaneIdentity(p2, '4461976414', dom2.window.document)).toBe(true);

    // Case 3: Stale title link matching previous job
    const dom3 = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="job-details-jobs-unified-top-card__job-title">
          <a href="/jobs/view/1111111111/">Old Stale Job Title</a>
        </h1>
      </div>
    `);
    const p3 = dom3.window.document.querySelector('.scaffold-layout__detail')!;
    expect(verifyDetailPaneIdentity(p3, '4461976414', dom3.window.document)).toBe(false);

    // Case 4: Active rail card matches pane title even without link
    const dom4 = new JSDOM(`
      <div class="jobs-search-results-list">
        <div class="jobs-search-results-list__list-item--active" data-job-id="4461976414">
          <div class="job-card-list__title">NGO Engagement Intern (Remote)</div>
        </div>
      </div>
      <div class="scaffold-layout__detail">
        <h2 class="t-24">NGO Engagement Intern (Remote)</h2>
      </div>
    `);
    const p4 = dom4.window.document.querySelector('.scaffold-layout__detail')!;
    expect(verifyDetailPaneIdentity(p4, '4461976414', dom4.window.document)).toBe(true);
  });

  it('RT-13: auxiliary skeleton in recruiter widget does NOT block readiness observation', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <div class="job-details-jobs-unified-top-card">
          <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
          <div class="topcard__flavor">Give</div>
        </div>
        <div class="jobs-box__html-content">Real job description here</div>
        <!-- Auxiliary widget with skeleton loader -->
        <div class="hiring-team-widget" data-view-name="hiring-team">
          <div class="artdeco-skeleton skeleton-loader" aria-busy="true">Loading recruiter...</div>
        </div>
      </div>
    `);
    const p = dom.window.document.querySelector('.scaffold-layout__detail')!;
    expect(isHeaderSkeleton(p)).toBe(false);
  });

  it('RT-14: actual job-header skeleton DOES block/hold readiness', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <div class="job-details-jobs-unified-top-card">
          <div class="artdeco-skeleton skeleton-loader" aria-busy="true">Loading topcard...</div>
        </div>
        <div class="jobs-box__html-content">Real job description here</div>
      </div>
    `);
    const p = dom.window.document.querySelector('.scaffold-layout__detail')!;
    expect(isHeaderSkeleton(p)).toBe(true);
  });

  it('RT-15: evaluateMinimumSafeCriteria requires verified identity and non-empty title or company', () => {
    // Has title and verified identity
    const dom1 = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
      </div>
    `);
    const p1 = dom1.window.document.querySelector('.scaffold-layout__detail')!;
    expect(evaluateMinimumSafeCriteria(p1, '4461976414', dom1.window.document)).toBe(true);

    // Stale identity fails minimum safe criteria
    const dom2 = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="job-details-jobs-unified-top-card__job-title">
          <a href="/jobs/view/1111111111/">Old Stale Job Title</a>
        </h1>
      </div>
    `);
    const p2 = dom2.window.document.querySelector('.scaffold-layout__detail')!;
    expect(evaluateMinimumSafeCriteria(p2, '4461976414', dom2.window.document)).toBe(false);

    // Completely empty pane fails
    const dom3 = new JSDOM(`<div class="scaffold-layout__detail"></div>`);
    const p3 = dom3.window.document.querySelector('.scaffold-layout__detail')!;
    expect(evaluateMinimumSafeCriteria(p3, '4461976414', dom3.window.document)).toBe(false);
  });

  it('RT-16: waitForJobDetailReady detects fast-path on visible title and company', async () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <div class="job-details-jobs-unified-top-card">
          <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
          <div class="topcard__flavor">Give</div>
        </div>
        <div class="jobs-box__html-content">Real job description here</div>
      </div>
    `);
    const res = await waitForJobDetailReady(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414', 500);
    expect(res.isReady).toBe(true);
    expect(res.isDegraded).toBe(false);
  });

  it('RT-17: extracts compensation from preference pill without :has-text selector', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
        <div class="topcard__flavor">Give</div>
        <ul class="job-details-jobs-unified-top-card__job-insight-list">
          <li><button class="job-details-preference-pill">5,000 INR/month</button></li>
          <li><button class="job-details-preference-pill">Remote</button></li>
          <li><button class="job-details-preference-pill">Internship</button></li>
        </ul>
        <div class="jobs-box__html-content">Job description here</div>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    expect(data.salaryRaw).toBe('5,000 INR/month');
    expect(data.fieldQuality?.salary.status).toBe('detected');
  });

  it('RT-18: unrelated numbers in pills or telemetry are not mistaken for salary', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
        <div class="topcard__flavor">Give</div>
        <div class="job-details-jobs-unified-top-card__job-insight">Over 100 applicants</div>
        <div class="job-details-jobs-unified-top-card__job-insight">1 week ago</div>
        <div class="jobs-box__html-content">Job description without numbers</div>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    expect(data.salaryRaw).toBeNull();
    expect(data.fieldQuality?.salary.status).toBe('missing');
  });

  it('RT-19: timeout with insufficient evidence fails safely', async () => {
    // Empty document with no job content
    const dom = new JSDOM(`<html><body><div class="empty-page">No jobs here</div></body></html>`);
    const res = await waitForJobDetailReady(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=9999999999', 150);
    expect(res.isReady).toBe(false);
    expect(res.reason).toBe('TIMEOUT_INSUFFICIENT');
  });

  it('RT-20: timeout with minimum safe criteria allows controlled extraction with degraded quality', async () => {
    // Pane with title anchor only (no company, so fast-path does not trigger)
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
      </div>
    `);
    const res = await waitForJobDetailReady(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414', 150);
    expect(res.isReady).toBe(true);
    expect(res.isDegraded).toBe(true);
    expect(res.reason).toBe('TIMEOUT_DEGRADED');
  });

  it('RT-21: navigation abort check aborts if URL job ID mutates during readiness', async () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
      </div>
    `);
    // initialUrl is Job A, but window.location will simulate mutation
    const initialUrl = 'https://www.linkedin.com/jobs/search-results/?currentJobId=1111111111';
    dom.reconfigure({ url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=2222222222' });
    const res = await waitForJobDetailReady(dom.window.document, initialUrl, 200);
    expect(res.isReady).toBe(false);
    expect(res.reason).toBe('NAV_ABORT');
  });

  it('RT-22: article fallback remains strictly scoped to verified active detail pane', () => {
    // Document contains an unrelated article in the search rail / footer
    const dom = new JSDOM(`
      <div class="scaffold-layout__list">
        <article class="unrelated-rail-article">Unrelated job description from another company</article>
      </div>
      <div class="scaffold-layout__detail">
        <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
        <div class="topcard__flavor">Give</div>
        <div class="jobs-box__html-content">Real scoped job description for Give</div>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    expect(data.descriptionText).toContain('Real scoped job description for Give');
    expect(data.descriptionText).not.toContain('Unrelated job description from another company');
  });

  it('RT-23: short legitimate description is accepted and classified as uncertain when under 30 chars, not dropped', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">Delivery Driver</h1>
        <div class="topcard__flavor">Local Courier</div>
        <div class="jobs-box__html-content">Driver needed today.</div>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    expect(data.descriptionText).toBe('Driver needed today.');
    expect(data.fieldQuality?.description.status).toBe('uncertain');
    expect(data.fieldQuality?.description.reason).toContain('Short description');
  });

  it('RT-24: sourceJobId strictly matches targetJobId from verified extraction context', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">Full Stack Engineer</h1>
        <div class="topcard__flavor">Acme Corp</div>
        <div class="jobs-box__html-content">We are looking for an experienced developer. Responsibilities include building scalable APIs.</div>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4461976414');
    expect(data.sourceJobId).toBe('4461976414');
    expect(data.sourcePlatform).toBe('linkedin');
  });

  it('RT-25: verifyDetailPaneIdentity rejects extraction when pane title and rail card title mismatch', () => {
    const dom = new JSDOM(`
      <div class="jobs-search-results-list">
        <li data-occludable-job-id="1111111111" class="jobs-search-results-list__list-item--active">
          <a class="job-card-list__title">Backend Engineer</a>
        </li>
      </div>
      <div class="scaffold-layout__detail">
        <h1 class="t-24">Frontend Architect</h1>
      </div>
    `);
    // Pane shows Frontend Architect, but active rail card for Job A is Backend Engineer -> identity mismatch
    const isIdentityMatch = verifyDetailPaneIdentity(
      dom.window.document.querySelector('.scaffold-layout__detail')!,
      '1111111111',
      dom.window.document
    );
    expect(isIdentityMatch).toBe(false);
  });

  it('RT-26: candidate scoring chooses structured rich body candidate over outer article and heading', () => {
    const dom = new JSDOM(`
      <div class="scaffold-layout__detail">
        <h1 class="t-24">DevOps Specialist</h1>
        <div class="topcard__flavor">CloudTech</div>
        <article class="jobs-description__container">
          <div class="auxiliary-sidebar">Recruiter info and related suggestions</div>
          <h2 id="job-details">About the job</h2>
          <div class="show-more-less-html__markup">
            <p>We are seeking a DevOps Specialist to manage our Kubernetes infrastructure.</p>
            <p>Responsibilities include maintaining CI/CD pipelines and improving monitoring.</p>
            <p>Requirements: 4+ years of AWS and Terraform experience.</p>
          </div>
        </article>
      </div>
    `);
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/view/9876543210');
    expect(data.descriptionText).toContain('DevOps Specialist to manage our Kubernetes infrastructure');
    expect(data.descriptionText).toContain('CI/CD pipelines');
    expect(data.descriptionText).not.toContain('Recruiter info and related suggestions');
    expect(data.fieldQuality?.description.status).toBe('detected');
  });
  it('RT-27: standalone view page with recommended sidebar jobs extracts successfully without sidebar interference', async () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <header class="global-nav">
            <h1 class="visually-hidden">LinkedIn</h1>
          </header>
          <main class="core-rail">
            <div class="jobs-unified-top-card">
              <h1 class="t-24">NGO Engagement Intern (Remote)</h1>
              <a class="topcard__flavor--black-link" href="/company/give-india/">Give</a>
              <span class="topcard__flavor">India (Remote)</span>
              <div class="job-details-preference-pill">5,000 INR/month</div>
            </div>
            <div id="job-details">
              <h2>About the job</h2>
              <div class="show-more-less-html__markup">
                <p>Real description for NGO Engagement Intern at Give.</p>
              </div>
            </div>
          </main>
          <aside class="scaffold-layout__aside">
            <div class="similar-jobs">
              <li class="scaffold-layout__list-item active">
                <a class="job-card-list__title">Unrelated Data Analyst</a>
              </li>
            </div>
          </aside>
        </body>
      </html>
    `, { url: 'https://www.linkedin.com/jobs/view/4461976414/' });

    // 1. verifyDetailPaneIdentity must NOT be tricked by the sidebar's unrelated job
    const detailPane = dom.window.document.querySelector('main.core-rail')!;
    const isIdentityMatch = verifyDetailPaneIdentity(detailPane, '4461976414', dom.window.document);
    expect(isIdentityMatch).toBe(true);

    // 2. waitForJobDetailReady must succeed
    const readiness = await waitForJobDetailReady(dom.window.document, 'https://www.linkedin.com/jobs/view/4461976414/', 200);
    expect(readiness.isReady).toBe(true);

    // 3. Extractor extracts the real job correctly
    const extractor = new LinkedInJobExtractor();
    const data = extractor.extract(dom.window.document, 'https://www.linkedin.com/jobs/view/4461976414/');
    expect(data.title).toBe('NGO Engagement Intern (Remote)');
    expect(data.company).toBe('Give');
    expect(data.salaryRaw).toBe('5,000 INR/month');
    expect(data.descriptionText).toContain('Real description for NGO Engagement Intern at Give');
    expect(data.descriptionText).not.toContain('Unrelated Data Analyst');
  });

  it("RT-28: accurately extracts job with AI upsell banner and rich About the Job section without misidentifying title or missing JD", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>NGO Engagement Intern (Remote) - Give | LinkedIn</title>
        </head>
        <body>
          <div class="jobs-details__main-content">
            <div class="top-card-layout">
              <h1 class="top-card-layout__title">NGO Engagement Intern (Remote)</h1>
              <a class="topcard__org-name-link" href="/company/give/">Give</a>
              <div class="top-card-layout__second-subline">Give · India (Remote)</div>
            </div>
            <div class="premium-upsell">
              <h2>Use AI to assess how you fit</h2>
              <button>Show match details</button>
            </div>
          </div>
          <div class="core-section-container">
            <h2>About the job</h2>
            <div class="jobs-box__html-content">
              <p>About the Company</p>
              <p>Give Grants enables large Indian corporations and foundations to deliver maximum social impact.</p>
              <p>About the Role</p>
              <p>We are looking for proactive and driven interns to support the Google for AI program in India.</p>
            </div>
          </div>
        </body>
      </html>
    `, { url: "https://www.linkedin.com/jobs/view/4461976414/" });

    const extractor = new LinkedInJobExtractor();
    const result = extractor.extract(dom.window.document, "https://www.linkedin.com/jobs/view/4461976414/");

    expect(result.title).toBe("NGO Engagement Intern (Remote)");
    expect(result.company).toBe("Give");
    expect(result.location).toBe("India");
    expect(result.workMode).toBe("remote");
    expect(result.employmentType).toBe("internship");
    expect(result.descriptionText).toBeTruthy();
    expect(result.descriptionText).toContain("Give Grants enables large Indian corporations");
    expect(result.detectedFields).toContain("title");
    expect(result.detectedFields).toContain("company");
    expect(result.detectedFields).toContain("descriptionText");
  });

  it("RT-29: split-screen job search with feedback prompt ('Are these results helpful?') extracts correct title and location without contamination", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Intern — Junior Carbon & GHG Modeler | Varaha | LinkedIn</title>
        </head>
        <body>
          <div class="scaffold-layout__main">
            <!-- Left Rail with search list and feedback prompt -->
            <div class="scaffold-layout__list">
              <h2>Jobs based on your preferences</h2>
              <div class="search-feedback">
                <h2>Are these results helpful?</h2>
                <button>Yes</button>
                <button>No</button>
              </div>
              <div class="jobs-search-results-list">
                <div class="jobs-search-results-list__list-item--active" data-job-id="4448196584">
                  <div class="job-card-container job-card-container--active">
                    <a class="job-card-container__link" href="/jobs/view/4448196584/">
                      <strong>Intern — Junior Carbon & GHG Modeler</strong>
                    </a>
                    <div class="job-card-container__primary-description">Varaha</div>
                    <div class="job-card-container__metadata-item">India (Remote)</div>
                    <div class="job-card-container__metadata-item">Viewed · 1 month ago</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Detail Pane -->
            <div class="scaffold-layout__detail jobs-search__job-details--container" data-job-id="4448196584">
              <div class="job-details-jobs-unified-top-card">
                <a class="job-details-jobs-unified-top-card__company-name" href="/company/varaha/">Varaha</a>
                <h1 class="job-details-jobs-unified-top-card__job-title t-24">
                  <a href="/jobs/view/4448196584/">Intern — Junior Carbon & GHG Modeler</a>
                </h1>
                <div class="job-details-jobs-unified-top-card__primary-description-container">
                  <div class="job-details-jobs-unified-top-card__primary-description">
                    India · 1 month ago · Over 100 people clicked apply
                  </div>
                </div>
                <div class="job-details-jobs-unified-top-card__tertiary-description">
                  Responses managed off LinkedIn
                </div>
                <ul>
                  <li><button class="job-details-preference-pill">Remote</button></li>
                  <li><button class="job-details-preference-pill">Internship</button></li>
                </ul>
                <button class="jobs-apply-button">Apply</button>
                <button class="jobs-save-button">Save</button>
              </div>

              <div class="qualification-feedback">
                <p>Your profile and resume are missing some qualifications</p>
                <p>BETA • Is this information helpful?</p>
              </div>

              <div class="jobs-description">
                <h2>About the job</h2>
                <div class="show-more-less-html__markup">
                  <p><strong>What You Will Do & Learn</strong></p>
                  <p>- Model Soil Carbon & GHGs: Learn to set up, calibrate, and validate process-based models.</p>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `, { url: "https://www.linkedin.com/jobs/search-results/?currentJobId=4448196584" });

    const extractor = new LinkedInJobExtractor();
    const result = extractor.extract(dom.window.document, "https://www.linkedin.com/jobs/search-results/?currentJobId=4448196584");

    expect(result.title).toBe("Intern — Junior Carbon & GHG Modeler");
    expect(result.title).not.toContain("helpful");
    expect(result.title).not.toContain("Are these results");
    expect(result.company).toBe("Varaha");
    expect(result.location).toBe("India");
    expect(result.workMode).toBe("remote");
    expect(result.employmentType).toBe("internship");
    expect(result.descriptionText).toContain("What You Will Do & Learn");
    expect(result.descriptionText).toContain("Model Soil Carbon & GHGs");
    expect(result.descriptionText).not.toContain("Are these results helpful");
    expect(result.descriptionText).not.toContain("Responses managed off LinkedIn");
    expect(result.detectedFields).toContain("title");
    expect(result.detectedFields).toContain("location");
  });

  it("RT-30: standalone view page (/jobs/view/...) isolates job description from outer article and does not include top-card metadata", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Intern — Junior Carbon & GHG Modeler | Varaha | LinkedIn</title>
        </head>
        <body>
          <article class="job-view-layout">
            <div class="job-details-jobs-unified-top-card">
              <a href="https://www.linkedin.com/company/varaha-carbontech/life/">Varaha</a>
              <h1 class="t-24">Intern — Junior Carbon & GHG Modeler</h1>
              <div class="job-details-jobs-unified-top-card__primary-description-container">
                <span class="tvm__text">India</span>
                <span class="tvm__text"> · 1 month ago · Over 100 people clicked apply</span>
              </div>
              <div class="job-details-jobs-unified-top-card__tertiary-description">
                Responses managed off LinkedIn
              </div>
              <div class="pills">
                <span class="job-details-preference-pill">Remote</span>
                <span class="job-details-preference-pill">Internship</span>
              </div>
              <button class="jobs-apply-button">Apply</button>
              <button class="jobs-save-button">Save</button>
            </div>

            <div class="premium-upsell">
              <h2>Use AI to assess how you fit</h2>
              <p>Get AI-powered advice on this job and more exclusive features with Premium.</p>
              <button>Show match details</button>
            </div>

            <div class="recruiter-section">
              <h2>People you can reach out to</h2>
              <p>Meet the hiring team</p>
              <p>Varchaswa Mohan</p>
            </div>

            <section class="core-section-container description">
              <div class="jobs-description">
                <h2>About the job</h2>
                <div class="jobs-box__html-content">
                  <p><strong>What You Will Do & Learn</strong></p>
                  <p>- Model Soil Carbon & GHGs: Learn to set up, calibrate, and validate process-based models.</p>
                </div>
              </div>
            </section>
          </article>
        </body>
      </html>
    `, { url: "https://www.linkedin.com/jobs/view/4448196584/" });

    const extractor = new LinkedInJobExtractor();
    const result = extractor.extract(dom.window.document, "https://www.linkedin.com/jobs/view/4448196584/");

    expect(result.title).toBe("Intern — Junior Carbon & GHG Modeler");
    expect(result.company).toBe("Varaha");
    expect(result.location).toBe("India");
    expect(result.workMode).toBe("remote");
    expect(result.employmentType).toBe("internship");

    // Job description must NOT include the top card, URL, title, telemetry, or recruiter widget
    expect(result.descriptionText).not.toContain("varaha-carbontech/life");
    expect(result.descriptionText).not.toContain("Responses managed off LinkedIn");
    expect(result.descriptionText).not.toContain("Over 100 people clicked apply");
    expect(result.descriptionText).not.toContain("Use AI to assess how you fit");
    expect(result.descriptionText).not.toContain("People you can reach out to");
    expect(result.descriptionText).toContain("What You Will Do & Learn");
    expect(result.descriptionText).toContain("Model Soil Carbon & GHGs");
  });

  it("RT-31: split-screen view with search filter bar and preference header does not pollute location or workMode", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Intern — Junior Carbon & GHG Modeler | Varaha | LinkedIn</title>
        </head>
        <body>
          <main class="scaffold-layout__main">
            <!-- Global search filter bar at top of main -->
            <div class="search-reusables__filter-list">
              <button>Date posted</button>
              <button>Easy Apply</button>
              <button>In my network</button>
              <button>Under 10 applicants</button>
            </div>

            <!-- Left Rail with search list and preference text -->
            <div class="scaffold-layout__list">
              <header class="jobs-search-results-list__header">
                <h2>Jobs based on your preferences</h2>
                <div class="job-preferences-summary">Project Intern, on-site or hybrid or remote in Hyderabad</div>
                <div>95 results · How promoted jobs are ranked</div>
              </header>
              <ul class="jobs-search-results__list">
                <li class="jobs-search-results__list-item" data-occludable-job-id="4448196584">
                  <div class="job-card-container">
                    <a class="job-card-container__link" href="/jobs/view/4448196584/?currentJobId=4448196584">
                      Intern — Junior Carbon & GHG Modeler
                    </a>
                    <div class="job-card-container__primary-description">Varaha</div>
                    <div class="job-card-container__metadata-item">India (Remote)</div>
                    <div class="job-card-container__metadata-item">Viewed · 1 month ago</div>
                  </div>
                </li>
              </ul>
            </div>

            <!-- Right Detail Pane -->
            <div class="scaffold-layout__detail" data-view-name="job-details">
              <div data-view-name="job-details-top-card">
                <div>
                  <a href="/company/varaha/">Varaha</a>
                </div>
                <h1>Intern — Junior Carbon & GHG Modeler</h1>
                <div>
                  <span>India</span>
                  <span> · 1 month ago · 0 people clicked apply</span>
                </div>
                <div>Responses managed off LinkedIn</div>
                <div class="pills">
                  <button class="job-details-preference-pill">Remote</button>
                  <button class="job-details-preference-pill">Internship</button>
                </div>
                <button>Apply</button>
                <button>Save</button>
              </div>

              <div id="job-details">
                <h2>About the job</h2>
                <div class="show-more-less-html__markup">
                  <p>- Familiarity with Bayesian statistics, machine learning surrogates, or remote sensing data.</p>
                  <p>- Interest in agricultural systems across India, Southeast Asia, or Sub-Saharan Africa.</p>
                </div>
              </div>
            </div>
          </main>
        </body>
      </html>
    `, { url: "https://www.linkedin.com/jobs/search-results/?currentJobId=4448196584&ebP=NOT_ELIGIBLE_FOR_CHARGING" });

    const extractor = new LinkedInJobExtractor();
    const result = extractor.extract(dom.window.document, "https://www.linkedin.com/jobs/search-results/?currentJobId=4448196584&ebP=NOT_ELIGIBLE_FOR_CHARGING");

    expect(result.title).toBe("Intern — Junior Carbon & GHG Modeler");
    expect(result.company).toBe("Varaha");
    expect(result.location).toBe("India");
    expect(result.location).not.toContain("Date posted");
    expect(result.location).not.toContain("Easy Apply");
    expect(result.workMode).toBe("remote");
    expect(result.workMode).not.toBe("onsite");
    expect(result.employmentType).toBe("internship");
    expect(result.descriptionText).toContain("Familiarity with Bayesian statistics");
  });

  it("RT-32: standalone view where Remote pill has job link and top card contains company + title does not misdetect title or location", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Intern — Junior Carbon & GHG Modeler | Varaha | LinkedIn</title>
        </head>
        <body>
          <main>
            <div data-view-name="job-details-top-card">
              <a href="/company/varaha/">Varaha</a>
              <h1>Intern — Junior Carbon & GHG Modeler</h1>
              <div class="t-14 t-normal">
                <span>India</span>
                <span> · 1 month ago · Over 100 people clicked apply</span>
              </div>
              <div>Responses managed off LinkedIn</div>
              <div class="pill-group">
                <a href="/jobs/view/4448196584/?ref=pill" class="artdeco-pill">Remote</a>
                <a href="/jobs/view/4448196584/?ref=pill" class="artdeco-pill">Internship</a>
              </div>
            </div>

            <div id="job-details">
              <h2>About the job</h2>
              <div class="show-more-less-html__markup">
                <p><strong>What You Will Do & Learn</strong></p>
                <p>- Model Soil Carbon & GHGs: Learn to set up, calibrate, and validate process-based models.</p>
              </div>
            </div>
          </main>
        </body>
      </html>
    `, { url: "https://www.linkedin.com/jobs/view/4448196584/?alternateChannel=search" });

    const extractor = new LinkedInJobExtractor();
    const result = extractor.extract(dom.window.document, "https://www.linkedin.com/jobs/view/4448196584/?alternateChannel=search");

    expect(result.title).toBe("Intern — Junior Carbon & GHG Modeler");
    expect(result.title).not.toBe("Remote");
    expect(result.company).toBe("Varaha");
    expect(result.location).toBe("India");
    expect(result.location).not.toContain("Varaha");
    expect(result.location).not.toContain("Intern");
    expect(result.workMode).toBe("remote");
    expect(result.employmentType).toBe("internship");
  });

});
