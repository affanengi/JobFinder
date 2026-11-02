import asyncio
import logging
import re
import uuid
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.core.auth import get_authenticated_user_id, get_optional_authenticated_user_id
from app.db.repositories.bulk_research_job_repo import bulk_research_job_repo
from app.db.repositories.company_intelligence_repo import company_intelligence_repo
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.schemas.company import (
    BulkCompanyResearchRequest,
    BulkCompanyResearchResponse,
    BulkResearchJobCreateResponse,
    BulkResearchJobDocument,
    CompanyDetail,
    CompanyOpportunitySummary,
    CompanySummary,
)
from app.services.bulk_company_orchestrator import bulk_company_orchestrator
from app.services.company_identity_service import (
    CANONICAL_COMPANIES,
    is_same_company,
    normalize_company as canonical_normalize_company,
)
from app.services.job_service import job_service
from app.utils.contact_identity import normalize_company_key

logger = logging.getLogger("jobFinder.api.companies")

router = APIRouter(prefix="/companies", tags=["Companies & Contacts (Phase 6)"])

# Backward-compatible alias for legacy references
CANONICAL_COMPANY_MAP: dict[str, dict[str, str]] = {
    comp["key"]: {"name": comp["name"], "domain": comp["domain"]}
    for comp in CANONICAL_COMPANIES.values()
}
for comp in CANONICAL_COMPANIES.values():
    for alias in comp.get("aliases", set()):
        CANONICAL_COMPANY_MAP[alias.lower()] = {"name": comp["name"], "domain": comp["domain"]}


def normalize_company(raw_name: str, url: str | None = None) -> tuple[str, str, str]:
    """Normalize raw company name into canonical (key, canonical_name, domain)."""
    return canonical_normalize_company(raw_name, url=url)


@router.get("", response_model=list[CompanySummary], status_code=status.HTTP_200_OK)
async def list_companies(
    search: Optional[str] = Query(None, description="Filter companies by name"),
    query: Optional[str] = Query(None, description="Filter companies by name (alias)"),
    user_id: Optional[str] = Depends(get_optional_authenticated_user_id),
):
    """Retrieve deduplicated list of hiring companies from active opportunities."""
    active_jobs = job_service.list_jobs()

    companies_map: dict[str, dict] = {}

    for job in active_jobs:
        if not job.company:
            continue

        key, name, domain = normalize_company(
            job.company, url=job.sourceRef.originalUrl if job.sourceRef else None
        )

        opp_summary = CompanyOpportunitySummary(
            id=job.id,
            title=job.title,
            location=job.location,
            workMode=job.workMode.value if hasattr(job.workMode, "value") else str(job.workMode),
            category=job.category.value if hasattr(job.category, "value") else str(job.category),
            sourceUrl=job.sourceRef.originalUrl if job.sourceRef and job.sourceRef.originalUrl else "",
            status="recommended",
        )

        if key not in companies_map:
            companies_map[key] = {
                "key": key,
                "name": name,
                "domain": domain,
                "primaryOpportunityId": job.id,
                "opportunities": [opp_summary],
                "opportunityCount": 1,
                "hasIntelligence": False,
                "intelligenceStatus": "NOT_RESEARCHED",
                "contactsCount": 0,
            }
        else:
            companies_map[key]["opportunities"].append(opp_summary)
            companies_map[key]["opportunityCount"] = len(companies_map[key]["opportunities"])

    # If authenticated, batch-enrich user's cached intelligence and contact counts off the event loop
    if user_id:
        def _batch_enrich():
            user_intel_map = company_intelligence_repo.get_all_intelligence_for_user(user_id=user_id)
            user_contact_counts = opportunity_contact_repo.get_contact_counts_by_company_and_opp(user_id=user_id)
            return user_intel_map, user_contact_counts

        user_intel_map, user_contact_counts = await asyncio.to_thread(_batch_enrich)

        for key, entry in companies_map.items():
            primary_opp_id = entry["primaryOpportunityId"]
            comp_name_lower = entry["name"].lower()

            # Check intelligence by primary opportunity ID, or company name, or any opportunity ID
            intel = user_intel_map.get(primary_opp_id) or user_intel_map.get(comp_name_lower)
            if not intel:
                for opp in entry["opportunities"]:
                    if opp.id in user_intel_map:
                        intel = user_intel_map[opp.id]
                        break

            if intel:
                entry["hasIntelligence"] = True
                entry["intelligenceStatus"] = intel.riskTier.value if hasattr(intel.riskTier, "value") else str(intel.riskTier)

            # Check contact count by canonical key, primary opportunity ID, or company name
            count = user_contact_counts.get(key, 0)
            if count == 0 and primary_opp_id in user_contact_counts:
                count = user_contact_counts[primary_opp_id]
            if count == 0:
                norm_ck = normalize_company_key(entry["name"])
                count = user_contact_counts.get(norm_ck, 0)
            entry["contactsCount"] = count

    results = [CompanySummary(**data) for data in companies_map.values()]

    # Sort alphabetically by company name
    results.sort(key=lambda c: c.name.lower())

    # Optional search filter
    active_search = search or query
    if active_search:
        q = active_search.strip().lower()
        results = [c for c in results if q in c.name.lower() or q in c.domain.lower()]

    return results



