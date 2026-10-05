"""Cloud Firestore Repository for Immutable Saved ATS Scan Reports."""

import logging
from typing import Optional, List
from app.db.firebase import get_firestore_client
from app.schemas.scanner import SavedScanReportDTO

logger = logging.getLogger("jobFinder.db.scan_report_repo")


class ScanReportRepository:
    """Manages persistence and retrieval of Saved ATS Scan Reports in Cloud Firestore."""

    COLLECTION = "ats_scan_reports"

    def __init__(self):
        self._memory_cache: dict[str, SavedScanReportDTO] = {}

    def get_report_by_id(self, report_id: str) -> Optional[SavedScanReportDTO]:
        """Fetch a saved ATS scan report by ID."""
        if report_id in self._memory_cache:
            return self._memory_cache[report_id]

        try:
            client = get_firestore_client()
            if client:
                doc_ref = client.collection(self.COLLECTION).document(report_id)
                doc = doc_ref.get()
                if doc.exists:
                    data = doc.to_dict() or {}
                    report = SavedScanReportDTO.model_validate(data)
                    self._memory_cache[report_id] = report
                    return report
        except Exception as e:
            logger.error(f"Error reading scan report {report_id} from Firestore: {e}")
        return None

    def save_report(self, report: SavedScanReportDTO) -> SavedScanReportDTO:
        """Persist or update a saved scan report in memory and Firestore."""
        self._memory_cache[report.id] = report
        try:
            client = get_firestore_client()
            if client:
                doc_ref = client.collection(self.COLLECTION).document(report.id)
                data = report.model_dump(mode="json")
                doc_ref.set(data)
                logger.info(f"Persisted ATS scan report {report.id} in Firestore.")
        except Exception as e:
            logger.error(f"Error persisting scan report {report.id}: {e}")
        return report

    def list_reports_for_user(self, user_id: str = "user_default", limit: int = 50) -> List[SavedScanReportDTO]:
        """List all saved ATS scan reports for a user, sorted in-memory by createdAt descending."""
        reports: List[SavedScanReportDTO] = [r for r in self._memory_cache.values() if r.userId == user_id]
        try:
            client = get_firestore_client()
            if client:
                docs = (
                    client.collection(self.COLLECTION)
                    .where("userId", "==", user_id)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        dto = SavedScanReportDTO.model_validate(data)
                        self._memory_cache[dto.id] = dto
                        if not any(x.id == dto.id for x in reports):
                            reports.append(dto)
        except Exception as e:
            logger.error(f"Error querying scan reports for user {user_id}: {e}")

        # In-memory sorting (avoids composite index requirement)
        reports.sort(key=lambda x: x.createdAt or "", reverse=True)
        return reports[:limit]

    def delete_report(self, report_id: str) -> bool:
        """Delete a saved scan report from Firestore and cache."""
        if report_id in self._memory_cache:
            del self._memory_cache[report_id]
        try:
            client = get_firestore_client()
            if client:
                client.collection(self.COLLECTION).document(report_id).delete()
                logger.info(f"Deleted scan report {report_id} from Firestore.")
                return True
        except Exception as e:
            logger.error(f"Error deleting scan report {report_id}: {e}")
            return False
        return True


scan_report_repo = ScanReportRepository()
