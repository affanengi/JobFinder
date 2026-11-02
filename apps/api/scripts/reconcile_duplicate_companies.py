#!/usr/bin/env python3
"""JobFinder — Non-Destructive Company Reconciliation & Deduplication Script.

Identifies existing Firestore records representing the same company across:
- `jobs` (canonical job catalog)
- `applications` (user application pipeline)
- `tailored_resumes` (user tailored resumes)
- `opportunity_contacts` (discovered user contacts)
- `company_intelligence` (Scam Shield research records)

SAFETY PROTOCOL:
- Runs in DRY-RUN mode by default (`--dry-run`).
- Modifies zero live Firestore documents unless explicitly invoked with `--apply`.
- Generates a full audit reconciliation report.
"""

import argparse
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from app.db.firebase import get_firestore_client
from app.services.company_identity_service import is_same_company, normalize_company

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("reconcile_companies")


def analyze_and_reconcile(apply_changes: bool = False) -> dict[str, Any]:
    client = get_firestore_client()
    if not client:
        raise RuntimeError("Cloud Firestore client could not be initialized. Check serviceAccountKey.json.")

    logger.info("Scanning Firestore for duplicate company clusters...")

    # 1. Inspect Jobs
    jobs_ref = client.collection("jobs")
    all_jobs = list(jobs_ref.stream())
    logger.info(f"Loaded {len(all_jobs)} jobs from Firestore.")

    jobs_to_update = []
    company_clusters: dict[str, dict[str, Any]] = {}

    for doc in all_jobs:
        data = doc.to_dict() or {}
        raw_company = data.get("company", "")
        if not raw_company:
            continue

        source_url = None
        source_ref = data.get("sourceRef")
        if isinstance(source_ref, dict):
            source_url = source_ref.get("originalUrl")

        canon_key, canon_name, canon_domain = normalize_company(raw_company, url=source_url)

        if canon_key not in company_clusters:
            company_clusters[canon_key] = {
                "canonical_name": canon_name,
                "canonical_domain": canon_domain,
                "raw_variations": set(),
                "job_ids": [],
            }

        company_clusters[canon_key]["raw_variations"].add(raw_company)
        company_clusters[canon_key]["job_ids"].append(doc.id)

        # Needs update if name differs from canonical name
        if raw_company != canon_name:
            jobs_to_update.append({
                "id": doc.id,
                "current_company": raw_company,
                "canonical_company": canon_name,
                "canonical_key": canon_key,
                "title": data.get("title", "Untitled"),
                "url": source_url or "",
            })

    # Clusters with duplicates
    duplicate_clusters = {
        k: v for k, v in company_clusters.items() if len(v["raw_variations"]) > 1
    }

    # 2. Inspect Applications
    apps_ref = client.collection("applications")
    all_apps = list(apps_ref.stream())
    apps_to_update = []

    for doc in all_apps:
        data = doc.to_dict() or {}
        current_comp = data.get("company", "")
        portal_url = data.get("portalUrl")
        job_id = data.get("jobId")

        canon_key, canon_name, _ = normalize_company(current_comp, url=portal_url)

        # Check if company needs normalization
        if current_comp and current_comp != canon_name and canon_key in duplicate_clusters:
            apps_to_update.append({
                "id": doc.id,
                "userId": data.get("userId"),
                "jobId": job_id,
                "current_company": current_comp,
                "canonical_company": canon_name,
            })

    # 3. Inspect Tailored Resumes
    resumes_ref = client.collection("tailored_resumes")
    all_resumes = list(resumes_ref.stream())
    resumes_to_update = []

    for doc in all_resumes:
        data = doc.to_dict() or {}
        current_comp = data.get("jobCompany", "")
        canon_key, canon_name, _ = normalize_company(current_comp)

        if current_comp and current_comp != canon_name and canon_key in duplicate_clusters:
            resumes_to_update.append({
                "id": doc.id,
                "userId": data.get("userId"),
                "jobId": data.get("jobId"),
                "current_company": current_comp,
                "canonical_company": canon_name,
            })

    # 4. Inspect User Opportunity Contacts
    users_ref = client.collection("users")
    all_users = list(users_ref.stream())
    contacts_to_update = []
    intels_to_update = []

    for user_doc in all_users:
        u_id = user_doc.id

        # Contacts
        contacts_sub = client.collection("users").document(u_id).collection("opportunity_contacts").stream()
        for c_doc in contacts_sub:
            c_data = c_doc.to_dict() or {}
            c_name = c_data.get("companyName", "")
            c_key = c_data.get("companyKey", "")

            canon_key, canon_name, _ = normalize_company(c_name)
            needs_name_update = bool(c_name and c_name != canon_name and canon_key in duplicate_clusters)
            needs_key_update = bool(c_key != canon_key and canon_key in duplicate_clusters)

            if needs_name_update or needs_key_update:
                contacts_to_update.append({
                    "id": c_doc.id,
                    "userId": u_id,
                    "contactName": c_data.get("fullName"),
                    "current_company": c_name,
                    "canonical_company": canon_name,
                    "current_key": c_key,
                    "canonical_key": canon_key,
                })

        # Intelligence
        intel_sub = client.collection("users").document(u_id).collection("company_intelligence").stream()
        for i_doc in intel_sub:
            i_data = i_doc.to_dict() or {}
            i_name = i_data.get("companyName", "")
            canon_key, canon_name, _ = normalize_company(i_name)

            if i_name and i_name != canon_name and canon_key in duplicate_clusters:
                intels_to_update.append({
                    "id": i_doc.id,
                    "userId": u_id,
                    "current_company": i_name,
                    "canonical_company": canon_name,
                })

    report = {
        "timestamp": datetime.now(UTC).isoformat(),
        "mode": "APPLY" if apply_changes else "DRY-RUN",
        "total_jobs_scanned": len(all_jobs),
        "duplicate_clusters": duplicate_clusters,
        "jobs_to_update_count": len(jobs_to_update),
        "jobs_to_update": jobs_to_update,
        "apps_to_update_count": len(apps_to_update),
        "apps_to_update": apps_to_update,
        "resumes_to_update_count": len(resumes_to_update),
        "resumes_to_update": resumes_to_update,
        "contacts_to_update_count": len(contacts_to_update),
        "contacts_to_update": contacts_to_update,
        "intels_to_update_count": len(intels_to_update),
        "intels_to_update": intels_to_update,
    }

    # Execute changes ONLY if explicitly approved with --apply
    if apply_changes:
        logger.info(f"Executing LIVE reconciliation across {len(jobs_to_update)} jobs, {len(apps_to_update)} applications...")
        batch = client.batch()
        op_count = 0

        # Update jobs
        for item in jobs_to_update:
            doc_ref = client.collection("jobs").document(item["id"])
            batch.update(doc_ref, {
                "company": item["canonical_company"],
                "updatedAt": datetime.now(UTC).isoformat(),
            })
            op_count += 1
            if op_count >= 400:
                batch.commit()
                batch = client.batch()
                op_count = 0

        # Update applications
        for item in apps_to_update:
            doc_ref = client.collection("applications").document(item["id"])
            batch.update(doc_ref, {
                "company": item["canonical_company"],
                "updatedAt": datetime.now(UTC).isoformat(),
            })
            op_count += 1
            if op_count >= 400:
                batch.commit()
                batch = client.batch()
                op_count = 0

        # Update resumes
        for item in resumes_to_update:
            doc_ref = client.collection("tailored_resumes").document(item["id"])
            batch.update(doc_ref, {
                "jobCompany": item["canonical_company"],
                "updatedAt": datetime.now(UTC).isoformat(),
            })
            op_count += 1
            if op_count >= 400:
                batch.commit()
                batch = client.batch()
                op_count = 0

        # Update contacts
        for item in contacts_to_update:
            doc_ref = client.collection("users").document(item["userId"]).collection("opportunity_contacts").document(item["id"])
            batch.update(doc_ref, {
                "companyName": item["canonical_company"],
                "companyKey": item["canonical_key"],
            })
            op_count += 1
            if op_count >= 400:
                batch.commit()
                batch = client.batch()
                op_count = 0

        # Update intelligence
        for item in intels_to_update:
            doc_ref = client.collection("users").document(item["userId"]).collection("company_intelligence").document(item["id"])
            batch.update(doc_ref, {
                "companyName": item["canonical_company"],
            })
            op_count += 1
            if op_count >= 400:
                batch.commit()
                batch = client.batch()
                op_count = 0

        if op_count > 0:
            batch.commit()

        logger.info("Live reconciliation applied successfully.")

    return report


