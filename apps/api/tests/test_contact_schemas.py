"""Unit tests for Contact Data Foundation, Schema Serialization, and Legacy Backward Compatibility.

Phase 1 Verification:
1. TC-01: Deserialization of legacy Firestore contact records lacking new fields.
2. Serialization and round-trip validation with new fields (linkedinUrl, contactType, etc.).
3. Honest derivation of contactabilityStatus and channelPurpose for legacy documents.
4. Retention of explicit values for modern schema payloads.
"""

import json
from app.schemas.opportunity_contact import (
    ChannelPurpose,
    ContactType,
    ContactabilityStatus,
    DiscoveredContact,
    RoleEvidenceStatus,
)


def test_legacy_contact_deserialization_profile_only():
    """Verify legacy Firestore contact with LinkedIn URL and no email deserializes cleanly."""
    legacy_record = {
        "userId": "test-user-123",
        "id": "contact-uuid-1",
        "opportunityId": "job-canonical-01",
        "companyName": "Canonical",
        "fullName": "Scott McCamish",
        "roleTitle": "Recruitment Partner",
        "email": None,
        "emailClassification": "UNVERIFIED",
        "emailEvidenceSummary": "No public email address discovered for this contact.",
        "confidenceScore": 0.5,
        "rankingScore": 50,
        "rankingReason": "Stakeholder tier: Other (+50)",
        "sourceUrls": [
            "https://linkedin.com/in/scottmccamish"
        ],
        "evidenceSnippets": [
            "# Scott McCamish\nTalent Acquisition Specialist"
        ],
        "searchProviderUsed": "agent_reach",
        "discoveredAt": "2026-10-28T08:12:19.248596+00:00",
    }

    contact = DiscoveredContact.model_validate(legacy_record)

    # Core legacy fields preserved
    assert contact.id == "contact-uuid-1"
    assert contact.fullName == "Scott McCamish"
    assert contact.email is None

    # Phase 1 additions automatically populated with honest values
    assert contact.contactType == "INDIVIDUAL"
    assert contact.channelPurpose == "INDIVIDUAL_REPRESENTATIVE"
    assert contact.linkedinUrl == "https://linkedin.com/in/scottmccamish"
    assert contact.githubUrl is None
    assert contact.portfolioUrl is None
    assert contact.contactabilityStatus == "PROFILE_ONLY"
    assert contact.roleEvidenceStatus == "LIKELY_CURRENT"


def test_legacy_contact_deserialization_generic_inbox():
    """Verify legacy Firestore contact with hr@ mailbox gets classified as ORGANIZATION_CHANNEL."""
    legacy_record = {
        "userId": "test-user-123",
        "id": "contact-uuid-2",
        "opportunityId": "job-cloudflare-01",
        "companyName": "Cloudflare",
        "fullName": "Cloudflare Talent Team",
        "roleTitle": "Hiring Coordinator",
        "email": "hr@cloudflare.com",
        "emailClassification": "PUBLICLY_LISTED",
        "emailEvidenceSummary": "Explicitly listed on official public careers page.",
        "confidenceScore": 0.85,
        "rankingScore": 90,
        "rankingReason": "Stakeholder tier: Other (+50) • Publicly listed contact email (+40)",
        "sourceUrls": [
            "https://boards.greenhouse.io/cloudflare/jobs/7504487"
        ],
        "evidenceSnippets": [
            "Attributable public email discovered on official careers page: hr@cloudflare.com"
        ],
        "searchProviderUsed": "company_page",
        "discoveredAt": "2026-10-28T13:33:54.360027+00:00",
    }

    contact = DiscoveredContact.model_validate(legacy_record)

    assert contact.email == "hr@cloudflare.com"
    assert contact.contactType == "ORGANIZATION_CHANNEL"
    assert contact.channelPurpose == "HR_SHARED_INBOX"
    assert contact.contactabilityStatus == "GENERIC_INBOX_FOUND"
    assert contact.roleEvidenceStatus == "LIKELY_CURRENT"


def test_legacy_contact_with_insufficient_evidence():
    """Verify legacy contact with no email and no profile URLs gets classified as INSUFFICIENT_EVIDENCE."""
    legacy_record = {
        "userId": "test-user-123",
        "id": "contact-uuid-3",
        "opportunityId": "job-unknown-01",
        "companyName": "Unknown Corp",
        "fullName": "Jane Doe",
        "roleTitle": "Employee",
        "email": None,
        "sourceUrls": ["https://unknowncorp.com"],
    }

    contact = DiscoveredContact.model_validate(legacy_record)

    assert contact.contactabilityStatus == "INSUFFICIENT_EVIDENCE"
    assert contact.linkedinUrl is None


def test_modern_contact_explicit_fields_roundtrip():
    """Verify modern contact schema payload with explicit Phase 1 fields serializes and deserializes accurately."""
    modern_payload = {
        "id": "contact-modern-99",
        "userId": "user-456",
        "opportunityId": "opp-789",
        "companyName": "Canonical",
        "fullName": "Camille Rodriguez",
        "roleTitle": "Director, Field Engineering Americas",
        "stakeholderTier": "TECH_LEAD",
        "contactType": "INDIVIDUAL",
        "channelPurpose": "INDIVIDUAL_REPRESENTATIVE",
        "email": "camille@canonical.com",
        "emailClassification": "PROVIDER_VERIFIED",
        "emailEvidenceSummary": "Verified via public SPF/MX record matching.",
        "mxStatus": "VALID_MX",
        "linkedinUrl": "https://linkedin.com/in/rcamille",
        "githubUrl": "https://github.com/rcamille",
        "portfolioUrl": "https://camille.dev",
        "contactabilityStatus": "MULTIPLE_PUBLIC_CHANNELS_FOUND",
        "roleEvidenceStatus": "CURRENT_CONFIRMED",
        "sourceUrls": ["https://linkedin.com/in/rcamille", "https://github.com/rcamille"],
        "confidenceScore": 0.95,
        "rankingScore": 500,
        "rankingReason": "Tech lead with verified email and github (+500)",
        "isDismissed": False,
        "isReviewed": True,
        "doNotContact": False,
    }

    contact = DiscoveredContact.model_validate(modern_payload)

    assert contact.contactType == "INDIVIDUAL"
    assert contact.channelPurpose == "INDIVIDUAL_REPRESENTATIVE"
    assert contact.linkedinUrl == "https://linkedin.com/in/rcamille"
    assert contact.githubUrl == "https://github.com/rcamille"
    assert contact.portfolioUrl == "https://camille.dev"
    assert contact.contactabilityStatus == "MULTIPLE_PUBLIC_CHANNELS_FOUND"
    assert contact.roleEvidenceStatus == "CURRENT_CONFIRMED"

    # Verify serialization roundtrip
    dumped = contact.model_dump()
    assert dumped["linkedinUrl"] == "https://linkedin.com/in/rcamille"
    assert dumped["githubUrl"] == "https://github.com/rcamille"
    assert dumped["contactabilityStatus"] == "MULTIPLE_PUBLIC_CHANNELS_FOUND"
    assert dumped["roleEvidenceStatus"] == "CURRENT_CONFIRMED"

    # Verify JSON compatibility
    json_str = json.dumps(dumped)
    assert "MULTIPLE_PUBLIC_CHANNELS_FOUND" in json_str
