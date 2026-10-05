import { ExtractedJobData } from "../../types";
import { BaseJobExtractor } from "./base";
import { LinkedInJobExtractor } from "./linkedin";
import { IndeedJobExtractor } from "./indeed";
import { GreenhouseJobExtractor } from "./greenhouse";
import { LeverJobExtractor } from "./lever";
import { AshbyJobExtractor } from "./ashby";
import { WorkdayJobExtractor } from "./workday";
import { JsonLdJobExtractor } from "./jsonld";
import { GenericSemanticJobExtractor } from "./generic";

const SPECIALIZED_EXTRACTORS: BaseJobExtractor[] = [
  new LinkedInJobExtractor(),
  new IndeedJobExtractor(),
  new GreenhouseJobExtractor(),
  new LeverJobExtractor(),
  new AshbyJobExtractor(),
  new WorkdayJobExtractor(),
];

export function extractJobFromDocument(document: Document, url: string): ExtractedJobData {
  // 1. Platform Isolation & Stickiness:
  // If URL matches a known specialized job board, strictly execute that platform extractor.
  // Never cascade to Generic scraper to avoid platform name bleeding or hallucinated fields.
  for (const extractor of SPECIALIZED_EXTRACTORS) {
    if (extractor.matches(url, document)) {
      try {
        return extractor.extract(document, url);
      } catch (err) {
        console.warn(`Extractor ${extractor.platform} encountered error:`, err);
        // Return structured failure under platform identity
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
          sourcePlatform: extractor.platform,
          confidenceScore: 0.0,
          detectedFields: [],
          missingFields: ["title", "company", "descriptionText", "location"],
        };
      }
    }
  }

  // 2. Try JSON-LD explicit structured extractor for generic websites
  try {
    const jsonLd = new JsonLdJobExtractor();
    if (jsonLd.matches(url, document)) {
      const data = jsonLd.extract(document, url);
      if (data.title && (data.company || data.descriptionText)) {
        return data;
      }
    }
  } catch {}

  // 3. Fallback to Generic Semantic Extractor for arbitrary career sites
  const generic = new GenericSemanticJobExtractor();
  return generic.extract(document, url);
}

export {
  BaseJobExtractor,
  LinkedInJobExtractor,
  IndeedJobExtractor,
  GreenhouseJobExtractor,
  LeverJobExtractor,
  AshbyJobExtractor,
  WorkdayJobExtractor,
  JsonLdJobExtractor,
  GenericSemanticJobExtractor,
};
