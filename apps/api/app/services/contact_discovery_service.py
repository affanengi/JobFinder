"""Professional Contact Discovery & Email Evidence Classification Service.

Enforces:
1. Public professional contact discovery (Recruiters > Hiring Managers > Tech Leads > Regional Leads).
2. Hyderabad location prioritization (+50 ranking boost).
3. 6-tier Email Evidence Taxonomy (PUBLICLY_LISTED, PROVIDER_VERIFIED, PATTERN_INFERRED,
   DOMAIN_MAIL_ENABLED, UNVERIFIED, INVALID_OR_UNSUPPORTED).
4. Passive DNS MX validation via aiodns without mailbox verification claims.
5. Search provider abstraction under CostPolicy.FREE_ONLY (Exa -> Brave -> Fallback Browser Links).
6. Tenant-isolated Firestore persistence (users/{userId}/opportunity_contacts/{contactId}).
7. Zero automated email sending.
"""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Optional

from app.core.config import settings
from app.db.repositories.company_intelligence_repo import company_intelligence_repo
from app.db.repositories.opportunity_contact_repo import (
    OpportunityContactRepository,
    opportunity_contact_repo,
)
from app.schemas.job import CanonicalJob
from app.schemas.opportunity_contact import (
    ChannelPurpose,
    ContactDiscoveryResponse,
    ContactSearchLink,
    ContactType,
    ContactabilityStatus,
    DiscoveredContact,
    EmailEvidenceClassification,
    MXRecordStatus,
    RoleEvidenceStatus,
    StakeholderTier,
)
from app.services.agent_reach_service import agent_reach_service
from app.services.job_service import job_service
from app.services.search_provider import (
    AgentReachSearchProvider,
    BraveSearchProvider,
    ExaSearchProvider,
    FallbackQueryLinkProvider,
    RawContactCandidate,
)
from app.utils.contact_identity import (
    categorize_role_title,
    check_signal_divergence,
    compute_deterministic_contact_id,
    extract_linkedin_vanity_slug,
    generate_ambiguity_discriminant_id,
    generate_candidate_identity_keys,
    normalize_company_key,
    normalize_email_address,
)
from app.utils.dns_verifier import MX_DISCLAIMER, verify_domain_mx

logger = logging.getLogger("jobFinder.services.contact_discovery")

# Priority ranking constants
TIER_BASE_SCORES: dict[StakeholderTier, int] = {
    "RECRUITER": 400,
    "HIRING_MANAGER": 300,
    "TECH_LEAD": 200,
    "REGIONAL_LEAD": 100,
    "OTHER": 50,
}

HYDERABAD_LOCATION_BOOST = 50
EMAIL_PRESENT_BOOST = 25
PUBLIC_EMAIL_BOOST = 15


def classify_stakeholder_tier(role_title: str) -> StakeholderTier:
    """Classify stakeholder into hierarchical tier based on professional title keywords."""
    if not role_title:
        return "OTHER"

    title_lower = role_title.lower()

    # 1. Recruiters and Talent Acquisition (Top Priority)
    if any(
        kw in title_lower
        for kw in (
            "recruiter",
            "talent acquisition",
            "sourcer",
            "recruiting",
            "people partner",
            "head of talent",
            "staffing",
            "technical recruiter",
            "talent partner",
            "talent lead",
        )
    ):
        return "RECRUITER"

    # 2. Hiring Managers & Engineering Management
    if any(
        kw in title_lower
        for kw in (
            "hiring manager",
            "engineering manager",
            "director of engineering",
            "director of technology",
            "vp of engineering",
            "vice president of engineering",
            "head of engineering",
            "development manager",
            "engineering lead",
        )
    ):
        return "HIRING_MANAGER"

    # 3. Technical Leads & Staff/Principal Engineers
    if any(
        kw in title_lower
        for kw in (
            "tech lead",
            "technical lead",
            "staff engineer",
            "principal engineer",
            "lead software engineer",
            "lead architect",
            "lead developer",
            "lead data engineer",
            "distinguished engineer",
        )
    ):
        return "TECH_LEAD"

    # 4. Regional or Department Leads
    if any(
        kw in title_lower
        for kw in (
            "site lead",
            "india lead",
            "head of india",
            "general manager",
            "country manager",
            "regional lead",
            "regional director",
            "managing director",
        )
    ):
        return "REGIONAL_LEAD"

    return "OTHER"


