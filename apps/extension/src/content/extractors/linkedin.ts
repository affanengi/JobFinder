import { EmploymentType, ExtractedJobData, FieldQualityMap, WorkMode } from "../../types";
import {
  BaseJobExtractor,
  cleanLocation,
  htmlToStructuredMarkdown,
  isBannedCompany,
  isMeaningfulDescription,
  scoreDescriptionCandidate,
} from "./base";
import { JsonLdJobExtractor } from "./jsonld";

export class LinkedInJobExtractor extends BaseJobExtractor {
  readonly platform = "linkedin";

  matches(url: string, document: Document): boolean {
    return (
      url.includes("linkedin.com") ||
      !!document.querySelector(".jobs-unified-top-card") ||
      !!document.querySelector(".job-details-jobs-unified-top-card") ||
      !!document.querySelector(".scaffold-layout__detail") ||
      !!document.querySelector(".jobs-search__job-details--container")
    );
  }

  extract(document: Document, url: string): ExtractedJobData {
    // 1. Try JSON-LD if structured data is present on page
    const jsonLdExtractor = new JsonLdJobExtractor();
    if (jsonLdExtractor.matches(url, document)) {
      try {
        const jsonResult = jsonLdExtractor.extract(document, url);
        if (jsonResult.title && jsonResult.company && !isBannedCompany(jsonResult.company)) {
          return {
            ...jsonResult,
            sourcePlatform: "linkedin",
          };
        }
      } catch {}
    }

    // 2. Resolve Active Job Identity (targetJobId)
    let targetJobId: string | null = null;
    try {
      const urlObj = new URL(url);
      const currentJobId = urlObj.searchParams.get("currentJobId");
      if (currentJobId && /^\d+$/.test(currentJobId)) {
        targetJobId = currentJobId;
      } else {
        const viewMatch = urlObj.pathname.match(/\/jobs\/view\/(\d+)/);
        if (viewMatch) targetJobId = viewMatch[1];
      }
    } catch {}

    // 3. Identify scope: Split-pane detail container vs standalone document
    const isSplitPane =
      !!document.querySelector(".scaffold-layout__detail") ||
      !!document.querySelector(".jobs-search__job-details--container") ||
      !!document.querySelector(".jobs-search__job-details") ||
      !!document.querySelector(".scaffold-layout__list, .jobs-search-results-list, ul.jobs-search-results__list");

    const jobDetailsEl = document.querySelector("#job-details");
    const detailContainer: Element | Document =
      (jobDetailsEl
        ? (jobDetailsEl.closest(
            ".scaffold-layout__detail, [class*=\"scaffold-layout__detail\"], [class*=\"job-details--container\"], [class*=\"job-details-pane\"], [class*=\"jobs-search__job-details\"], .job-view-layout, [data-view-name=\"job-details\"], article"
          ) as Element | null)
        : null) ||
      (isSplitPane
        ? (document.querySelector(".scaffold-layout__detail") as Element | null) ||
          (document.querySelector(".jobs-search__job-details--container") as Element | null) ||
          (document.querySelector(".jobs-search__job-details") as Element | null) ||
          (document.querySelector(".jobs-details__main-content") as Element | null) ||
          (document.querySelector("[data-view-name=\"job-details\"]") as Element | null) ||
          (document.querySelector("[class*=\"scaffold-layout__detail\"]") as Element | null) ||
          (document.querySelector("[class*=\"job-details--container\"]") as Element | null) ||
          (document.querySelector("[class*=\"job-details-pane\"]") as Element | null) ||
          (document.querySelector(".scaffold-layout__main > div:nth-child(2)") as Element | null) ||
          (document.querySelector(".scaffold-layout__main > *:last-child") as Element | null)
        : null) ||
      (document.querySelector(".jobs-details__main-content") as Element | null) ||
      (document.querySelector(".job-view-layout") as Element | null) ||
      (document.querySelector(".decorated-job-posting__details") as Element | null) ||
      (document.querySelector("main#main-content, main, .core-rail") as Element | null) ||
      document;

    // Scoped active list card (fallback for split-pane views)
    let activeListCard: Element | null = null;
    if (targetJobId) {
      const searchListRoot =
        document.querySelector(
          ".scaffold-layout__list, .jobs-search-results-list, .jobs-search__left-rail, ul.jobs-search-results__list"
        ) || document;
      const matchingLinkOrItem = searchListRoot.querySelector(
        `[data-job-id="${targetJobId}"], [data-occludable-job-id="${targetJobId}"], [data-job-id*="${targetJobId}"], a[href*="${targetJobId}"]`
      );
      if (matchingLinkOrItem) {
        activeListCard =
          matchingLinkOrItem.closest(
            "li, div.job-card-container, div.jobs-search-results__list-item, div.jobs-search-results-list__list-item"
          ) || matchingLinkOrItem;
      }
    }

    if (!activeListCard) {
      activeListCard =
        (document.querySelector(".jobs-search-results__list-item--active") as Element | null) ||
        (document.querySelector(".jobs-search-results-list__list-item--active") as Element | null) ||
        (document.querySelector(".scaffold-layout__list-item.active") as Element | null) ||
        (document.querySelector("[class*=\"job-card-container--active\"]") as Element | null) ||
        (document.querySelector("[class*=\"job-card-container--clickable\"][class*=\"active\"]") as Element | null) ||
        (document.querySelector(".scaffold-layout__list [data-occludable-job-id].active") as Element | null);

      if (!targetJobId && activeListCard) {
        const id =
          activeListCard.getAttribute("data-job-id") ||
          activeListCard.getAttribute("data-occludable-job-id");
        if (id && /^\d+$/.test(id)) targetJobId = id;
      }
    }

    // Isolate the primary top-card header in detailContainer
    const topCardEl: Element | Document =
      detailContainer.querySelector(".job-details-jobs-unified-top-card") ||
      detailContainer.querySelector(".jobs-unified-top-card") ||
      detailContainer.querySelector("[data-view-name=\"job-details-top-card\"]") ||
      detailContainer.querySelector(".top-card-layout") ||
      detailContainer.querySelector("[class*=\"top-card\"]") ||
      detailContainer.querySelector("[class*=\"topcard\"]") ||
      detailContainer.querySelector("h1")?.closest("div, header, section") ||
      detailContainer;

    // 4. Job Title Resolution Hierarchy
    const isInvalidTitle = (t: string | null | undefined): boolean => {
      if (!t) return true;
      const trimmed = t.trim();
      if (trimmed.length < 2) return true;
      if (trimmed.endsWith("?")) return true;
      if (/^(linkedin|jobs|search|feed|messaging|notifications)$/i.test(trimmed)) return true;
      if (
        /^(?:remote|on-site|onsite|in-office|hybrid|full[ -]?time|part[ -]?time|internship|intern|contract|temporary|freelance)$/i.test(
          trimmed
        )
      ) {
        return true;
      }
      if (/^(?:apply|easy apply|save|saved|share|follow|following)$/i.test(trimmed)) return true;
      if (/\b(?:date\s+posted|easy\s+apply|in\s+my\s+network|under\s+\d+\s+applicants?)\b/i.test(trimmed)) return true;
      if (/\b(?:use\s+ai|assess\s+how\s+you\s+fit|tailor\s+my\s+resume|help\s+me\s+stand\s+out)\b/i.test(trimmed)) return true;
      if (/\b(?:people\s+you\s+can\s+reach|meet\s+the\s+hiring\s+team|similar\s+jobs|people\s+also\s+viewed)\b/i.test(trimmed)) return true;
      if (/\b(?:about\s+the\s+job|job\s+details|about\s+the\s+company|about\s+the\s+role)\b/i.test(trimmed)) return true;
      if (/\b(?:show\s+match\s+details|how\s+you\s+match|skills\s+associated)\b/i.test(trimmed)) return true;
      if (/\b(?:sign\s+in|join\s+now|agree\s+&\s+join|log\s+in)\b/i.test(trimmed)) return true;
      if (/\b(?:are\s+these\s+results\s+helpful|is\s+this\s+(?:information|result)\s+helpful|was\s+this\s+helpful|give\s+feedback|feedback|help\s+us\s+improve)\b/i.test(trimmed)) return true;
      if (/\b(?:jobs\s+based\s+on|how\s+promoted\s+jobs|promoted\s+jobs|explore\s+jobs|search\s+results|recommended\s+jobs|jobs\s+you\s+may\s+be\s+interested\s+in|job\s+alerts?)\b/i.test(trimmed)) return true;
      if (/^(?:are|is|was|were|do|does|did|how|why|what|can|could|should|would)\b/i.test(trimmed) && trimmed.length < 60) return true;
      return false;
    };

    const titleCandidates = [
      topCardEl.querySelector("h1.job-details-jobs-unified-top-card__job-title"),
      topCardEl.querySelector("h1.jobs-unified-top-card__job-title"),
      topCardEl.querySelector(".top-card-layout__title"),
      topCardEl.querySelector("h1.topcard__title"),
      topCardEl.querySelector("[data-view-name=\"job-details-top-card\"] h1"),
      topCardEl.querySelector("[data-view-name=\"job-details-top-card\"] h2"),
      topCardEl.querySelector("h1.t-24"),
      topCardEl.querySelector("h2.t-24"),
      topCardEl.querySelector("h1[class*=\"job-title\"]"),
      topCardEl.querySelector("h2[class*=\"job-title\"]"),
      topCardEl.querySelector(".job-details-jobs-unified-top-card__job-title a"),
      topCardEl.querySelector(".jobs-unified-top-card__job-title a"),
      topCardEl.querySelector("h1:not(.visually-hidden)"),
      topCardEl.querySelector("h2:not(.visually-hidden)"),
      activeListCard?.querySelector(".job-card-list__title"),
      activeListCard?.querySelector("a.job-card-container__link"),
      activeListCard?.querySelector("a[class*=\"job-title\"], [class*=\"job-title\"]"),
      targetJobId ? topCardEl.querySelector(`h1 a[href*="/jobs/view/${targetJobId}"], h2 a[href*="/jobs/view/${targetJobId}"]`) : null,
      targetJobId ? topCardEl.querySelector(`a[href*="/jobs/view/${targetJobId}"]`) : null,
      activeListCard?.querySelector("a[href*=\"/jobs/view/\"]"),
      detailContainer.querySelector(".jobs-unified-top-card h1, .job-details-jobs-unified-top-card h1"),
      detailContainer.querySelector("h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1.t-24, h2.t-24"),
    ];

    let title: string | null = null;
    for (const candEl of titleCandidates) {
      if (!candEl) continue;
      const text = this.cleanText(candEl.textContent);
      if (text && !isInvalidTitle(text)) {
        title = text;
        break;
      }
    }

    // Document title fallback if heading was obscured or not matched
    if (!title && document.title) {
      const docTitle = document.title
        .replace(/\s*\|\s*LinkedIn.*$/i, "")
        .replace(/\s*-\s*LinkedIn.*$/i, "")
        .replace(/^\(\d+\)\s*/, "")
        .trim();
      if (/\bhiring\b/i.test(docTitle)) {
        const match = docTitle.match(/\bhiring\s+(.+?)(?:\s+in\s+.*)?$/i);
        if (match && !isInvalidTitle(match[1])) title = this.cleanText(match[1]);
      } else {
        const parts = docTitle.split(/\s+[-–|]\s+|\s+at\s+/i);
        if (parts.length > 0 && !isInvalidTitle(parts[0])) {
          title = this.cleanText(parts[0]);
        }
      }
    }

    // 5. Company Name Resolution Hierarchy (with Precedence & Blacklist)
    const companyEl =
      detailContainer.querySelector(".job-details-jobs-unified-top-card__company-name a") ||
      detailContainer.querySelector(".jobs-unified-top-card__company-name a") ||
      detailContainer.querySelector("a[href*=\"/company/\"]") ||
      detailContainer.querySelector(".job-details-jobs-unified-top-card__company-name") ||
      detailContainer.querySelector(".jobs-unified-top-card__company-name") ||
      detailContainer.querySelector("[class*=\"company-name\"]") ||
      activeListCard?.querySelector(".job-card-container__primary-description") ||
      detailContainer.querySelector(".topcard__org-name-link") ||
      detailContainer.querySelector(".topcard__flavor") ||
      document.querySelector("a[data-tracking-control-name=\"public_jobs_topcard-org-name\"]") ||
      document.querySelector("a[href*=\"/company/\"]");

    let company = this.cleanText(companyEl?.textContent);
    if (isBannedCompany(company)) {
      const fallbackCompanyEl =
        detailContainer.querySelector("a[href*=\"/company/\"]:not([href*=\"linkedin.com\"])") ||
        activeListCard?.querySelector(".job-card-container__primary-description") ||
        document.querySelector("a[href*=\"/company/\"]:not([href*=\"linkedin.com\"])");
      const fallbackCompany = this.cleanText(fallbackCompanyEl?.textContent);
      company = isBannedCompany(fallbackCompany) ? null : fallbackCompany;
    }

    if (!company && document.title) {
      const cleanedDocTitle = document.title.replace(/\s*\|\s*LinkedIn.*$/i, "").replace(/^\(\d+\)\s*/, "").trim();
      const match = cleanedDocTitle.match(/(?:[-–|]|\bat\b)\s*([^–\-|]+)$/i);
      if (match) {
        const cand = match[1].trim();
        if (
          cand &&
          !isBannedCompany(cand) &&
          cand.length < 50 &&
          !/\b(?:remote|hybrid|onsite|posted|ago|applicant|job\s+posting)\b/i.test(cand) &&
          !/^[A-Za-z\s]+,\s*[A-Za-z]{2}$/.test(cand)
        ) {
          company = cand;
        }
      }
    }

    // 6. Location Parsing via Structured Tokenizer (Scrubbing Telemetry)
    let location: string | null = null;
    let locationWorkMode: WorkMode = null;

    const testLocationCandidate = (rawText: string | null | undefined): boolean => {
      if (!rawText) return false;
      const trimmed = rawText.trim();
      if (!trimmed || trimmed.length > 250) return false;
      if (company && trimmed.toLowerCase() === company.toLowerCase()) return false;
      if (title && trimmed.toLowerCase() === title.toLowerCase()) return false;
      if (
        /^\s*(?:see who|view profile|direct message|easy apply|apply|save|share|follow|more|details|fit|match|update|profile|beta)\s*$/i.test(
          trimmed
        )
      ) {
        return false;
      }
      if (/\b(?:date\s+posted|easy\s+apply|in\s+my\s+network|under\s+\d+\s+applicants?|filter\s+by)\b/i.test(trimmed)) {
        return false;
      }

      const res = cleanLocation(trimmed, company, title);
      if (res.location) {
        location = res.location;
        if (res.detectedWorkMode) locationWorkMode = res.detectedWorkMode;
        return true;
      }
      return false;
    };

    // Candidate 1: Targeted location chips & metadata spans in topCardEl
    const locationChips = Array.from(
      topCardEl.querySelectorAll(
        ".job-details-jobs-unified-top-card__primary-description-container span, .job-details-jobs-unified-top-card__primary-description span, [class*=\"primary-description\"] span, [class*=\"tertiary-description\"] span, .tvm__text, .topcard__flavor, .topcard__flavor--bullet, [class*=\"bullet\"], .jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__bullet, [class*=\"bullet\"] ~ span, .topcard__flavor-row span, .top-card-layout__first-subline span, .top-card-layout__second-subline span, [class*=\"topcard__flavor\"]"
      )
    );
    for (const chip of locationChips) {
      if (testLocationCandidate(chip.textContent)) break;
    }

    // Candidate 2: Sublines and metadata containers in topCardEl and detailContainer
    if (!location) {
      const sublineCandidates = [
        topCardEl.querySelector(".job-details-jobs-unified-top-card__primary-description"),
        topCardEl.querySelector(".job-details-jobs-unified-top-card__primary-description-container"),
        topCardEl.querySelector(".jobs-unified-top-card__primary-description"),
        topCardEl.querySelector(".job-details-jobs-unified-top-card__tertiary-description"),
        topCardEl.querySelector(".top-card-layout__first-subline"),
        topCardEl.querySelector(".top-card-layout__second-subline"),
        topCardEl.querySelector("[class*=\"primary-description\"]"),
        topCardEl.querySelector("[class*=\"tertiary-description\"]"),
        topCardEl.querySelector("h1 ~ div, h1 ~ p"),
        detailContainer.querySelector(".job-details-jobs-unified-top-card__primary-description"),
        detailContainer.querySelector(".job-details-jobs-unified-top-card__primary-description-container"),
        detailContainer.querySelector(".jobs-unified-top-card__primary-description"),
        detailContainer.querySelector(".top-card-layout__first-subline"),
        detailContainer.querySelector(".top-card-layout__second-subline"),
        detailContainer.querySelector("[class*=\"primary-description\"]"),
      ];
      for (const sublineEl of sublineCandidates) {
        if (!sublineEl) continue;
        const text = sublineEl.textContent || "";
        if (text.trim().length > 0 && text.trim().length < 250) {
          if (testLocationCandidate(text)) break;
        }
      }
    }

    // Candidate 3: Active selected card in left rail (split pane view)
    if (!location && activeListCard) {
      const railMetaItems = Array.from(
        activeListCard.querySelectorAll(
          ".job-card-container__metadata-item, [class*=\"metadata-item\"], [class*=\"metadata\"], .job-card-container__primary-description ~ div, span, li"
        )
      );
      for (const item of railMetaItems) {
        if (testLocationCandidate(item.textContent)) break;
      }
    }

    // Candidate 4: Leaf text elements in topCardEl (strictly guarded)
    if (!location && topCardEl && topCardEl !== detailContainer && topCardEl !== document.body) {
      const allTopCardNodes = Array.from(topCardEl.querySelectorAll("span, p"));
      for (const node of allTopCardNodes) {
        if (node.children.length === 0) {
          const text = (node.textContent || "").trim();
          if (text.length >= 2 && text.length < 80) {
            if (testLocationCandidate(text)) break;
          }
        }
      }
    }

    // 7. Work Mode & Employment Type Pill Inspection
    let pillWorkMode: WorkMode = null;
    let pillEmploymentType: EmploymentType = null;

    const insightElements = Array.from(
      topCardEl.querySelectorAll(
        "[class*=\"job-insight\"], [class*=\"workplace\"], [class*=\"fit-level\"], .artdeco-pill, [class*=\"pill\"], .job-details-preferences-and-skills li, button, li"
      )
    );
    const activeCardMeta = Array.from(
      activeListCard?.querySelectorAll(".job-card-container__metadata-item, [class*=\"metadata\"]") || []
    );
    const allPillElements = [...insightElements, ...activeCardMeta];

    for (const el of allPillElements) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (!text || text.length > 60) continue;
      // Skip search preference / filter bars
      if (/\b(?:jobs based on|preference|date posted|easy apply|in my network|filter)\b/i.test(text)) continue;

      if (!pillWorkMode) {
        if (/\b(?:on-site|onsite|in-office)\b/i.test(text)) {
          pillWorkMode = "onsite";
        } else if (/\bhybrid\b/i.test(text)) {
          pillWorkMode = "hybrid";
        } else if (/\b(?:remote|work from home)\b/i.test(text)) {
          pillWorkMode = "remote";
        }
      }

      if (!pillEmploymentType) {
        if (/\b(?:internship|intern|co-op)\b/i.test(text)) {
          pillEmploymentType = "internship";
        } else if (/\b(?:full[ -]?time|permanent)\b/i.test(text)) {
          pillEmploymentType = "full_time";
        } else if (/\bpart[ -]?time\b/i.test(text)) {
          pillEmploymentType = "part_time";
        } else if (/\b(?:contract|temporary|freelance)\b/i.test(text)) {
          pillEmploymentType = "contract";
        }
      }
    }

