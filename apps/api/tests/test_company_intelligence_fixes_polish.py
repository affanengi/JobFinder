"""Tests for Company Intelligence Polish Fixes:
- Absence of evidence produces INSUFFICIENT_EVIDENCE, zero red flags, and no false PASS results.
- HTMLTextExtractor and direct HTTP fallback work cleanly.
- Corporate overview fields (industry, products, headquarters, size) are supported.
"""

from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from app.schemas.company_intelligence import (
    CompanyIntelligenceResult,
    EvaluatedDimensionItem,
    BatchCompanyScamItem,
    BulkCompanyIntelligenceOutput,
)
from app.services.agent_reach_service import (
    HTMLTextExtractor,
    agent_reach_service,
)
from app.services.company_intelligence_service import (
    CompanyIntelligenceService,
    company_intelligence_service,
)
from app.services.corporate_evidence_harvester import CorporateHarvestResult


def test_html_text_extractor_strips_scripts_and_extracts_clean_text():
    html_sample = """
    <!DOCTYPE html>
    <html>
      <head>
        <title>Canonical | Open Source</title>
        <style>body { font-family: sans-serif; }</style>
        <script>console.log("analytics");</script>
      </head>
      <body>
        <nav><a href="/">Home</a></nav>
        <h1>Canonical: The Company Behind Ubuntu</h1>
        <p>Canonical publishes Ubuntu and delivers enterprise open source security.</p>
        <svg><path d="M0 0h24v24H0z"/></svg>
      </body>
    </html>
    """
    parser = HTMLTextExtractor()
    parser.feed(html_sample)
    extracted = " ".join(parser.texts)

    assert "Canonical: The Company Behind Ubuntu" in extracted
    assert "Canonical publishes Ubuntu" in extracted
    assert "console.log" not in extracted
    assert "sans-serif" not in extracted


def test_deterministic_scam_item_empty_evidence_yields_insufficient_evidence_and_zero_red_flags():
    """Absence of evidence must NOT label the company suspicious or add red flags!"""
    item = company_intelligence_service._create_deterministic_scam_item(
        company_key="canonical",
        company_name="Canonical",
        domain="canonical.com",
        evidence_text="",  # Empty evidence
        reason="evidence content empty",
    )

    assert item.riskTier == "INSUFFICIENT_EVIDENCE"
    assert item.evidenceStatus == "INSUFFICIENT_EVIDENCE"
    assert item.overview is None
    # Crucial: red flags must strictly be empty []
    assert item.redFlags == []
    # All 5 dimensions must report INSUFFICIENT_EVIDENCE (no false PASS results)
    assert item.domainConsistency.status == "INSUFFICIENT_EVIDENCE"
    assert item.paymentSolicitations.status == "INSUFFICIENT_EVIDENCE"
    assert item.communicationChannels.status == "INSUFFICIENT_EVIDENCE"
    assert item.publicScamReports.status == "INSUFFICIENT_EVIDENCE"
    assert item.requisitionConsistency.status == "INSUFFICIENT_EVIDENCE"
    assert "could not be retrieved" in item.summary


def test_deterministic_scam_item_with_evidence_extracts_risk():
    """When credible risk triggers are present in evidence, red flags are preserved."""
    scam_evidence = "Applicants must wire an upfront registration fee of $300 to our crypto payment account."
    item = company_intelligence_service._create_deterministic_scam_item(
        company_key="fraudco",
        company_name="FraudCo",
        domain="fraudco.net",
        evidence_text=scam_evidence,
        reason="deterministic scan",
    )

    assert item.riskTier == "SIGNIFICANT_RED_FLAGS"
    assert item.evidenceStatus == "SUFFICIENT"
    assert len(item.redFlags) > 0
    assert "Payment or fee request patterns" in item.redFlags[0]
    assert item.paymentSolicitations.status == "FAIL"


@pytest.mark.asyncio
async def test_batch_synthesis_enforces_insufficient_evidence_and_cleans_false_red_flags():
    """Verify that batch synthesis cleans hallucinated 'no evidence' red flags and enforces INSUFFICIENT_EVIDENCE."""
    harvested = [
        CorporateHarvestResult(
            company_key="canonical",
            company_name="Canonical",
            official_domain="canonical.com",
            evidence_text="",  # empty
            retrieval_ok=False,
        ),
        CorporateHarvestResult(
            company_key="cloudflare",
            company_name="Cloudflare",
            official_domain="cloudflare.com",
            evidence_text="Cloudflare provides web performance, DDoS security, and serverless compute.",
            retrieval_ok=True,
        ),
    ]

    # Mock provider returning a response where Gemini accidentally put 'No evidence provided' in redFlags
    mock_ai_provider = MagicMock()
    mock_ai_provider.generate_structured = AsyncMock(
        return_value=BulkCompanyIntelligenceOutput(
            companies=[
                BatchCompanyScamItem(
                    companyKey="canonical",
                    companyName="Canonical",
                    officialDomain="canonical.com",
                    riskTier="NEEDS_VERIFICATION",
                    overview="Ubuntu publisher",
                    summary="Manual audit recommended",
                    domainConsistency=EvaluatedDimensionItem(status="PASS", evidence="Domain matches"),
                    paymentSolicitations=EvaluatedDimensionItem(status="PASS", evidence="No payment"),
                    communicationChannels=EvaluatedDimensionItem(status="PASS", evidence="OK"),
                    publicScamReports=EvaluatedDimensionItem(status="PASS", evidence="None"),
                    requisitionConsistency=EvaluatedDimensionItem(status="PASS", evidence="OK"),
                    redFlags=["No evidence content provided"],  # Hallucinated red flag!
                ),
                BatchCompanyScamItem(
                    companyKey="cloudflare",
                    companyName="Cloudflare",
                    officialDomain="cloudflare.com",
                    riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
                    overview="Cloudflare develops global network security and edge computing.",
                    summary="Verified enterprise provider.",
                    domainConsistency=EvaluatedDimensionItem(status="PASS", evidence="Domain matches"),
                    paymentSolicitations=EvaluatedDimensionItem(status="PASS", evidence="No payment"),
                    communicationChannels=EvaluatedDimensionItem(status="PASS", evidence="OK"),
                    publicScamReports=EvaluatedDimensionItem(status="PASS", evidence="None"),
                    requisitionConsistency=EvaluatedDimensionItem(status="PASS", evidence="OK"),
                    redFlags=[],
                    productsAndServices=["Workers", "Zero Trust"],
                    industry="Cloud Infrastructure",
                ),
            ]
        )
    )

    service = CompanyIntelligenceService(ai_provider=cast(Any, mock_ai_provider))
    results, requests_issued = await service.synthesize_bulk_company_intelligence(
        user_id="test-user",
        evidence_list=harvested,
    )

    assert requests_issued == 1
    canon = results["canonical"]
    # Enforced: empty evidence produces INSUFFICIENT_EVIDENCE
    assert canon.riskTier == "INSUFFICIENT_EVIDENCE"
    assert canon.evidenceStatus == "INSUFFICIENT_EVIDENCE"
    assert canon.overview is None
    # False red flag was stripped!
    assert canon.redFlags == []
    assert canon.domainConsistency.status == "INSUFFICIENT_EVIDENCE"
    assert canon.paymentSolicitations.status == "INSUFFICIENT_EVIDENCE"

    cflare = results["cloudflare"]
    assert cflare.riskTier == "NO_OBVIOUS_RED_FLAGS_FOUND"
    assert cflare.overview == "Cloudflare develops global network security and edge computing."
    assert cflare.industry == "Cloud Infrastructure"
    assert "Workers" in cflare.productsAndServices
