"""Bulk Company Orchestrator coordinating corporate evidence harvesting, Gemini batch synthesis, and multi-channel contact discovery.

Strict Requirements:
- CostPolicy.FREE_ONLY ($0 Spend).
- Exactly 1 Gemini generation request for uncached batch on the successful path.
- 0 Gemini generation requests when all companies are cached.
- Maximum 45s backend deadline with bounded sub-timeouts.
- Process-local in-memory idempotency guard against double-clicks.
- Strict tenant isolation in Firestore.
"""

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status

from app.db.repositories.ai_telemetry_repo import AITelemetryRepository
from app.db.repositories.company_intelligence_repo import company_intelligence_repo
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.schemas.company import (
    BulkCompanyExecutionMetrics,
    BulkCompanyResearchItemResult,
    BulkCompanyResearchResponse,
    BulkResearchJobDocument,
)
from app.schemas.company_intelligence import (
    BatchCompanyScamItem,
    CompanyIntelligenceResult,
)
from app.schemas.opportunity_contact import DiscoveredContact
from app.services.company_intelligence_service import (
    CACHE_TTL_DAYS,
    company_intelligence_service,
)
from app.services.contact_discovery_service import contact_discovery_service
from app.services.company_identity_service import normalize_company
from app.services.corporate_evidence_harvester import (
    CorporateHarvestResult,
    corporate_evidence_harvester,
    resolve_canonical_domain,
)
from app.services.job_service import job_service

logger = logging.getLogger("jobFinder.services.bulk_company_orchestrator")

telemetry_repo = AITelemetryRepository()