def is_hyderabad_location(location_str: str | None) -> bool:
    """Determine if contact or opportunity location matches Hyderabad / Telangana hub."""
    if not location_str:
        return False
    loc = location_str.lower()
    return any(kw in loc for kw in ("hyderabad", "telangana", "cyberabad", "hitec city", "gachibowli", "kondapur"))


def validate_email_syntax(email: str | None) -> bool:
    """Check basic RFC email syntax validity."""
    if not email or not isinstance(email, str):
        return False
    pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
    return bool(re.match(pattern, email.strip()))


class ContactDiscoveryService:
    """Orchestrates public professional contact discovery, email evidence classification, and ranking."""

    def __init__(
        self,
        repo: OpportunityContactRepository | None = None,
        agent_reach_provider: AgentReachSearchProvider | None = None,
        exa_provider: ExaSearchProvider | None = None,
        brave_provider: BraveSearchProvider | None = None,
    ):
        self.repo = repo or opportunity_contact_repo
        self.agent_reach = agent_reach_provider or AgentReachSearchProvider()
        self.exa = exa_provider or ExaSearchProvider()
        self.brave = brave_provider or BraveSearchProvider()
        self.link_provider = FallbackQueryLinkProvider()

    async def discover_contacts(
        self,
        user_id: str,
        opportunity_id: str,
        force_refresh: bool = False,
    ) -> ContactDiscoveryResponse:
        """Discover, classify, rank, and persist professional contacts for a target opportunity."""
        # 1. Fetch opportunity details
        job = job_service.get_job(opportunity_id)
        if not job:
            raise ValueError(f"Opportunity with ID '{opportunity_id}' not found.")

        company_name = job.company or "Target Company"
        comp_key = normalize_company_key(company_name)

        # 2. Return cached contacts if available and not forced
        if not force_refresh:
            existing = self.repo.list_contacts_for_opportunity(user_id=user_id, opportunity_id=opportunity_id)
            if existing:
                # Sort existing by rankingScore descending
                sorted_existing = sorted(existing, key=lambda c: c.rankingScore, reverse=True)
                search_links = self.link_provider.generate_links(company_name)
                return ContactDiscoveryResponse(
                    opportunityId=opportunity_id,
                    companyName=company_name,
                    contacts=sorted_existing,
                    searchLinks=search_links,
                    providerUsed="cache",
                    costPolicyEnforced="FREE_ONLY",
                    message=f"Retrieved {len(sorted_existing)} cached professional contacts.",
                    totalExamined=len(sorted_existing),
                    newDiscovered=0,
                    existingRefreshed=0,
                    tombstonesSuppressed=0,
                    attemptedAngles=[],
                    cached=True,
                )

            # Check cross-opportunity company-scoped contacts for reuse before making search calls
            company_contacts = self.repo.list_active_contacts_for_company(
                user_id=user_id, company_name_or_key=comp_key
            )
            if company_contacts:
                for c in company_contacts:
                    if opportunity_id not in c.associatedOpportunityIds:
                        c.associatedOpportunityIds.append(opportunity_id)
                        self.repo.save_contact(c)
                sorted_existing = sorted(company_contacts, key=lambda c: c.rankingScore, reverse=True)
                search_links = self.link_provider.generate_links(company_name)
                return ContactDiscoveryResponse(
                    opportunityId=opportunity_id,
                    companyName=company_name,
                    contacts=sorted_existing,
                    searchLinks=search_links,
                    providerUsed="company_reuse",
                    costPolicyEnforced="FREE_ONLY",
                    message=f"Reused {len(sorted_existing)} active contacts from another opportunity at {company_name}.",
                    totalExamined=len(sorted_existing),
                    newDiscovered=0,
                    existingRefreshed=len(sorted_existing),
                    tombstonesSuppressed=0,
                    attemptedAngles=[],
                    cached=True,
                )

        # 3. Discover candidates via configured free search provider or public company intelligence
        raw_candidates: list[RawContactCandidate] = []
        attempted_angles: list[str] = []
        provider_used = "fallback_links"

        # Check Agent Reach (Primary free search provider via local CLI)
        if self.agent_reach.is_configured():
            try:
                ar_results = await self.agent_reach.search_contacts(
                    company_name=company_name,
                    return_angles=True,
                )
                if isinstance(ar_results, tuple):
                    candidates, angles = ar_results
                    raw_candidates.extend(candidates)
                    attempted_angles.extend(angles)
                elif isinstance(ar_results, list):
                    raw_candidates.extend(ar_results)
                    attempted_angles.extend(getattr(self.agent_reach, "last_attempted_angles", []))
                if raw_candidates:
                    provider_used = "agent_reach"
            except Exception as e:
                logger.warning(f"Agent Reach search failed for {company_name}: {e}")

        # Check Exa (if configured and within free allowance)
        if not raw_candidates and self.exa.is_configured():
            try:
                exa_results = await self.exa.search_contacts(company_name=company_name)
                if exa_results:
                    raw_candidates.extend(exa_results)
                    provider_used = "exa"
                    attempted_angles = ["Exa Neural Search"]
            except Exception as e:
                logger.warning(f"Exa search failed: {e}")

        # If no candidates yet and Brave configured, check Brave
        if not raw_candidates and self.brave.is_configured():
            try:
                brave_results = await self.brave.search_contacts(company_name=company_name)
                if brave_results:
                    raw_candidates.extend(brave_results)
                    provider_used = "brave"
                    attempted_angles = ["Brave Web Search"]
            except Exception as e:
                logger.warning(f"Brave search failed: {e}")

        # Also inspect Phase 1 Company Intelligence and public page for official team/recruiting contacts
        domain_hint = None
        intel = company_intelligence_repo.get_intelligence(user_id=user_id, opportunity_id=opportunity_id)
        if intel and intel.officialDomain:
            domain_hint = intel.officialDomain

        # Extract from public careers page if available
        careers_url = (
            getattr(job, "applyUrl", None)
            or getattr(job, "sourceUrl", None)
            or (job.sourceRef.originalUrl if hasattr(job, "sourceRef") and job.sourceRef else None)
        )
        if careers_url and ("careers" in careers_url.lower() or "lever.co" in careers_url.lower() or "greenhouse.io" in careers_url.lower()):
            careers_contacts = await self._extract_public_page_contacts(
                url=careers_url,
                company_name=company_name,
            )
            raw_candidates.extend(careers_contacts)
            if careers_contacts and provider_used == "fallback_links":
                provider_used = "company_page"

        # 4. Generate fallback search links (always available for $0)
        search_links = self.link_provider.generate_links(company_name)

        # Stage B: Identity and role currency evaluation & filtering
        # Exclude former employees from active recommendations while keeping current and likely current
        active_candidates: list[RawContactCandidate] = []
        for cand in raw_candidates:
            if cand.role_evidence_status == "FORMER_ROLE":
                logger.info(
                    f"Excluding former role candidate '{cand.full_name}' from active recommendations for '{company_name}'."
                )
                continue
            active_candidates.append(cand)

        # Stage C: Deduplicate raw candidates within batch respecting identity signals
        deduped = self._deduplicate_candidates(active_candidates, company_name)

        # Stage D: Pre-persistence tombstone check, cross-opportunity active deduplication & safe persistence
        active_company_contacts = self.repo.list_active_contacts_for_company(
            user_id=user_id,
            company_name_or_key=comp_key,
        )

        total_examined = len(raw_candidates)
        new_discovered = 0
        existing_refreshed = 0
        tombstones_suppressed = 0
        processed_contacts: list[DiscoveredContact] = []

        for candidate in deduped:
            cand_keys = generate_candidate_identity_keys(
                full_name=candidate.full_name,
                company_name=company_name,
                role_title=candidate.role_title,
                linkedin_url=candidate.linkedin_url,
                email=candidate.email,
            )

            # Check 1: Cross-opportunity Tombstone suppression (atomic/concurrency safety)
            if self.repo.is_identity_tombstoned(
                user_id=user_id,
                company_name_or_key=comp_key,
                identity_keys=cand_keys,
            ):
                tombstones_suppressed += 1
                logger.info(
                    f"Suppressed candidate '{candidate.full_name}' matching tombstone for '{company_name}'."
                )
                continue

            # Check 2: Strong identity matching against active company contacts
            cand_strong_keys = {k for k in cand_keys if k.startswith(("li:", "em:"))}
            matched_existing: DiscoveredContact | None = None

            for existing in active_company_contacts:
                if existing.isDeleted:
                    continue
                exist_keys = set(existing.identityKeys or [])
                if cand_strong_keys and (cand_strong_keys & exist_keys):
                    if not check_signal_divergence(cand_keys, existing.identityKeys or []):
                        matched_existing = existing
                        break

            if matched_existing:
                # Reuse existing contact document across opportunities!
                if opportunity_id not in matched_existing.associatedOpportunityIds:
                    matched_existing.associatedOpportunityIds.append(opportunity_id)

                # Merge new evidence without overwriting reliable existing info
                if not matched_existing.email and candidate.email and validate_email_syntax(candidate.email):
                    matched_existing.email = candidate.email
                    domain = candidate.email.split("@")[-1].lower()
                    mx_status, mx_hosts = await verify_domain_mx(domain)
                    matched_existing.mxStatus = mx_status
                    if mx_status == "VALID_MX":
                        matched_existing.emailClassification = "DOMAIN_MAIL_ENABLED"
                        matched_existing.emailEvidenceSummary = (
                            f"Domain '{domain}' has confirmed MX records ({', '.join(mx_hosts[:2])}). {MX_DISCLAIMER}"
                        )
                    else:
                        matched_existing.emailClassification = "UNVERIFIED"

                if not matched_existing.linkedinUrl and candidate.linkedin_url:
                    matched_existing.linkedinUrl = candidate.linkedin_url
                if not matched_existing.githubUrl and candidate.github_url:
                    matched_existing.githubUrl = candidate.github_url
                if not matched_existing.portfolioUrl and candidate.portfolio_url:
                    matched_existing.portfolioUrl = candidate.portfolio_url
                if candidate.source_url and candidate.source_url not in matched_existing.sourceUrls:
                    matched_existing.sourceUrls.append(candidate.source_url)
                if candidate.snippet and candidate.snippet not in matched_existing.evidenceSnippets:
                    matched_existing.evidenceSnippets.append(candidate.snippet)

                matched_existing.identityKeys = sorted(list(set((matched_existing.identityKeys or []) + cand_keys)))
                matched_existing.companyKey = comp_key
                matched_existing.lastCheckedAt = datetime.now(UTC).isoformat()

                saved = self.repo.save_contact(matched_existing)
                existing_refreshed += 1
                processed_contacts.append(saved)
                continue

            # Check 3: Weak matching and Ambiguity Protection
            cand_norm_name = re.sub(r"\s+", " ", candidate.full_name.strip().lower())
            weak_match: DiscoveredContact | None = None
            for existing in active_company_contacts:
                if existing.isDeleted:
                    continue
                exist_norm_name = re.sub(r"\s+", " ", existing.fullName.strip().lower())
                if exist_norm_name == cand_norm_name:
                    weak_match = existing
                    break

            if weak_match:
                is_diverging = check_signal_divergence(cand_keys, weak_match.identityKeys or [])
                # Ambiguous or diverging match: NEVER merge automatically!
                ambiguity_id = generate_ambiguity_discriminant_id(
                    full_name=candidate.full_name,
                    company_name=company_name,
                    role_title=candidate.role_title,
                    location=candidate.location,
                    linkedin_url=candidate.linkedin_url,
                )
                contact = await self._process_and_rank_candidate(
                    candidate=candidate,
                    user_id=user_id,
                    opportunity_id=opportunity_id,
                    company_name=company_name,
                    domain_hint=domain_hint,
                    provider_name=provider_used,
                    contact_id=ambiguity_id,
                )
                contact.isAmbiguousMatch = True
                contact.ambiguityReason = (
                    "Multiple contacts found with identical or similar name at company with diverging identity signals."
                    if is_diverging
                    else "Multiple contacts found with identical or similar name without corroborating strong identity verification."
                )
                contact.companyKey = comp_key
                contact.identityKeys = cand_keys
                contact.associatedOpportunityIds = [opportunity_id]

                saved = self.repo.save_contact(contact)
                active_company_contacts.append(saved)
                new_discovered += 1
                processed_contacts.append(saved)
                continue

            # Check 4: Completely New Contact
            deterministic_id = compute_deterministic_contact_id(
                full_name=candidate.full_name,
                company_name=company_name,
                linkedin_url=candidate.linkedin_url,
                email=candidate.email,
            )
            contact = await self._process_and_rank_candidate(
                candidate=candidate,
                user_id=user_id,
                opportunity_id=opportunity_id,
                company_name=company_name,
                domain_hint=domain_hint,
                provider_name=provider_used,
                contact_id=deterministic_id,
            )
            contact.companyKey = comp_key
            contact.identityKeys = cand_keys
            contact.associatedOpportunityIds = [opportunity_id]
            contact.isAmbiguousMatch = False

            saved = self.repo.save_contact(contact)
            active_company_contacts.append(saved)
            new_discovered += 1
            processed_contacts.append(saved)

        # Sort by ranking score descending
        processed_contacts.sort(key=lambda c: c.rankingScore, reverse=True)

        message = (
            f"Discovered {len(processed_contacts)} professional contacts for {company_name}."
            if processed_contacts
            else f"No public contacts discovered for {company_name} with sufficient evidence. Use the pre-formatted browser search links below."
        )

        return ContactDiscoveryResponse(
            opportunityId=opportunity_id,
            companyName=company_name,
            contacts=processed_contacts,
            searchLinks=search_links,
            providerUsed=provider_used,
            costPolicyEnforced="FREE_ONLY",
            message=message,
            totalExamined=total_examined,
            newDiscovered=new_discovered,
            existingRefreshed=existing_refreshed,
            tombstonesSuppressed=tombstones_suppressed,
            attemptedAngles=attempted_angles,
            cached=False,
        )

    async def _extract_public_page_contacts(
        self,
        url: str,
        company_name: str,
    ) -> list[RawContactCandidate]:
        """Extract public email addresses and official organizational channels from public careers page."""
        results: list[RawContactCandidate] = []
        try:
            page_res = await agent_reach_service.fetch_page_content(url)
            if not page_res.ok or not page_res.text:
                return []

            text = page_res.text
            emails = re.findall(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text)
            clean_emails = set()
            for em in emails:
                em_lower = em.lower()
                # Skip common generic system emails
                if not any(ign in em_lower for ign in ("sentry.io", "example.com", "w3.org", "noreply", "no-reply", "schema.org")):
                    clean_emails.add(em_lower)

            for email in clean_emails:
                prefix = email.split("@")[0].lower()

                # Abolish synthetic recruiter identities: map generic inboxes to ORGANIZATION_CHANNEL
                if "accommodat" in prefix or "accessib" in prefix:
                    results.append(
                        RawContactCandidate(
                            full_name="Accommodations & Accessibility Inbox",
                            role_title="Candidate Accommodations Channel",
                            company=company_name,
                            location="Corporate / Global",
                            email=email,
                            source_url=url,
                            snippet=f"Attributable public accommodations email discovered on careers page: {email}",
                            provider="company_page",
                            contact_type="ORGANIZATION_CHANNEL",
                            channel_purpose="ACCOMMODATIONS_ONLY",
                            role_evidence_status="CURRENT_CONFIRMED",
                        )
                    )
                elif any(kw in prefix for kw in ("career", "job", "apply")):
                    results.append(
                        RawContactCandidate(
                            full_name="Official Careers Channel",
                            role_title="General Careers Mailbox",
                            company=company_name,
                            location="Corporate / Global",
                            email=email,
                            source_url=url,
                            snippet=f"Attributable public careers mailbox discovered on careers page: {email}",
                            provider="company_page",
                            contact_type="ORGANIZATION_CHANNEL",
                            channel_purpose="GENERAL_CAREERS_INBOX",
                            role_evidence_status="CURRENT_CONFIRMED",
                        )
                    )
                elif any(kw in prefix for kw in ("hr", "talent", "recruit", "people")):
                    results.append(
                        RawContactCandidate(
                            full_name="Talent & People Shared Inbox",
                            role_title="HR Shared Mailbox",
                            company=company_name,
                            location="Corporate / Global",
                            email=email,
                            source_url=url,
                            snippet=f"Attributable public recruiting mailbox discovered on careers page: {email}",
                            provider="company_page",
                            contact_type="ORGANIZATION_CHANNEL",
                            channel_purpose="HR_SHARED_INBOX",
                            role_evidence_status="CURRENT_CONFIRMED",
                        )
                    )
                elif any(kw in prefix for kw in ("press", "media", "pr", "ir", "investor")):
                    results.append(
                        RawContactCandidate(
                            full_name="Press & Media Relations",
                            role_title="Media Relations Channel",
                            company=company_name,
                            location="Corporate / Global",
                            email=email,
                            source_url=url,
                            snippet=f"Public media relations mailbox discovered on page: {email}",
                            provider="company_page",
                            contact_type="ORGANIZATION_CHANNEL",
                            channel_purpose="PRESS_INVESTOR_RELATIONS",
                            role_evidence_status="CURRENT_CONFIRMED",
                        )
                    )
                else:
                    results.append(
                        RawContactCandidate(
                            full_name=f"{company_name} Official Channel",
                            role_title="Public Organization Channel",
                            company=company_name,
                            location="Corporate / Global",
                            email=email,
                            source_url=url,
                            snippet=f"Attributable public email discovered on page: {email}",
                            provider="company_page",
                            contact_type="ORGANIZATION_CHANNEL",
                            channel_purpose="UNSPECIFIED",
                            role_evidence_status="CURRENT_CONFIRMED",
                        )
                    )
        except Exception as e:
            logger.warning(f"Error extracting page contacts from {url}: {e}")

        return results

    def _deduplicate_candidates(
        self,
        candidates: list[RawContactCandidate],
        target_company: str,
    ) -> list[RawContactCandidate]:
        """Deduplicate candidates within the raw search batch, respecting identity signals and avoiding false-positive merges."""
        deduped: list[RawContactCandidate] = []

        for c in candidates:
            c_keys = generate_candidate_identity_keys(
                full_name=c.full_name,
                company_name=target_company,
                role_title=c.role_title,
                linkedin_url=c.linkedin_url,
                email=c.email,
            )
            c_strong_keys = {k for k in c_keys if k.startswith(("li:", "em:"))}

            # Check if this candidate matches any candidate already in deduped
            matched_idx = -1
            for idx, existing in enumerate(deduped):
                e_keys = generate_candidate_identity_keys(
                    full_name=existing.full_name,
                    company_name=target_company,
                    role_title=existing.role_title,
                    linkedin_url=existing.linkedin_url,
                    email=existing.email,
                )
                e_strong_keys = {k for k in e_keys if k.startswith(("li:", "em:"))}

                # Strong match: matching LinkedIn vanity slug or verified email
                if c_strong_keys and e_strong_keys and (c_strong_keys & e_strong_keys):
                    if not check_signal_divergence(c_keys, e_keys):
                        matched_idx = idx
                        break

                # If no strong match, check weak match (exact full name and company)
                c_norm_name = re.sub(r"\s+", " ", c.full_name.strip().lower())
                e_norm_name = re.sub(r"\s+", " ", existing.full_name.strip().lower())
                if c_norm_name == e_norm_name:
                    # Check for divergence!
                    if check_signal_divergence(c_keys, e_keys):
                        # Diverging strong signals (e.g. different LinkedIn URLs or emails) -> DO NOT merge!
                        continue

                    cat_c = categorize_role_title(c.role_title)
                    cat_e = categorize_role_title(existing.role_title)
                    # If roles clearly belong to different functional disciplines, keep distinct
                    if cat_c != cat_e and cat_c != "other" and cat_e != "other":
                        continue

                    # Same person discovered across snippets with consistent or complementary evidence
                    matched_idx = idx
                    break

            if matched_idx >= 0:
                existing = deduped[matched_idx]
                # Merge fields: keep non-empty email, channels, snippet and url
                if not existing.email and c.email:
                    existing.email = c.email
                if not existing.linkedin_url and c.linkedin_url:
                    existing.linkedin_url = c.linkedin_url
                if not existing.github_url and c.github_url:
                    existing.github_url = c.github_url
                if not existing.portfolio_url and c.portfolio_url:
                    existing.portfolio_url = c.portfolio_url
                if not existing.location and c.location:
                    existing.location = c.location
                if len(c.role_title) > len(existing.role_title):
                    existing.role_title = c.role_title
                if c.role_evidence_status == "CURRENT_CONFIRMED" and existing.role_evidence_status != "CURRENT_CONFIRMED":
                    existing.role_evidence_status = "CURRENT_CONFIRMED"
            else:
                deduped.append(c)

        return deduped

    async def _process_and_rank_candidate(
        self,
        candidate: RawContactCandidate,
        user_id: str,
        opportunity_id: str,
        company_name: str,
        domain_hint: str | None,
        provider_name: str,
        contact_id: str | None = None,
    ) -> DiscoveredContact:
        """Classify stakeholder tier, evaluate channels & role currency, check MX records, and rank."""
        if not contact_id:
            contact_id = compute_deterministic_contact_id(
                full_name=candidate.full_name,
                company_name=company_name,
                linkedin_url=candidate.linkedin_url,
                email=candidate.email,
            )
        comp_key = normalize_company_key(company_name)
        cand_keys = generate_candidate_identity_keys(
            full_name=candidate.full_name,
            company_name=company_name,
            role_title=candidate.role_title,
            linkedin_url=candidate.linkedin_url,
            email=candidate.email,
        )

        tier = classify_stakeholder_tier(candidate.role_title)
        is_hyd = is_hyderabad_location(candidate.location)
        role_evidence: RoleEvidenceStatus = (
            candidate.role_evidence_status  # type: ignore[assignment]
            if candidate.role_evidence_status in ("CURRENT_CONFIRMED", "LIKELY_CURRENT", "FORMER_ROLE", "UNCLEAR_ASSOCIATION")
            else "LIKELY_CURRENT"
        )

        # Base score from stakeholder priority
        score = TIER_BASE_SCORES.get(tier, 50)
        reasons: list[str] = [f"Stakeholder tier: {tier.replace('_', ' ').title()} (+{score})"]

        if is_hyd:
            score += HYDERABAD_LOCATION_BOOST
            reasons.append("Hyderabad location match (+50)")

        # Role evidence scoring
        if role_evidence == "CURRENT_CONFIRMED":
            score += 20
            reasons.append("Confirmed current role (+20)")
        elif role_evidence == "UNCLEAR_ASSOCIATION":
            score -= 20
            reasons.append("Unclear company association (-20)")

        # Organization channel penalties / adjustments
        if candidate.contact_type == "ORGANIZATION_CHANNEL":
            if candidate.channel_purpose == "ACCOMMODATIONS_ONLY":
                score -= 150
                reasons.append("Accommodations inbox penalty (-150)")
            elif candidate.channel_purpose == "PRESS_INVESTOR_RELATIONS":
                score -= 100
                reasons.append("Press/IR mailbox penalty (-100)")
            elif candidate.channel_purpose in ("GENERAL_CAREERS_INBOX", "HR_SHARED_INBOX"):
                score -= 30
                reasons.append("Shared mailbox deprioritization (-30)")

        # Email Evidence Classification
        email = candidate.email
        email_classification: EmailEvidenceClassification = "UNVERIFIED"
        evidence_summary: str = ""
        mx_status: MXRecordStatus = "UNCHECKED"

        if email:
            if not validate_email_syntax(email):
                email_classification = "INVALID_OR_UNSUPPORTED"
                evidence_summary = "Email syntax is invalid or malformed."
                mx_status = "NO_MX"
            else:
                domain = email.split("@")[-1].lower()
                mx_status, mx_hosts = await verify_domain_mx(domain)

                if mx_status == "NO_MX":
                    email_classification = "INVALID_OR_UNSUPPORTED"
                    evidence_summary = f"Domain '{domain}' has no valid DNS MX mail exchanger records."
                elif candidate.provider == "company_page":
                    email_classification = "PUBLICLY_LISTED"
                    evidence_summary = f"Explicitly listed on official public careers/company page. {MX_DISCLAIMER}"
                    score += EMAIL_PRESENT_BOOST + PUBLIC_EMAIL_BOOST
                    reasons.append("Publicly listed contact email (+40)")
                elif mx_status == "VALID_MX":
                    email_classification = "DOMAIN_MAIL_ENABLED"
                    evidence_summary = (
                        f"Domain '{domain}' has confirmed MX mail exchangers ({', '.join(mx_hosts[:2])}). "
                        f"{MX_DISCLAIMER}"
                    )
                    score += EMAIL_PRESENT_BOOST
                    reasons.append("Domain mail enabled (+25)")
                else:
                    email_classification = "UNVERIFIED"
                    evidence_summary = "DNS MX lookup failed or timed out. Address remains unverified."
        else:
            evidence_summary = "No public email address discovered for this contact."

        # Determine honest contactability status
        has_email = bool(email and email.strip())
        profile_count = sum([
            bool(candidate.linkedin_url),
            bool(candidate.github_url),
            bool(candidate.portfolio_url),
        ])

        if candidate.contact_type == "ORGANIZATION_CHANNEL":
            contactability_status: ContactabilityStatus = "GENERIC_INBOX_FOUND"
        elif has_email and profile_count >= 1:
            contactability_status = "MULTIPLE_PUBLIC_CHANNELS_FOUND"
        elif has_email:
            contactability_status = "DIRECT_EMAIL_FOUND"
        elif profile_count >= 2:
            contactability_status = "MULTIPLE_PUBLIC_CHANNELS_FOUND"
        elif profile_count == 1:
            contactability_status = "PROFILE_ONLY"
        else:
            contactability_status = "INSUFFICIENT_EVIDENCE"

        if contactability_status == "PROFILE_ONLY":
            score += 15
            reasons.append("Public profile verified (+15)")

        ranking_reason = " • ".join(reasons)

        sources = [candidate.source_url] if candidate.source_url else []
        snippets = [candidate.snippet] if candidate.snippet else []

        return DiscoveredContact(
            id=contact_id,
            userId=user_id,
            opportunityId=opportunity_id,
            companyName=company_name,
            companyKey=comp_key,
            fullName=candidate.full_name,
            roleTitle=candidate.role_title,
            stakeholderTier=tier,
            contactType=candidate.contact_type,  # type: ignore[arg-type]
            channelPurpose=candidate.channel_purpose,  # type: ignore[arg-type]
            location=candidate.location,
            isHyderabad=is_hyd,
            email=email,
            emailClassification=email_classification,
            emailEvidenceSummary=evidence_summary,
            mxStatus=mx_status,
            linkedinUrl=candidate.linkedin_url,
            githubUrl=candidate.github_url,
            portfolioUrl=candidate.portfolio_url,
            contactabilityStatus=contactability_status,
            roleEvidenceStatus=role_evidence,
            sourceUrls=sources,
            evidenceSnippets=snippets,
            searchProviderUsed=candidate.provider or provider_name,
            confidenceScore=0.85 if email_classification == "PUBLICLY_LISTED" else 0.70 if tier in ("RECRUITER", "HIRING_MANAGER") else 0.50,
            rankingScore=max(0, score),
            rankingReason=ranking_reason,
            isDismissed=False,
            isReviewed=False,
            isDeleted=False,
            isAmbiguousMatch=False,
            associatedOpportunityIds=[opportunity_id],
            identityKeys=cand_keys,
            discoveredAt=datetime.now(UTC).isoformat(),
            lastCheckedAt=datetime.now(UTC).isoformat(),
        )


    def get_contacts(self, user_id: str, opportunity_id: str) -> list[DiscoveredContact]:
        """Fetch discovered contacts for opportunity, ordered by rankingScore descending."""
        contacts = self.repo.list_contacts_for_opportunity(user_id=user_id, opportunity_id=opportunity_id)
        return sorted(contacts, key=lambda c: c.rankingScore, reverse=True)

    def update_contact_status(
        self,
        user_id: str,
        contact_id: str,
        is_dismissed: Optional[bool] = None,
        is_reviewed: Optional[bool] = None,
    ) -> Optional[DiscoveredContact]:
        """Update review or dismissal state of a contact with tenant verification."""
        return self.repo.update_contact_status(
            user_id=user_id,
            contact_id=contact_id,
            is_dismissed=is_dismissed,
            is_reviewed=is_reviewed,
        )


contact_discovery_service = ContactDiscoveryService()
