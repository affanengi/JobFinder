"""Safe Duplicate Cleanup Migration Script for Opportunity Discovered Contacts.

Strict Safeguards:
1. Dry-run is the mandatory default mode.
2. Both `--execute` AND `--confirm` must be explicitly provided to execute database mutations.
3. Preserves contact IDs, outreach history, review status, drafts, and notes.
4. Never auto-merges ambiguous identities or conflicting strong signals.
5. Produces a comprehensive reconciliation report.
"""

import argparse
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Optional

from app.db.firebase import get_firestore_client
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.schemas.opportunity_contact import DiscoveredContact
from app.utils.contact_identity import (
    categorize_role_title,
    check_signal_divergence,
    extract_linkedin_vanity_slug,
    generate_candidate_identity_keys,
    normalize_company_key,
    normalize_email_address,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("deduplicate_existing_contacts")


def run_deduplication(
    target_user_id: Optional[str] = None,
    execute: bool = False,
    confirm: bool = False,
) -> dict:
    """Run duplicate contact reconciliation in dry-run or confirmed execute mode."""
    # Safety Check: Require both flags for execution
    if execute and not confirm:
        logger.error(
            "CRITICAL SAFETY VIOLATION: Execution mode requested without confirmation flag! "
            "You must provide BOTH --execute and --confirm to commit changes to Firestore. "
            "Aborting without modifying data."
        )
        sys.exit(1)

    is_dry_run = not (execute and confirm)
    mode_str = "DRY RUN (Read Only)" if is_dry_run else "LIVE EXECUTION (Committing to Firestore)"
    logger.info(f"Starting contact deduplication migration. Mode: {mode_str}")

    client = get_firestore_client()
    if not client:
        logger.error("Firestore client unavailable.")
        sys.exit(1)

    # 1. Collect target users
    if target_user_id:
        user_ids = [target_user_id]
    else:
        user_docs = client.collection("users").stream()
        user_ids = [doc.id for doc in user_docs]

    logger.info(f"Inspecting contacts for {len(user_ids)} user(s).")

    report = {
        "executionMode": mode_str,
        "isDryRun": is_dry_run,
        "usersInspected": len(user_ids),
        "totalContactsEvaluated": 0,
        "activeContacts": 0,
        "duplicatesIdentified": 0,
        "mergedClusters": 0,
        "ambiguousKeptDistinct": 0,
        "details": [],
    }

    for uid in user_ids:
        # Fetch all contacts for user
        contacts_stream = client.collection("users").document(uid).collection("opportunity_contacts").stream()
        user_contacts: list[DiscoveredContact] = []
        for cdoc in contacts_stream:
            data = cdoc.to_dict()
            if data:
                try:
                    c = DiscoveredContact.model_validate(data)
                    user_contacts.append(c)
                except Exception as e:
                    logger.warning(f"Failed to validate contact {cdoc.id} for user {uid}: {e}")

        report["totalContactsEvaluated"] += len(user_contacts)
        active_contacts = [c for c in user_contacts if not c.isDeleted]
        report["activeContacts"] += len(active_contacts)

        # Group by companyKey
        by_company: dict[str, list[DiscoveredContact]] = {}
        for c in active_contacts:
            comp_key = c.companyKey or normalize_company_key(c.companyName)
            by_company.setdefault(comp_key, []).append(c)

        # Analyze each company
        for comp_key, c_list in by_company.items():
            if len(c_list) < 2:
                continue

            # Identify duplicate clusters
            clusters: list[list[DiscoveredContact]] = []
            visited = set()

            for i in range(len(c_list)):
                if c_list[i].id in visited:
                    continue

                cluster = [c_list[i]]
                visited.add(c_list[i].id)

                for j in range(i + 1, len(c_list)):
                    if c_list[j].id in visited:
                        continue

                    c1 = c_list[i]
                    c2 = c_list[j]

                    # Check strong identity match
                    c1_strong = {k for k in (c1.identityKeys or []) if k.startswith(("li:", "em:"))}
                    c2_strong = {k for k in (c2.identityKeys or []) if k.startswith(("li:", "em:"))}

                    is_same_person = False
                    is_ambiguous = False

                    if c1_strong and c2_strong and (c1_strong & c2_strong):
                        # Strong signal match: check for conflicting signals
                        if not check_signal_divergence(c1.identityKeys or [], c2.identityKeys or []):
                            is_same_person = True

                    # Weak fallback match (exact name match)
                    norm1 = re.sub(r"\s+", " ", c1.fullName.strip().lower())
                    norm2 = re.sub(r"\s+", " ", c2.fullName.strip().lower())
                    if not is_same_person and norm1 == norm2:
                        if check_signal_divergence(c1.identityKeys or [], c2.identityKeys or []):
                            # Diverging signals -> definitely distinct individuals
                            report["ambiguousKeptDistinct"] += 1
                        else:
                            cat1 = categorize_role_title(c1.roleTitle)
                            cat2 = categorize_role_title(c2.roleTitle)
                            if cat1 != cat2 and cat1 != "other" and cat2 != "other":
                                # Different functional disciplines -> distinct
                                report["ambiguousKeptDistinct"] += 1
                            else:
                                # Weak match without strong verification -> ambiguous!
                                # In accordance with Version 3.0: NEVER auto-merge weak matches
                                is_ambiguous = True
                                report["ambiguousKeptDistinct"] += 1

                    if is_same_person and not is_ambiguous:
                        cluster.append(c2)
                        visited.add(c2.id)

                if len(cluster) > 1:
                    clusters.append(cluster)

            # Process clusters
            for cluster in clusters:
                report["mergedClusters"] += 1
                report["duplicatesIdentified"] += len(cluster) - 1

                # Select primary record: prioritize one with existing outreach history/review or earliest discovery
                primary = sorted(
                    cluster,
                    key=lambda c: (
                        bool(c.isReviewed),
                        bool(c.email),
                        bool(c.linkedinUrl),
                        c.rankingScore,
                    ),
                    reverse=True,
                )[0]

                secondaries = [c for c in cluster if c.id != primary.id]

                cluster_detail = {
                    "userId": uid,
                    "companyKey": comp_key,
                    "primaryContactId": primary.id,
                    "primaryContactName": primary.fullName,
                    "secondaryContactIds": [s.id for s in secondaries],
                }
                report["details"].append(cluster_detail)

                logger.info(
                    f"Cluster detected: Primary {primary.id} ({primary.fullName}) merges {len(secondaries)} secondary record(s): {[s.id for s in secondaries]}"
                )

                if not is_dry_run:
                    # Execute merge in Firestore
                    all_opp_ids = set(primary.associatedOpportunityIds or [primary.opportunityId])
                    all_ident_keys = set(primary.identityKeys or [])
                    all_sources = list(primary.sourceUrls or [])
                    all_snippets = list(primary.evidenceSnippets or [])

                    for sec in secondaries:
                        all_opp_ids.update(sec.associatedOpportunityIds or [sec.opportunityId])
                        all_ident_keys.update(sec.identityKeys or [])
                        for u in sec.sourceUrls or []:
                            if u not in all_sources:
                                all_sources.append(u)
                        for s in sec.evidenceSnippets or []:
                            if s not in all_snippets:
                                all_snippets.append(s)

                        # Enrich primary missing fields
                        if not primary.email and sec.email:
                            primary.email = sec.email
                            primary.emailClassification = sec.emailClassification
                            primary.mxStatus = sec.mxStatus
                        if not primary.linkedinUrl and sec.linkedinUrl:
                            primary.linkedinUrl = sec.linkedinUrl
                        if not primary.githubUrl and sec.githubUrl:
                            primary.githubUrl = sec.githubUrl
                        if not primary.portfolioUrl and sec.portfolioUrl:
                            primary.portfolioUrl = sec.portfolioUrl

                        # Soft-delete secondary record as duplicate
                        sec.isDeleted = True
                        sec.deletedAt = datetime.now(UTC).isoformat()
                        sec.deletedByReason = "DEDUPLICATION_MERGE"
                        sec.archivedAsDuplicateOf = primary.id
                        opportunity_contact_repo.save_contact(sec)

                    primary.associatedOpportunityIds = sorted(list(all_opp_ids))
                    primary.identityKeys = sorted(list(all_ident_keys))
                    primary.sourceUrls = all_sources
                    primary.evidenceSnippets = all_snippets
                    primary.lastCheckedAt = datetime.now(UTC).isoformat()
                    opportunity_contact_repo.save_contact(primary)

    # Print reconciliation report
    print("\n" + "=" * 60)
    print("      CONTACT DEDUPLICATION RECONCILIATION REPORT")
    print("=" * 60)
    print(f"Execution Mode:             {report['executionMode']}")
    print(f"Users Inspected:            {report['usersInspected']}")
    print(f"Total Contacts Evaluated:   {report['totalContactsEvaluated']}")
    print(f"Active Contacts:            {report['activeContacts']}")
    print(f"Merged Clusters Identified: {report['mergedClusters']}")
    print(f"Duplicate Records:          {report['duplicatesIdentified']}")
    print(f"Ambiguous Kept Distinct:    {report['ambiguousKeptDistinct']}")
    print("=" * 60 + "\n")

    return report


def main():
    parser = argparse.ArgumentParser(
        description="Safe deduplication migration script for JobFinder discovered contacts."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Run migration in read-only analysis mode (default).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        default=False,
        help="Flag to enable database write mutations (requires --confirm).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        default=False,
        help="Mandatory confirmation token required to execute writes.",
    )
    parser.add_argument(
        "--user-id",
        type=str,
        default=None,
        help="Target single user ID for scoped reconciliation.",
    )

    args = parser.parse_args()

    run_deduplication(
        target_user_id=args.user_id,
        execute=args.execute,
        confirm=args.confirm,
    )


if __name__ == "__main__":
    main()
