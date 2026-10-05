import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';
import { JsonLdJobExtractor } from './jsonld';

export class WorkdayJobExtractor extends BaseJobExtractor {
  readonly platform = 'workday';

  matches(url: string, document: Document): boolean {
    return (
      url.includes('myworkdayjobs.com') ||
      !!document.querySelector('[data-automation-id="jobPostingHeader"]') ||
      !!document.querySelector('[data-automation-id="jobPostingDescription"]')
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      const jsonResult = jsonLdExtractor.extract(document, url);
      if (jsonResult.title && jsonResult.company) {
        return {
          ...jsonResult,
          sourcePlatform: 'workday',
        };
      }
    }

    const titleEl =
      document.querySelector('[data-automation-id="jobPostingHeader"]') ||
      document.querySelector('h2[data-automation-id="jobPostingHeader"]') ||
      document.querySelector('h1');

    let company: string | null = null;
    const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (ogSite) {
      company = this.cleanText(ogSite);
    }
    if (!company) {
      const titleTag = document.querySelector('title')?.textContent;
      if (titleTag) {
        const parts = titleTag.split(/ - | \| /);
        company = parts.length > 1 ? this.cleanText(parts[parts.length - 1]) : null;
      }
    }

    const locationEl =
      document.querySelector('[data-automation-id="locations"]') ||
      document.querySelector('[data-automation-id="location"]') ||
      document.querySelector('[data-automation-id="jobPostingSubHeader"]');

    const descEl =
      document.querySelector('[data-automation-id="jobPostingDescription"]') ||
      document.querySelector('#job-description');

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
      sourcePlatform: 'workday',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
