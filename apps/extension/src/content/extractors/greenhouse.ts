import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';
import { JsonLdJobExtractor } from './jsonld';

export class GreenhouseJobExtractor extends BaseJobExtractor {
  readonly platform = 'greenhouse';

  matches(url: string, document: Document): boolean {
    return (
      url.includes('greenhouse.io') ||
      !!document.querySelector('#grnhse_app') ||
      !!document.querySelector('#application_form') ||
      !!document.querySelector('.app-title')
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      const jsonResult = jsonLdExtractor.extract(document, url);
      if (jsonResult.title && jsonResult.company) {
        return {
          ...jsonResult,
          sourcePlatform: 'greenhouse',
        };
      }
    }

    const titleEl =
      document.querySelector('.app-title') ||
      document.querySelector('h1.job-title') ||
      document.querySelector('h1');

    const companyEl =
      document.querySelector('.company-name') ||
      document.querySelector('span.company-name') ||
      document.querySelector('title');

    let company = this.cleanText(companyEl?.textContent);
    if (company && companyEl?.tagName.toLowerCase() === 'title') {
      const parts = company.split(/ at | - | \| /i);
      company = parts.length > 1 ? this.cleanText(parts[parts.length - 1]) : null;
    }

    const locationEl =
      document.querySelector('.location') ||
      document.querySelector('.body--metadata') ||
      document.querySelector('[class*="location"]');

    const descEl =
      document.querySelector('#content') ||
      document.querySelector('#app-body') ||
      document.querySelector('.job-description');

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
      sourcePlatform: 'greenhouse',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
