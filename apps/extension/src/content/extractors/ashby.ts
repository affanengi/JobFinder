import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';
import { JsonLdJobExtractor } from './jsonld';

export class AshbyJobExtractor extends BaseJobExtractor {
  readonly platform = 'ashby';

  matches(url: string, document: Document): boolean {
    return (
      url.includes('jobs.ashbyhq.com') ||
      !!document.querySelector('meta[content*="ashby"]') ||
      !!document.querySelector('[class*="ashby"]')
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      const jsonResult = jsonLdExtractor.extract(document, url);
      if (jsonResult.title && jsonResult.company) {
        return {
          ...jsonResult,
          sourcePlatform: 'ashby',
        };
      }
    }

    const titleEl =
      document.querySelector('h1') ||
      document.querySelector('[class*="title"]') ||
      document.querySelector('h2');

    let company: string | null = null;
    const logoEl = document.querySelector('header img, nav img') as HTMLImageElement | null;
    if (logoEl?.alt) {
      company = this.cleanText(logoEl.alt.replace(/ logo$/i, ''));
    }
    if (!company) {
      const titleTag = document.querySelector('title')?.textContent;
      if (titleTag) {
        const parts = titleTag.split(/ at | - | \| /);
        company = parts.length > 1 ? this.cleanText(parts[1]) : this.cleanText(parts[0]);
      }
    }

    const locationEl =
      document.querySelector('[class*="location"]') ||
      document.querySelector('[class*="metadata"] span') ||
      document.querySelector('div[data-testid="job-location"]');

    const descEl =
      document.querySelector('[class*="description"]') ||
      document.querySelector('main') ||
      document.querySelector('article');

    const title = this.cleanText(titleEl?.textContent);
    const location = this.cleanText(locationEl?.textContent);
    const descriptionText = this.cleanText(descEl?.textContent);
    const descriptionHtml = this.sanitizeHtml(descEl?.innerHTML);
    const salaryRaw = this.parseSalary(descriptionText);

    let workMode = this.detectWorkMode((location || '') + ' ' + (title || ''));
    if (!workMode) {
      workMode = this.detectWorkMode(descriptionText);
    }

    const employmentType = this.detectEmploymentType(descriptionText);

    const { score, detected, missing } = this.calculateConfidence({
      title,
      company,
      location,
      descriptionText,
      salaryRaw,
      workMode,
      employmentType,
    });

    return {
      title,
      company,
      location,
      workMode,
      employmentType,
      salaryRaw,
      descriptionText,
      descriptionHtml,
      sourceUrl: url,
      sourcePlatform: 'ashby',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
