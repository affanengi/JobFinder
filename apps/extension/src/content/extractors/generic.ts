import { ExtractedJobData } from "../../types";
import { BaseJobExtractor, cleanLocation, htmlToStructuredMarkdown, isBannedCompany } from "./base";
import { JsonLdJobExtractor } from "./jsonld";

export class GenericSemanticJobExtractor extends BaseJobExtractor {
  readonly platform = "generic";

  matches(_url: string, _document: Document): boolean {
    return true;
  }

  extract(document: Document, url: string): ExtractedJobData {
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      try {
        const jsonResult = jsonLdExtractor.extract(document, url);
        if (jsonResult.title && (jsonResult.company || jsonResult.descriptionText)) {
          if (!isBannedCompany(jsonResult.company)) {
            return jsonResult;
          }
        }
      } catch {}
    }

    const ogTitle = document.querySelector("meta[property=\"og:title\"]")?.getAttribute("content");
    const ogDesc = document.querySelector("meta[property=\"og:description\"]")?.getAttribute("content");
    const ogSite = document.querySelector("meta[property=\"og:site_name\"]")?.getAttribute("content");
    const metaDesc = document.querySelector("meta[name=\"description\"]")?.getAttribute("content");

    const h1El =
      document.querySelector("main h1") ||
      document.querySelector("article h1") ||
      document.querySelector("[role=\"main\"] h1") ||
      document.querySelector("h1");

    const mainEl =
      document.querySelector(".job-description, .job__description, #job-description, [data-automation-id=\"jobPostingDescription\"], [class*=\"job-details\"], [class*=\"jobDescription\"], [class*=\"job_description\"]") ||
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector("[role=\"main\"]") ||
      document.querySelector(".content");

    let title = this.cleanText(h1El?.textContent) || this.cleanText(ogTitle);
    if (title && title.includes(" - ")) {
      const parts = title.split(" - ");
      if (parts.length === 2 && parts[0].length < 60) {
        title = parts[0].trim();
      }
    }

    let company = this.cleanText(ogSite);
    if (isBannedCompany(company)) {
      company = null;
    }

    if (!company) {
      const titleTag = document.querySelector("title")?.textContent;
      if (titleTag) {
        const parts = titleTag.split(/ at | - | \| /i);
        if (parts.length > 1) {
          const candidate = this.cleanText(parts[parts.length - 1]);
          if (
            candidate &&
            !/404|not found|error|page|blog|careers|jobs/i.test(candidate) &&
            !isBannedCompany(candidate)
          ) {
            company = candidate;
          }
        }
      }
    }

    const descriptionText =
      htmlToStructuredMarkdown(mainEl) || this.cleanText(ogDesc) || this.cleanText(metaDesc);
    const descriptionHtml = this.sanitizeHtml(mainEl?.innerHTML);

    let location: string | null = null;
    const locMeta =
      document.querySelector("meta[name=\"job:location\"]") ||
      document.querySelector("[class*=\"location\"]");
    if (locMeta) {
      const rawLoc = this.cleanText(locMeta.getAttribute("content") || locMeta.textContent);
      location = cleanLocation(rawLoc).location;
    }

    const salaryRaw = this.parseSalary(descriptionText);
    const workMode = this.detectWorkMode((location || "") + " " + (title || "") + " " + (descriptionText || ""));
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
      sourcePlatform: "generic",
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
    };
  }
}
