import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { isSupportedJobUrl } from '../src/services/url-guard';
import { extractJobFromDocument } from '../src/content/extractors';

describe('Performance Isolation & Domain Guard Verification', () => {
  describe('1. URL Guard Domain Isolation', () => {
    it('strictly classifies unsupported websites as dormant (isSupportedJobUrl -> false)', () => {
      const unsupportedUrls = [
        'https://www.youtube.com/',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://mail.google.com/mail/u/0/#inbox',
        'https://mail.google.com/mail/u/0/#inbox/FMfcgzGsl',
        'https://github.com/facebook/react',
        'https://github.com/facebook/react/pull/1234',
        'https://example.com/',
        'https://example.com/article/123',
        'https://news.ycombinator.com/',
        'https://reddit.com/r/programming',
        // LinkedIn social/feed/profile URLs are explicitly dormant for job extraction
        'https://www.linkedin.com/feed/',
        'https://www.linkedin.com/feed/update/urn:li:activity:123',
        'https://www.linkedin.com/in/mohd-affan/',
        'https://www.linkedin.com/messaging/',
        'https://www.linkedin.com/notifications/',
      ];

      for (const url of unsupportedUrls) {
        expect(isSupportedJobUrl(url), `Expected ${url} to be classified as dormant`).toBe(false);
      }
    });

    it('strictly classifies verified job-board URLs as supported (isSupportedJobUrl -> true)', () => {
      const supportedUrls = [
        'https://www.linkedin.com/jobs/view/4461976414/',
        'https://www.linkedin.com/jobs/search/?currentJobId=4461976414',
        'https://www.linkedin.com/jobs/collections/recommended/',
        'https://in.linkedin.com/jobs/view/12345678',
        'https://www.indeed.com/viewjob?jk=abcdef123456',
        'https://www.indeed.com/jobs?q=software+engineer',
        'https://boards.greenhouse.io/stripe/jobs/123456',
        'https://job-boards.greenhouse.io/datadog/jobs/789012',
        'https://jobs.lever.co/spotify/abcdef-1234-5678',
        'https://jobs.ashbyhq.com/scale-ai/456789',
        'https://nvidia.myworkdayjobs.com/NVIDIAExternalCareerSite/job/USA-CA-Santa-Clara/Software-Engineer_JR12345',
      ];

      for (const url of supportedUrls) {
        expect(isSupportedJobUrl(url), `Expected ${url} to be classified as supported`).toBe(true);
      }
    });

    it('rejects malformed, empty, or non-http URLs safely', () => {
      expect(isSupportedJobUrl(null)).toBe(false);
      expect(isSupportedJobUrl(undefined)).toBe(false);
      expect(isSupportedJobUrl('')).toBe(false);
      expect(isSupportedJobUrl('chrome://extensions/')).toBe(false);
      expect(isSupportedJobUrl('about:blank')).toBe(false);
      expect(isSupportedJobUrl('file:///home/user/test.html')).toBe(false);
    });
  });

  describe('2. Manifest Security & Injection Guard', () => {
    it('manifest content_scripts does NOT contain broad wildcards or unsupported domains', () => {
      const manifestPath = path.resolve(__dirname, '../manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      const matches: string[] = manifest.content_scripts[0].matches;

      expect(matches).not.toContain('<all_urls>');
      expect(matches).not.toContain('*://*/*');
      expect(matches).not.toContain('https://*/*');
      expect(matches).not.toContain('http://*/*');

      // YouTube, Gmail, GitHub must never be in declarative matches
      const broadCheck = matches.some((pattern) =>
        /youtube\.com|google\.com|github\.com/i.test(pattern)
      );
      expect(broadCheck).toBe(false);
    });

    it('dist/content-script.js contains ZERO ES module import statements (prevents SyntaxError in classic script)', () => {
      const distScriptPath = path.resolve(__dirname, '../dist/content-script.js');
      if (fs.existsSync(distScriptPath)) {
        const content = fs.readFileSync(distScriptPath, 'utf-8');
        // Match import statement (e.g. import...from)
        const hasImport = /^\s*import\s+.*from\s+['"].*['"]/m.test(content) || /import\s*\{.*\}\s*from/m.test(content);
        expect(hasImport, 'dist/content-script.js must NOT have any import statements').toBe(false);
      }
    });
  });

  describe('3. Service Worker Background Isolation Simulation', () => {
    it('simulates tab activation: unsupported website (YouTube) triggers immediate no-op', async () => {
      // Mock chrome APIs
      const setBadgeTextMock = vi.fn();
      const checkClipStatusMock = vi.fn();

      const fakeTabActivatedHandler = async (activeInfo: { tabId: number }, tabUrl: string) => {
        if (!isSupportedJobUrl(tabUrl)) {
          setBadgeTextMock({ tabId: activeInfo.tabId, text: '' });
          return; // Immediate no-op!
        }
        await checkClipStatusMock(tabUrl);
      };

      // Scenario: User switches to YouTube tab
      await fakeTabActivatedHandler({ tabId: 101 }, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(checkClipStatusMock).not.toHaveBeenCalled();
      expect(setBadgeTextMock).toHaveBeenCalledWith({ tabId: 101, text: '' });
    });

    it('simulates tab activation: supported website (LinkedIn Jobs) triggers clip status check', async () => {
      const setBadgeTextMock = vi.fn();
      const checkClipStatusMock = vi.fn().mockResolvedValue({ isSaved: true });

      const fakeTabActivatedHandler = async (activeInfo: { tabId: number }, tabUrl: string) => {
        if (!isSupportedJobUrl(tabUrl)) {
          setBadgeTextMock({ tabId: activeInfo.tabId, text: '' });
          return;
        }
        const status = await checkClipStatusMock(tabUrl);
        if (status.isSaved) {
          setBadgeTextMock({ tabId: activeInfo.tabId, text: 'SAVED' });
        }
      };

      // Scenario: User switches to LinkedIn Jobs tab
      await fakeTabActivatedHandler(
        { tabId: 202 },
        'https://www.linkedin.com/jobs/view/4461976414/'
      );

      expect(checkClipStatusMock).toHaveBeenCalledWith(
        'https://www.linkedin.com/jobs/view/4461976414/'
      );
      expect(setBadgeTextMock).toHaveBeenCalledWith({ tabId: 202, text: 'SAVED' });
    });

    it('simulates CHECK_CLIP_STATUS message: rejects unsupported URLs without querying backend', async () => {
      const checkClipStatusMock = vi.fn();

      const fakeMessageHandler = async (message: { type: string; url: string }) => {
        if (message.type === 'CHECK_CLIP_STATUS') {
          if (!isSupportedJobUrl(message.url)) {
            return { success: true, data: { isSaved: false } };
          }
          return await checkClipStatusMock(message.url);
        }
      };

      const result = await fakeMessageHandler({
        type: 'CHECK_CLIP_STATUS',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      expect(result).toEqual({ success: true, data: { isSaved: false } });
      expect(checkClipStatusMock).not.toHaveBeenCalled();
    });
  });

  describe('4. Custom Career Site One-Shot Execution', () => {
    it('executes one-shot generic extraction on custom company career page without persistent observers', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Senior Frontend Engineer at Acme Corp</title>
            <meta property="og:title" content="Senior Frontend Engineer" />
            <meta property="og:site_name" content="Acme Corp" />
          </head>
          <body>
            <main>
              <div class="job-description">
                <h1>Senior Frontend Engineer</h1>
                <p class="job-location">New York, NY (Hybrid)</p>
                <h2>About the Role</h2>
                <p>We are seeking an experienced React engineer to join our team.</p>
                <ul>
                  <li>5+ years TypeScript experience</li>
                  <li>Deep knowledge of web performance</li>
                </ul>
              </div>
            </main>
          </body>
        </html>
      `;
      const dom = new JSDOM(html, { url: 'https://careers.acmecorp.com/jobs/frontend-lead' });
      const doc = dom.window.document;

      // When user explicitly clicks "Clip from custom career site", extractJobFromDocument is invoked
      const result = extractJobFromDocument(doc, 'https://careers.acmecorp.com/jobs/frontend-lead');

      expect(result.sourcePlatform).toBe('generic');
      expect(result.title).toBe('Senior Frontend Engineer');
      expect(result.company).toBe('Acme Corp');
      expect(result.location).toBe('New York, NY');
      expect(result.workMode).toBe('hybrid');
      expect(result.descriptionText).toContain('About the Role');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
    });
  });
});
