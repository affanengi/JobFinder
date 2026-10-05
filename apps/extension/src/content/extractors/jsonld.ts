import { ExtractedJobData } from '../../types';
import { BaseJobExtractor } from './base';

export class JsonLdJobExtractor extends BaseJobExtractor {
  readonly platform = 'generic';

  matches(url: string, document: Document): boolean {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of Array.from(scripts)) {
      try {
        const text = s.textContent || '';
        if (text.includes('JobPosting')) return true;
      } catch {}
    }
    return false;
  }

  extract(document: Document, url: string): ExtractedJobData {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    let jobPosting: any = null;

    for (const s of Array.from(scripts)) {
      try {
        const data = JSON.parse(s.textContent || '');
        if (data['@type'] === 'JobPosting') {
          jobPosting = data;
          break;
        }
        if (Array.isArray(data['@graph'])) {
          const found = data['@graph'].find((item: any) => item['@type'] === 'JobPosting');
          if (found) {
            jobPosting = found;
            break;
          }
        }
        if (Array.isArray(data)) {
          const found = data.find((item: any) => item['@type'] === 'JobPosting');
          if (found) {
            jobPosting = found;
            break;
          }
        }
      } catch {}
    }

    if (!jobPosting) {
      return {
        title: null,
        company: null,
        location: null,
        workMode: null,
        employmentType: null,
        salaryRaw: null,
        descriptionText: null,
        descriptionHtml: null,
        sourceUrl: url,
        sourcePlatform: 'generic',
        confidenceScore: 0,
        detectedFields: [],
        missingFields: ['title', 'company', 'location', 'descriptionText', 'employmentType'],
      };
    }

    const title = this.cleanText(jobPosting.title || jobPosting.name);
    let company: string | null = null;
    if (typeof jobPosting.hiringOrganization === 'string') {
      company = this.cleanText(jobPosting.hiringOrganization);
    } else if (jobPosting.hiringOrganization?.name) {
      company = this.cleanText(jobPosting.hiringOrganization.name);
    }

    let location: string | null = null;
    const locObj = jobPosting.jobLocation;
    if (locObj?.address) {
      const addr = locObj.address;
      if (typeof addr === 'string') {
        location = this.cleanText(addr);
      } else {
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
        location = parts.length > 0 ? parts.join(', ') : null;
      }
    }

    let workMode = this.detectWorkMode(jobPosting.jobLocationType);
    if (!workMode && jobPosting.jobLocationType === 'TELECOMMUTE') {
      workMode = 'remote';
    }
    if (!workMode) {
      workMode = this.detectWorkMode(title + ' ' + (jobPosting.description || ''));
    }

    let employmentType = this.detectEmploymentType(jobPosting.employmentType);
    if (!employmentType) {
      employmentType = this.detectEmploymentType(jobPosting.description);
    }

    let salaryRaw: string | null = null;
    if (jobPosting.baseSalary) {
      const base = jobPosting.baseSalary;
      const currency = base.currency || '$';
      const val = base.value;
      if (typeof val === 'number') {
        salaryRaw = `${currency}${val.toLocaleString()}`;
      } else if (typeof val === 'object' && val) {
        const min = val.minValue ?? val.value;
        const max = val.maxValue;
        const unit = val.unitText ? ` / ${val.unitText.toLowerCase()}` : '';
        if (min && max) {
          salaryRaw = `${currency}${Number(min).toLocaleString()} - ${currency}${Number(max).toLocaleString()}${unit}`;
        } else if (min) {
          salaryRaw = `${currency}${Number(min).toLocaleString()}${unit}`;
        }
      }
    }
    if (!salaryRaw) {
      salaryRaw = this.parseSalary(jobPosting.description);
    }

    let descriptionHtml = this.sanitizeHtml(jobPosting.description);
    let descriptionText = descriptionHtml
      ? this.cleanText(new DOMParser().parseFromString(descriptionHtml, 'text/html').body.textContent)
      : null;

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
      sourcePlatform: 'generic',
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