    // Direct scan across top card header if pills were not in standard classes
    if (!pillWorkMode || !pillEmploymentType) {
      const allNodesInHeader = Array.from(topCardEl.querySelectorAll("button, span, div, li, a"));
      for (const el of allNodesInHeader) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (!text || text.length > 60) continue;
        if (/\b(?:jobs based on|preference|date posted|easy apply|in my network|filter)\b/i.test(text)) continue;

        if (!pillWorkMode) {
          if (/\b(?:on-site|onsite|in-office)\b/i.test(text)) {
            pillWorkMode = "onsite";
          } else if (/\bhybrid\b/i.test(text)) {
            pillWorkMode = "hybrid";
          } else if (/\b(?:remote|work from home)\b/i.test(text)) {
            pillWorkMode = "remote";
          }
        }

        if (!pillEmploymentType) {
          if (/\b(?:internship|intern|co-op)\b/i.test(text)) {
            pillEmploymentType = "internship";
          } else if (/\b(?:full[ -]?time|permanent)\b/i.test(text)) {
            pillEmploymentType = "full_time";
          } else if (/\bpart[ -]?time\b/i.test(text)) {
            pillEmploymentType = "part_time";
          } else if (/\b(?:contract|temporary|freelance)\b/i.test(text)) {
            pillEmploymentType = "contract";
          }
        }

        if (pillWorkMode && pillEmploymentType) break;
      }
    }

    const workMode: WorkMode = pillWorkMode || locationWorkMode || null;

    let employmentType: EmploymentType = pillEmploymentType;
    if (!employmentType && title) {
      if (/\b(?:intern|internship|co-op)\b/i.test(title)) {
        employmentType = "internship";
      } else if (/\bcontract\b/i.test(title)) {
        employmentType = "contract";
      }
    }

    // 8. Description Candidate Scoring & Anti-Clipping Selection
    const candidateList: Element[] = [];

    const candidateSelectors = [
      "#job-details",
      ".show-more-less-html__markup",
      ".description__text--rich",
      ".jobs-description__content",
      ".jobs-box__html-content",
      "article.jobs-description__container",
      ".jobs-description",
      ".jobs-description-content__text",
      "section.core-section-container.description",
      "section.description",
      "div.jobs-description",
      "[data-job-description]",
    ];

    const addCandidate = (el: Element | null | undefined) => {
      if (!el || candidateList.includes(el)) return;

      // Never add elements that enclose the top-card layout
      const hasTopCardArtifacts =
        el.querySelector(
          '.job-details-jobs-unified-top-card, .jobs-unified-top-card, .top-card-layout, [data-view-name="job-details-top-card"], button.jobs-apply-button, button.jobs-save-button'
        ) !== null;
      if (hasTopCardArtifacts) return;

      candidateList.push(el);

      const text = (el.textContent || "").trim();
      const isShell =
        /^H[1-6]$/i.test(el.tagName) ||
        el.classList.contains("jobs-details__heading-container") ||
        el.classList.contains("jobs-details__heading") ||
        (/^about\s+(?:the\s+)?job$/i.test(text) && el.children.length <= 2);

      if (isShell) {
        const parent = el.parentElement;
        if (parent) {
          let sib = parent.nextElementSibling || el.nextElementSibling;
          while (sib) {
            const markup =
              sib.querySelector(
                ".show-more-less-html__markup, .description__text--rich, .jobs-box__html-content, [class*=\"description\"]"
              ) || sib;
            if (
              !candidateList.includes(markup) &&
              !markup.querySelector('.job-details-jobs-unified-top-card, button.jobs-apply-button')
            ) {
              candidateList.push(markup);
            }
            sib = sib.nextElementSibling;
          }
          const grandParentSection = parent.closest(
            "section[class*=\"description\"], div.jobs-description, div[class*=\"jobs-description\"], div.core-section-container"
          );
          if (
            grandParentSection &&
            !candidateList.includes(grandParentSection) &&
            !grandParentSection.querySelector('.job-details-jobs-unified-top-card, button.jobs-apply-button')
          ) {
            candidateList.push(grandParentSection);
          }
        }
      }
    };

    // First scan detailContainer
    for (const sel of candidateSelectors) {
      const el = detailContainer.querySelector(sel);
      if (el) addCandidate(el);
    }

    // Explicitly discover "About the job" heading in detailContainer or document
    const headingSearchScope = detailContainer === document ? document : detailContainer;
    const headings = Array.from(
      headingSearchScope.querySelectorAll("h1, h2, h3, h4, h5, h6, .jobs-details__heading, [id*=\"job-details\"]")
    );
    for (const h of headings) {
      const hText = (h.textContent || "").trim();
      if (/^about\s+(?:the\s+)?job$/i.test(hText)) {
        addCandidate(h);
        const section = h.closest(
          "section[class*=\"description\"], div.jobs-description, div.jobs-box__html-content, div[class*=\"description\"]"
        );
        if (section) addCandidate(section);
        let sib = h.nextElementSibling || h.parentElement?.nextElementSibling;
        while (sib) {
          addCandidate(sib);
          sib = sib.nextElementSibling;
        }
      }
    }

    // Fallback to document-level query if candidateList is empty or lacks substantive content (>50 chars)
    const hasSubstantiveCandidate = candidateList.some(
      (c) => (c.textContent || "").trim().length > 50 && !/^about\s+the\s+job$/i.test((c.textContent || "").trim())
    );

    if (!hasSubstantiveCandidate) {
      const docCandidates = document.querySelectorAll(
        ".show-more-less-html__markup, .description__text--rich, .jobs-description__content, .jobs-box__html-content, #job-details, section.core-section-container.description, div.jobs-description"
      );
      docCandidates.forEach((el) => addCandidate(el));

      const docHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [id*=\"job-details\"]"));
      for (const h of docHeadings) {
        if (/^about\s+(?:the\s+)?job$/i.test((h.textContent || "").trim())) {
          addCandidate(h);
          const section = h.closest(
            "section[class*=\"description\"], div[class*=\"description\"], div.core-section-container, div.jobs-box__html-content"
          );
          if (section) addCandidate(section);
          let sib = h.nextElementSibling || h.parentElement?.nextElementSibling;
          while (sib) {
            addCandidate(sib);
            sib = sib.nextElementSibling;
          }
        }
      }
    }

    let bestCandidate: Element | null = null;
    let highestScore = -Infinity;
    const scoringActivePane = isSplitPane ? detailContainer : document;

    for (const cand of candidateList) {
      const breakdown = scoreDescriptionCandidate(cand, scoringActivePane);
      if (breakdown.totalScore > highestScore) {
        highestScore = breakdown.totalScore;
        bestCandidate = cand;
      }
    }

    let descriptionText: string | null = null;
    let descriptionHtml: string | null = null;

    if (bestCandidate && highestScore >= 30) {
      descriptionText = htmlToStructuredMarkdown(bestCandidate);
      descriptionHtml = this.sanitizeHtml(bestCandidate.innerHTML);

      // Clean any accidental top-card residue preceding the "About the job" section
      if (descriptionText) {
        const aboutMatch = descriptionText.match(/(?:^|\n)(#{1,4}\s*about\s+(?:the\s+)?job\b[\s\S]*)$/i);
        if (aboutMatch) {
          const preceding = descriptionText.slice(0, descriptionText.indexOf(aboutMatch[1])).trim();
          if (
            preceding &&
            ((company && preceding.includes(company)) ||
              (title && preceding.includes(title)) ||
              /\b(?:clicked\s+apply|applicants?|managed\s+off\s+linkedin)\b/i.test(preceding))
          ) {
            descriptionText = aboutMatch[1].trim();
          }
        }
      }

      // If the body content does not start with an About the job heading, but a heading exists,
      // prepend "## About the job" so structured heading hierarchy is preserved
      if (descriptionText && !/^#+\s*about\s+the\s+job/i.test(descriptionText.trim())) {
        const headingEl =
          detailContainer.querySelector("#job-details, .jobs-details__heading, h2, h3") ||
          document.querySelector("#job-details, .jobs-details__heading");
        if (headingEl && /about\s+the\s+job/i.test(headingEl.textContent || "")) {
          descriptionText = `## About the job\n\n${descriptionText}`;
        }
      }
    }

    if (!descriptionText) {
      const headingOnlyEl =
        detailContainer.querySelector("#job-details, .jobs-details__heading-container, .jobs-details__heading") ||
        document.querySelector("#job-details, .jobs-details__heading-container, .jobs-details__heading");
      if (headingOnlyEl && /about\s+the\s+job/i.test(headingOnlyEl.textContent || "")) {
        descriptionText = "## About the job";
      }
    }

    if (!employmentType && descriptionText) {
      employmentType = this.detectEmploymentType(descriptionText);
    }

    // 9. Multi-Tier Structured Compensation Parsing
    // Tier 1: Active Detail Pane Insight Pill (Highest trust)
    let salaryRaw: string | null = null;
    let salarySource = "none";

    // Tier 1: Active Detail Pane Insight Pills & Buttons (Native iteration, standard CSS only)
    const pillCandidates = Array.from(
      detailContainer.querySelectorAll(
        ".job-details-preference-pill, button[class*=\"preference\"], .job-details-jobs-unified-top-card__job-insight--highlight, .jobs-unified-top-card__job-insight--highlight, [class*=\"job-insight--highlight\"], [class*=\"salary-compensation-text\"], .compensation__salary, .job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight, [class*=\"job-insight\"]"
      )
    );
    for (const pill of pillCandidates) {
      const text = pill.textContent?.trim() || "";
      if (!text || text.length > 80) continue;
      if (/\b(?:applicant|posted|reposted|reviewing|applicants)\b/i.test(text)) continue;
      const parsed = this.parseSalary(text);
      if (parsed) {
        salaryRaw = parsed;
        salarySource = "detail-insight-pill";
        break;
      }
    }

    // Tier 2: Active Detail Pane Subtitle / Topcard
    if (!salaryRaw) {
      const sublineSalaryEl = detailContainer.querySelector(
        ".job-details-jobs-unified-top-card__primary-description, .top-card-layout__second-subline"
      );
      if (sublineSalaryEl) {
        salaryRaw = this.parseSalary(sublineSalaryEl.textContent);
        if (salaryRaw) salarySource = "detail-subline";
      }
    }

    // Tier 3: Active Left-Rail Card (Strictly scoped to targetJobId)
    if (!salaryRaw && activeListCard) {
      const railSalaryEl = activeListCard.querySelector(".job-card-container__metadata-item, [class*=\"salary\"]");
      if (railSalaryEl) {
        salaryRaw = this.parseSalary(railSalaryEl.textContent);
        if (salaryRaw) salarySource = "active-rail-card";
      }
    }

    // Tier 4: Description Body (Fallback only)
    if (!salaryRaw && descriptionText) {
      salaryRaw = this.parseSalary(descriptionText);
      if (salaryRaw) salarySource = "description-body";
    }

    // 10. Granular Field Quality Mapping & Validation
    const isDescValid = isMeaningfulDescription(descriptionText);

    const fieldQuality: FieldQualityMap = {
      title: {
        status: title ? "detected" : "missing",
        confidence: title ? 1.0 : 0.0,
        source: "detail-topcard-h1",
      },
      company: {
        status: company ? "detected" : "missing",
        confidence: company ? 1.0 : 0.0,
        source: "detail-company-link",
      },
      location: {
        status: location ? "detected" : "missing",
        confidence: location ? 0.9 : 0.0,
        source: "topcard-flavor-token",
      },
      workMode: {
        status: workMode ? "detected" : "missing",
        confidence: workMode ? 0.95 : 0.0,
        source: "insight-pill",
      },
      employmentType: {
        status: employmentType ? "detected" : "missing",
        confidence: employmentType ? 0.95 : 0.0,
        source: "insight-pill",
      },
      salary: {
        status: salaryRaw ? "detected" : "missing",
        confidence: salaryRaw ? 0.9 : 0.0,
        source: salarySource,
      },
      description: {
        status: !descriptionText
          ? "missing"
          : !isDescValid
          ? "partial"
          : descriptionText.length < 30
          ? "uncertain"
          : "detected",
        confidence: isDescValid && descriptionText ? (descriptionText.length < 30 ? 0.7 : 0.95) : 0.2,
        charCount: descriptionText?.length || 0,
        source: "description-candidate-scoring",
        reason: !isDescValid && descriptionText
          ? "Truncated heading shell only"
          : descriptionText && descriptionText.length < 30
          ? "Short description: review recommended"
          : undefined,
      },
    };

    const { score, detected, missing } = this.calculateConfidence({
      title,
      company,
      location,
      descriptionText: isDescValid ? descriptionText : null,
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
      sourcePlatform: "linkedin",
      sourceJobId: targetJobId,
      confidenceScore: score,
      detectedFields: detected,
      missingFields: missing,
      fieldQuality,
    };
  }
}