def print_report(report: dict[str, Any]) -> None:
    print("\n" + "=" * 80)
    print("JOBFINDER — COMPANY DEDUPLICATION & RECONCILIATION REPORT")
    print(f"Execution Mode: {report['mode']}")
    print(f"Timestamp:      {report['timestamp']}")
    print("=" * 80)

    print("\n### Detected Duplicate Company Clusters:")
    for key, cluster in report["duplicate_clusters"].items():
        print(f"\n  • Canonical: {cluster['canonical_name']} ({cluster['canonical_domain']}) [key: {key}]")
        print(f"    Raw variations found: {sorted(list(cluster['raw_variations']))}")
        print(f"    Total opportunities in cluster: {len(cluster['job_ids'])}")

    print("\n### Proposed Document Reconciliations:")
    print(f"  • Jobs to update:             {report['jobs_to_update_count']}")
    for j in report["jobs_to_update"][:10]:
        print(f"      - {j['id']}: '{j['current_company']}' -> '{j['canonical_company']}' ({j['title'][:35]})")
    if report["jobs_to_update_count"] > 10:
        print(f"      ... and {report['jobs_to_update_count'] - 10} more jobs")

    print(f"\n  • Applications to update:     {report['apps_to_update_count']}")
    for a in report["apps_to_update"][:5]:
        print(f"      - {a['id']}: '{a['current_company']}' -> '{a['canonical_company']}' (jobId: {a['jobId']})")

    print(f"\n  • Tailored Resumes to update: {report['resumes_to_update_count']}")
    print(f"  • Discovered Contacts to update: {report['contacts_to_update_count']}")
    for c in report["contacts_to_update"][:5]:
        print(f"      - {c['id']} ({c['contactName']}): '{c['current_company']}' -> '{c['canonical_company']}'")

    print(f"\n  • Intelligence records to update: {report['intels_to_update_count']}")

    print("\n" + "=" * 80)
    if report["mode"] == "DRY-RUN":
        print("STATUS: DRY-RUN COMPLETED. 0 records were modified in Firestore.")
        print("To apply these changes, explicitly run: python scripts/reconcile_duplicate_companies.py --apply")
    else:
        print("STATUS: LIVE RECONCILIATION COMPLETED. All records updated in Firestore.")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reconcile duplicate company records in JobFinder Firestore database.")
    parser.add_argument("--apply", action="store_true", help="Execute live updates in Firestore (default is dry-run)")
    args = parser.parse_args()

    report = analyze_and_reconcile(apply_changes=args.apply)
    print_report(report)