@router.post(
    "/bulk-research/jobs",
    response_model=BulkResearchJobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Create asynchronous persistent bulk company research job",
)
async def create_bulk_research_job(
    payload: BulkCompanyResearchRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Accepts bulk research request, persists job state to Firestore, and runs in background."""
    if not payload.companyKeys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one company key must be provided.",
        )

    # Deduplicate keys while preserving order
    unique_keys: list[str] = []
    for k in payload.companyKeys:
        clean = k.strip().lower()
        if clean and clean not in unique_keys:
            unique_keys.append(clean)

    if len(unique_keys) > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bulk research is limited to a maximum of 5 companies per batch.",
        )

    # Check for stale jobs and recover them first
    bulk_research_job_repo.recover_stale_jobs(user_id=user_id)

    # Check if an active job is already in progress
    existing_active = bulk_research_job_repo.get_active_job(user_id=user_id)
    if existing_active:
        return BulkResearchJobCreateResponse(
            jobId=existing_active.jobId,
            status=existing_active.status,
            message="An active bulk research job is already in progress. Reconnected to existing job.",
        )

    job_id = f"job_bulk_{uuid.uuid4().hex[:12]}"
    job_doc = BulkResearchJobDocument(
        jobId=job_id,
        userId=user_id,
        companyKeys=unique_keys,
        status="QUEUED",
        progressStage="queued",
        progressPct=0,
        currentStageDescription="Research job queued...",
    )
    bulk_research_job_repo.save_job(job_doc)

    # Trigger background execution
    background_tasks.add_task(
        bulk_company_orchestrator.execute_async_bulk_job,
        job_id=job_id,
        user_id=user_id,
        company_keys=unique_keys,
        force_refresh=payload.forceRefresh,
    )

    return BulkResearchJobCreateResponse(
        jobId=job_id,
        status="QUEUED",
        message="Bulk research job accepted and queued for background execution.",
    )


@router.get(
    "/bulk-research/jobs/active",
    response_model=Optional[BulkResearchJobDocument],
    status_code=status.HTTP_200_OK,
    summary="Get currently active bulk research job for user",
)
async def get_active_bulk_research_job(
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve any running or queued bulk research job for reconnection."""
    bulk_research_job_repo.recover_stale_jobs(user_id=user_id)
    return bulk_research_job_repo.get_active_job(user_id=user_id)


@router.get(
    "/bulk-research/jobs/{job_id}",
    response_model=BulkResearchJobDocument,
    status_code=status.HTTP_200_OK,
    summary="Get status and results of a bulk research job",
)
async def get_bulk_research_job(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve status, progress, or results of a persistent bulk research job."""
    job = bulk_research_job_repo.get_job(user_id=user_id, job_id=job_id)
    if not job or job.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bulk research job '{job_id}' not found.",
        )
    return job


@router.get("/{company_key}", response_model=CompanyDetail, status_code=status.HTTP_200_OK)
async def get_company_detail(
    company_key: str,
    user_id: Optional[str] = Depends(get_optional_authenticated_user_id),
):
    """Retrieve full company profile including intelligence and discovered contacts."""
    active_jobs = job_service.list_jobs()

    target_key, target_name, target_domain = normalize_company(company_key)
    raw_key_lower = company_key.strip().lower()

    matching_jobs = []
    company_name = ""
    company_domain = ""

    for job in active_jobs:
        if not job.company:
            continue
        j_key, j_name, j_domain = normalize_company(
            job.company, url=job.sourceRef.originalUrl if job.sourceRef else None
        )
        if (
            j_key == target_key
            or j_name.lower() == target_name.lower()
            or j_key == raw_key_lower
            or job.company.strip().lower() == raw_key_lower
            or (raw_key_lower and raw_key_lower in (j_key, j_name.lower()))
        ):
            matching_jobs.append(job)
            if not company_name:
                company_name = j_name
                company_domain = j_domain

    if not matching_jobs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company '{company_key}' not found in active opportunities.",
        )

    primary_job = matching_jobs[0]
    opportunities = [
        CompanyOpportunitySummary(
            id=j.id,
            title=j.title,
            location=j.location,
            workMode=j.workMode.value if hasattr(j.workMode, "value") else str(j.workMode),
            category=j.category.value if hasattr(j.category, "value") else str(j.category),
            sourceUrl=j.sourceRef.originalUrl if j.sourceRef and j.sourceRef.originalUrl else "",
            status="recommended",
        )
        for j in matching_jobs
    ]

    intel = None
    contacts = []

    if user_id:
        def _fetch_intel_and_contacts():
            matching_ids = {j.id for j in matching_jobs}
            # Batch fetch intelligence for company
            intel_record = company_intelligence_repo.get_intelligence_for_company(
                user_id=user_id,
                company_name=company_name or target_name,
                opportunity_ids=matching_ids,
            )
            # Batch fetch contacts without 100+ separate Firestore roundtrips
            contacts_list = opportunity_contact_repo.list_contacts_for_company_detail(
                user_id=user_id,
                company_keys=[target_key, raw_key_lower, normalize_company_key(company_name)],
                opportunity_ids=matching_ids,
                company_name=company_name or target_name,
            )
            return intel_record, contacts_list

        intel, contacts = await asyncio.to_thread(_fetch_intel_and_contacts)

    return CompanyDetail(
        key=target_key,
        name=company_name or target_name,
        domain=company_domain or target_domain,
        careersUrl=primary_job.sourceRef.originalUrl if primary_job.sourceRef else None,
        primaryOpportunityId=primary_job.id,
        opportunities=opportunities,
        intelligence=intel,
        contacts=contacts,
    )


@router.post(
    "/bulk-research",
    response_model=BulkCompanyResearchResponse,
    status_code=status.HTTP_200_OK,
    summary="Execute bulk company research and contact discovery for up to 5 companies",
)
async def bulk_research_companies(
    payload: BulkCompanyResearchRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Coordinate corporate evidence harvesting, single-request Gemini batch synthesis, and multi-channel contact discovery."""
    return await bulk_company_orchestrator.orchestrate_bulk_research(
        user_id=user_id,
        company_keys=payload.companyKeys,
        force_refresh=payload.forceRefresh,
    )

