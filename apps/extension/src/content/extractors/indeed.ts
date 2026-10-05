import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';
import { JsonLdJobExtractor } from './jsonld';

export class IndeedJobExtractor extends BaseJobExtractor {
  readonly platform = 'indeed';

  matches(url: string, document: Document): boolean {
    return (
      url.includes('indeed.com') ||
      !!document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
      !!document.querySelector('#jobDescriptionText')
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      const jsonResult = jsonLdExtractor.extract(document, url);
      if (jsonResult.title && jsonResult.company) {
        return {
          ...jsonResult,
          sourcePlatform: 'indeed',
        };
      }
    }

    const titleEl =
      document.querySelector('h1.jobsearch-JobInfoHeader-title') ||
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
      document.querySelector('h1.jobTitle');

    const companyEl =
      document.querySelector('[data-testid="inlineHeader-companyName"]') ||
      document.querySelector('.jobsearch-InlineCompanyRating-companyHeader') ||
      document.querySelector('[data-company-name="true"]') ||
      document.querySelector('.companyName');

    const locationEl =
      document.querySelector('[data-testid="job-location"]') ||
      document.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
      document.querySelector('#jobLocationText') ||
      document.querySelector('.companyLocation');

    const descEl =
      document.querySelector('#jobDescriptionText') ||
      document.querySelector('.jobsearch-jobDescriptionText');

    const salaryEl =
      document.querySelector('#salaryInfoAndJobType') ||
      document.querySelector('[data-testid="attribute_snippets_section"]') ||
      document.querySelector('.jobsearch-JobMetadataHeader-item');

    const title = this.cleanText(titleEl?.textContent);
    const company = this.cleanText(companyEl?.textContent);
    const location = this.cleanText(locationEl?.textContent);
    const descriptionText = this.cleanText(descEl?.textContent);
    const descriptionHtml = this.sanitizeHtml(descEl?.innerHTML);
    const salaryRaw =
      this.parseSalary(salaryEl?.textContent) || this.parseSalary(descriptionText);

    let workMode = this.detectWorkMode(
      (location || '') + ' ' + (title || '') + ' ' + (salaryEl?.textContent || '')
    );
    if (!workMode) {
      workMode = this.detectWorkMode(descriptionText);
    }

    const employmentType = this.detectEmploymentType(
      (salaryEl?.textContent || '') + ' ' + (descriptionText || '')
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
      sourcePlatform: 'indeed',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