class BulkCompanyOrchestrator:
    """Orchestrates bulk research across up to 5 companies."""

    def __init__(self):
        self._active_user_locks: set[str] = set()
        self._lock = asyncio.Lock()
        self.evidence_harvester = corporate_evidence_harvester
        self.intelligence_service = company_intelligence_service
        self.contact_service = contact_discovery_service
        self.intel_repo = company_intelligence_repo
        self.contact_repo = opportunity_contact_repo

    async def _acquire_user_lock(self, user_id: str) -> None:
        """Acquire process-local concurrency lock to prevent duplicate runs for the same user."""
        async with self._lock:
            if user_id in self._active_user_locks:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Bulk research is already in progress for this user. Please wait for completion.",
                )
            self._active_user_locks.add(user_id)

    async def _release_user_lock(self, user_id: str) -> None:
        """Release process-local concurrency lock."""
        async with self._lock:
            self._active_user_locks.discard(user_id)

    def _resolve_company_meta(self, company_key: str) -> tuple[str, str, str, str | None, str | None]:
        """Resolve (key, display_name, canonical_domain, primary_opp_id, careers_url)."""
        clean_key, canon_name, canon_domain = normalize_company(company_key)
        active_jobs = job_service.list_jobs()

        matching_jobs = []
        for job in active_jobs:
            if not job.company:
                continue
            j_key, j_name, j_domain = normalize_company(
                job.company, url=job.sourceRef.originalUrl if job.sourceRef else None
            )
            if j_key == clean_key or j_name.lower() == canon_name.lower():
                matching_jobs.append(job)

        if matching_jobs:
            primary_job = matching_jobs[0]
            display_name = canon_name
            careers_url = primary_job.sourceRef.originalUrl if primary_job.sourceRef else None
            domain = canon_domain or resolve_canonical_domain(
                company_name=display_name,
                job_url=careers_url,
            )
            return clean_key, display_name, domain, primary_job.id, careers_url

        # Fallback for companies without active saved jobs
        display_name = canon_name
        domain = canon_domain or resolve_canonical_domain(company_name=display_name)
        primary_opp_id = f"virtual-opp-{clean_key}"
        return clean_key, display_name, domain, primary_opp_id, None

    async def orchestrate_bulk_research(
        self,
        user_id: str,
        company_keys: list[str],
        force_refresh: bool = False,
    ) -> BulkCompanyResearchResponse:
        """Execute coordinated bulk research on 1 to 5 companies with single-request Gemini batching."""
        if not company_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one company key must be provided.",
            )

        # Deduplicate keys while preserving order
        unique_keys: list[str] = []
        for k in company_keys:
            clean = k.strip().lower()
            if clean and clean not in unique_keys:
                unique_keys.append(clean)

        if len(unique_keys) > 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bulk research is limited to a maximum of 5 companies per batch.",
            )

        await self._acquire_user_lock(user_id)
        start_time = time.monotonic()
        operation_id = f"bulk_{uuid.uuid4().hex[:12]}"

        try:
            # Enforce 45s backend timeout ceiling
            return await asyncio.wait_for(
                self._execute_bulk_workflow(
                    user_id=user_id,
                    unique_keys=unique_keys,
                    force_refresh=force_refresh,
                    operation_id=operation_id,
                    start_time=start_time,
                ),
                timeout=45.0,
            )
        except asyncio.TimeoutError:
            duration = time.monotonic() - start_time
            logger.error(f"Bulk research operation {operation_id} timed out after {duration:.2f}s")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Bulk company research timed out after 45 seconds. Partial results may have been saved.",
            )
        finally:
            await self._release_user_lock(user_id)

    async def _execute_bulk_workflow(
        self,
        user_id: str,
        unique_keys: list[str],
        force_refresh: bool,
        operation_id: str,
        start_time: float,
    ) -> BulkCompanyResearchResponse:
        """Internal workflow executing cache checks, parallel harvesting, and batch synthesis."""
        now = datetime.now(UTC)
        ttl = now + timedelta(days=CACHE_TTL_DAYS)

        # 1. Inspect cache for all requested companies
        cached_results: dict[str, BulkCompanyResearchItemResult] = {}
        uncached_meta: list[dict] = []

        for key in unique_keys:
            k, name, domain, opp_id, careers_url = self._resolve_company_meta(key)
            if not force_refresh:
                cached_intel = self.intel_repo.get_intelligence(user_id=user_id, opportunity_id=opp_id)
                if cached_intel:
                    try:
                        exp = datetime.fromisoformat(cached_intel.ttlExpiresAt)
                        if exp > now:
                            # Load contacts
                            contacts = self.contact_repo.list_contacts_for_opportunity(
                                user_id=user_id, opportunity_id=opp_id
                            )
                            cached_results[k] = BulkCompanyResearchItemResult(
                                companyKey=k,
                                companyName=name,
                                status="SUCCESS",
                                intelligence=cached_intel,
                                contacts=contacts,
                            )
                            continue
                    except Exception:
                        pass

            uncached_meta.append({
                "key": k,
                "name": name,
                "domain": domain,
                "opp_id": opp_id,
                "careers_url": careers_url,
            })

        gemini_requests_issued = 0
        live_harvested_count = len(uncached_meta)
        uncached_results: dict[str, BulkCompanyResearchItemResult] = {}

        if uncached_meta:
            # 2. Parallel Evidence Harvesting and Contact Discovery via Semaphore
            sem = asyncio.Semaphore(3)

            async def _harvest_single_company(meta: dict) -> tuple[CorporateHarvestResult, list[DiscoveredContact]]:
                async with sem:
                    # Parallel subtasks for the company: (A) corporate page read, (B) dual-query contact search
                    harvest_task = self.evidence_harvester.harvest_company_evidence(
                        company_key=meta["key"],
                        company_name=meta["name"],
                        given_domain=meta["domain"],
                        job_url=meta["careers_url"],
                    )
                    discovery_task = self.contact_service.discover_contacts(
                        user_id=user_id,
                        opportunity_id=meta["opp_id"],
                        force_refresh=force_refresh,
                    )
                    evidence_res, discovery_res = await asyncio.gather(
                        harvest_task,
                        discovery_task,
                        return_exceptions=True,
                    )

                    evidence = (
                        evidence_res
                        if isinstance(evidence_res, CorporateHarvestResult)
                        else CorporateHarvestResult(
                            company_key=meta["key"],
                            company_name=meta["name"],
                            official_domain=meta["domain"],
                            retrieval_ok=False,
                            error=str(evidence_res),
                        )
                    )

                    contacts = (
                        discovery_res.contacts
                        if hasattr(discovery_res, "contacts")
                        else []
                    )
                    return evidence, contacts

            tasks = [_harvest_single_company(m) for m in uncached_meta]
            gathered = await asyncio.gather(*tasks, return_exceptions=True)

            harvested_evidence_list: list[CorporateHarvestResult] = []
            contacts_by_key: dict[str, list[DiscoveredContact]] = {}

            for i, res in enumerate(gathered):
                meta = uncached_meta[i]
                k = meta["key"]
                if isinstance(res, Exception):
                    logger.error(f"Error harvesting company {k}: {res}")
                    harvested_evidence_list.append(
                        CorporateHarvestResult(
                            company_key=k,
                            company_name=meta["name"],
                            official_domain=meta["domain"],
                            retrieval_ok=False,
                            error=str(res),
                        )
                    )
                    contacts_by_key[k] = []
                else:
                    ev, contacts = res
                    harvested_evidence_list.append(ev)
                    contacts_by_key[k] = contacts

            # 3. Single-Request Gemini Batch Synthesis for all uncached companies
            ai_evaluations, requests_issued = await self.intelligence_service.synthesize_bulk_company_intelligence(
                user_id=user_id,
                evidence_list=harvested_evidence_list,
                operation_id=operation_id,
            )
            gemini_requests_issued = requests_issued

            # 4. Normalize and Persist each uncached company
            for meta in uncached_meta:
                k = meta["key"]
                opp_id = meta["opp_id"]
                company_name = meta["name"]
                domain = meta["domain"]
                careers_url = meta["careers_url"] or f"https://{domain}"

                eval_item: Optional[BatchCompanyScamItem] = ai_evaluations.get(k)
                if not eval_item:
                    eval_item = self.intelligence_service._create_deterministic_scam_item(
                        company_key=k,
                        company_name=company_name,
                        domain=domain,
                        evidence_text="",
                        reason="batch evaluation omitted from model output",
                    )

                dimensions = {
                    "domainConsistency": eval_item.domainConsistency,
                    "paymentSolicitations": eval_item.paymentSolicitations,
                    "communicationChannels": eval_item.communicationChannels,
                    "publicScamReports": eval_item.publicScamReports,
                    "requisitionConsistency": eval_item.requisitionConsistency,
                }

                intel_record = CompanyIntelligenceResult(
                    id=f"comp-intel-{opp_id}",
                    userId=user_id,
                    opportunityId=opp_id,
                    companyName=company_name,
                    officialDomain=eval_item.officialDomain or domain,
                    careersUrl=careers_url,
                    riskTier=eval_item.riskTier,
                    overview=eval_item.overview,
                    summary=eval_item.summary,
                    evaluatedDimensions=dimensions,
                    redFlags=eval_item.redFlags,
                    positiveSignals=eval_item.positiveSignals,
                    sourceUrls=[careers_url],
                    researchedAt=now.isoformat(),
                    ttlExpiresAt=ttl.isoformat(),
                    rawContentSnippet=None,
                    productsAndServices=getattr(eval_item, "productsAndServices", []),
                    industry=getattr(eval_item, "industry", None),
                    companySize=getattr(eval_item, "companySize", None),
                    headquarters=getattr(eval_item, "headquarters", None),
                    evidenceStatus=getattr(eval_item, "evidenceStatus", "SUFFICIENT"),
                )

                # Persist to Firestore
                self.intel_repo.save_intelligence(intel_record)
                company_contacts = contacts_by_key.get(k, [])

                uncached_results[k] = BulkCompanyResearchItemResult(
                    companyKey=k,
                    companyName=company_name,
                    status="SUCCESS",
                    intelligence=intel_record,
                    contacts=company_contacts,
                )

        # 5. Assemble final ordered results and aggregate metrics
        final_results: list[BulkCompanyResearchItemResult] = []
        total_contacts = 0
        direct_email_contacts = 0
        profile_only_contacts = 0

        for key in unique_keys:
            if key in cached_results:
                item = cached_results[key]
            elif key in uncached_results:
                item = uncached_results[key]
            else:
                item = BulkCompanyResearchItemResult(
                    companyKey=key,
                    companyName=key.capitalize(),
                    status="ERROR",
                    error="Research could not be completed for company.",
                )

            final_results.append(item)
            for c in item.contacts:
                total_contacts += 1
                if c.email and c.email.strip():
                    direct_email_contacts += 1
                elif c.contactabilityStatus == "PROFILE_ONLY" or c.linkedinUrl or c.githubUrl:
                    profile_only_contacts += 1

        duration_seconds = round(time.monotonic() - start_time, 2)
        cached_count = len(cached_results)

        # Determine batch status
        errors_count = sum(1 for r in final_results if r.status == "ERROR")
        if errors_count == 0:
            batch_status = "COMPLETED"
        elif errors_count == len(final_results):
            batch_status = "FAILED"
        else:
            batch_status = "PARTIAL_FAILURE"

        metrics = BulkCompanyExecutionMetrics(
            totalRequested=len(unique_keys),
            cachedCount=cached_count,
            liveHarvestedCount=live_harvested_count,
            geminiRequestsIssued=gemini_requests_issued,
            totalContactsDiscovered=total_contacts,
            contactsWithDirectEmail=direct_email_contacts,
            contactsWithProfileOnly=profile_only_contacts,
            durationSeconds=duration_seconds,
        )

        # 6. Record execution telemetry safely
        try:
            telemetry_repo.record_execution(
                user_id=user_id,
                record={
                    "executionId": operation_id,
                    "task": "company_intelligence",
                    "operationType": "BULK_COMPANY_RESEARCH",
                    "model": "gemini-3.5-flash-lite",
                    "provider": "gemini",
                    "totalRequested": len(unique_keys),
                    "cachedCount": cached_count,
                    "liveHarvestedCount": live_harvested_count,
                    "geminiRequestsIssued": gemini_requests_issued,
                    "totalContactsDiscovered": total_contacts,
                    "durationSeconds": duration_seconds,
                    "status": batch_status,
                    "createdAt": now.isoformat(),
                },
            )
        except Exception as e:
            logger.debug(f"Telemetry logging error (ignored): {e}")

        return BulkCompanyResearchResponse(
            operationId=operation_id,
            status=batch_status,
            metrics=metrics,
            results=final_results,
        )

    async def execute_async_bulk_job(
        self,
        job_id: str,
        user_id: str,
        company_keys: list[str],
        force_refresh: bool = False,
        worker_id: str | None = None,
    ) -> BulkResearchJobDocument:
        """Execute persistent background bulk research job updating Firestore state with lease claiming."""
        from app.db.repositories.bulk_research_job_repo import bulk_research_job_repo

        worker_id = worker_id or f"worker_{uuid.uuid4().hex[:8]}"

        # 1. Claim lease atomically
        if not bulk_research_job_repo.claim_job_lease(
            user_id=user_id,
            job_id=job_id,
            worker_id=worker_id,
            lease_duration_seconds=180,
        ):
            logger.warning(
                f"Job {job_id} already has an active lease by another worker. Refusing concurrent execution."
            )
            existing_job = bulk_research_job_repo.get_job(user_id=user_id, job_id=job_id)
            if existing_job:
                return existing_job
            raise HTTPException(status_code=409, detail="Concurrent job execution refused.")

        job = bulk_research_job_repo.get_job(user_id=user_id, job_id=job_id)
        if not job:
            job = BulkResearchJobDocument(
                jobId=job_id,
                userId=user_id,
                companyKeys=company_keys,
                status="QUEUED",
                progressStage="queued",
                progressPct=0,
                currentStageDescription="Research job queued...",
                workerId=worker_id,
            )
            bulk_research_job_repo.save_job(job)

        start_time = time.monotonic()
        try:
            # Stage 1: Harvesting
            job.status = "HARVESTING"
            job.progressStage = "harvesting"
            job.progressPct = 25
            job.currentStageDescription = f"Harvesting evidence and discovering contacts across {len(company_keys)} companies..."
            bulk_research_job_repo.save_job(job)

            # Deduplicate keys while preserving order
            unique_keys: list[str] = []
            for k in company_keys:
                clean = k.strip().lower()
                if clean and clean not in unique_keys:
                    unique_keys.append(clean)

            # Stage 2: Synthesis
            job.status = "SYNTHESIZING"
            job.progressStage = "synthesizing"
            job.progressPct = 60
            job.currentStageDescription = "Synthesizing company profiles with Gemini AI..."
            bulk_research_job_repo.save_job(job)

            # Execute bulk workflow (runs harvesting, synthesis, persistence)
            response = await self._execute_bulk_workflow(
                user_id=user_id,
                unique_keys=unique_keys,
                force_refresh=force_refresh,
                operation_id=job_id,
                start_time=start_time,
            )

            # Stage 3: Saving / Finalizing
            job.status = "SAVING"
            job.progressStage = "saving"
            job.progressPct = 90
            job.currentStageDescription = "Finalizing research records and contacts..."
            bulk_research_job_repo.save_job(job)

            # Stage 4: Completed
            now_iso = datetime.now(UTC).isoformat()
            job.status = "COMPLETED"
            job.progressStage = "complete"
            job.progressPct = 100
            job.currentStageDescription = f"Completed research for {len(unique_keys)} companies."
            job.results = response.results
            job.metrics = response.metrics
            job.responsePayload = response
            job.completedAt = now_iso
            job.errorMessage = None
            bulk_research_job_repo.save_job(job)
            return job

        except Exception as e:
            logger.error(f"Error executing async bulk job {job_id} for user={user_id}: {e}", exc_info=True)
            job.status = "FAILED"
            job.progressStage = "error"
            job.errorMessage = str(e)
            job.completedAt = datetime.now(UTC).isoformat()
            bulk_research_job_repo.save_job(job)
            return job

        finally:
            bulk_research_job_repo.release_job_lease(
                user_id=user_id,
                job_id=job_id,
                worker_id=worker_id,
            )


bulk_company_orchestrator = BulkCompanyOrchestrator()
