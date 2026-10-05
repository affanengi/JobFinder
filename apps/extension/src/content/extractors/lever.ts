import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';
import { JsonLdJobExtractor } from './jsonld';

export class LeverJobExtractor extends BaseJobExtractor {
  readonly platform = 'lever';

  matches(url: string, document: Document): boolean {
    return (
      url.includes('jobs.lever.co') ||
      !!document.querySelector('.posting-headline') ||
      !!document.querySelector('.main-header-logo')
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      const jsonResult = jsonLdExtractor.extract(document, url);
      if (jsonResult.title && jsonResult.company) {
        return {
          ...jsonResult,
          sourcePlatform: 'lever',
        };
      }
    }

    const titleEl =
      document.querySelector('.posting-headline h2') ||
      document.querySelector('h2') ||
      document.querySelector('h1');

    const companyLogo = document.querySelector('.main-header-logo img') as HTMLImageElement | null;
    let company: string | null = null;
    if (companyLogo?.alt) {
      company = this.cleanText(companyLogo.alt.replace(/ logo$/i, ''));
    }
    if (!company) {
      const titleTag = document.querySelector('title')?.textContent;
      if (titleTag) {
        const parts = titleTag.split(/ - | \| /);
        company = parts.length > 1 ? this.cleanText(parts[0]) : null;
      }
    }

    const locationEl =
      document.querySelector('.posting-categories .location') ||
      document.querySelector('.posting-categories .sort-by-time') ||
      document.querySelector('.posting-category:first-child');

    const workplaceEl = document.querySelector('.posting-categories .workplaceTypes');
    const commitmentEl = document.querySelector('.posting-categories .commitment');

    const descEl =
      document.querySelector('[data-qa="job-description"]') ||
      document.querySelector('.section-wrapper') ||
      document.querySelector('.content');

    const title = this.cleanText(titleEl?.textContent);
    const location = this.cleanText(locationEl?.textContent);
    const workplaceText = this.cleanText(workplaceEl?.textContent);
    const commitmentText = this.cleanText(commitmentEl?.textContent);
    const descriptionText = this.cleanText(descEl?.textContent);
    const descriptionHtml = this.sanitizeHtml(descEl?.innerHTML);
    const salaryRaw = this.parseSalary(descriptionText);

    let workMode = this.detectWorkMode(workplaceText);
    if (!workMode) {
      workMode = this.detectWorkMode((location || '') + ' ' + (title || '') + ' ' + (descriptionText || ''));
    }

    const employmentType = this.detectEmploymentType(
      (commitmentText || '') + ' ' + (descriptionText || '')
    );

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
      sourcePlatform: 'lever',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
