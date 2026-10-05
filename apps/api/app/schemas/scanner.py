"""
Pydantic schemas for the 100-Point ATS Resume Scanner & Keyword Match Engine.
Includes models for single/bulk AI bullet optimization, deterministic validation,
and immutable saved ATS scan reports.
"""

from __future__ import annotations
from typing import Dict, List, Optional, Any, Literal
from pydantic import BaseModel, Field


class CategoryCheckItem(BaseModel):
    name: str
    passed: bool
    score: float
    max_score: float
    detail: str


class CategoryScore(BaseModel):
    name: str
    score: float
    max_score: float
    percentage: float
    status: Literal["pass", "warning", "fail"]
    summary: str
    checks: List[CategoryCheckItem] = []


class KeywordMatchDetail(BaseModel):
    id: str
    name: str
    category: str
    importance: Literal["High", "Medium", "Bonus"]
    status: Literal["matched", "missing", "transferable"]
    recommendation: Optional[str] = None


class KeywordMatrix(BaseModel):
    matched: List[KeywordMatchDetail] = []
    missing: List[KeywordMatchDetail] = []
    transferable: List[KeywordMatchDetail] = []
    match_percentage: float = 0.0
    total_jd_keywords: int = 0
    matched_count: int = 0
    missing_count: int = 0
    transferable_count: int = 0


class BulletAuditItem(BaseModel):
    id: str
    section: str
    role_or_project: str
    text: str
    score: int
    status: Literal["strong", "moderate", "weak"]
    has_action_verb: bool
    has_metric: bool
    has_weak_opener: bool
    verb: Optional[str] = None
    word_count: int
    issues: List[str] = []


class ChecklistItem(BaseModel):
    id: str
    priority: Literal["critical", "high", "medium", "low"]
    category: str
    title: str
    description: str
    passed: bool
    impact_points: int


class ScanMetadata(BaseModel):
    resume_id: Optional[str] = None
    job_id: Optional[str] = None
    source_type: Literal["tailored_resume", "file_upload"]
    file_name: Optional[str] = None
    page_count: int = 1
    word_count: int = 0
    estimated_read_time: str = "45 sec"
    taxonomy_version: str = "1.0.0"


class AtsScanResult(BaseModel):
    overall_score: int
    grade: Literal["A+", "A", "B", "C", "D"]
    summary: str
    category_scores: Dict[str, CategoryScore]
    keyword_matrix: KeywordMatrix
    bullet_audits: List[BulletAuditItem]
    actionable_checklist: List[ChecklistItem]
    metadata: ScanMetadata


class ScanTailoredRequest(BaseModel):
    resume_id: str
    job_id: Optional[str] = None


class AiBulletRewriteRequest(BaseModel):
    bullet_text: str
    role_or_project: str = ""
    section: str = ""
    job_title: Optional[str] = None
    job_description: Optional[str] = None


class BulletSuggestion(BaseModel):
    text: str
    style: str  # e.g., "High-Impact Quantified", "Action-Oriented Architecture", "Concise & Focused"
    audit: Dict[str, Any]
    rationale: str


class AiBulletRewriteResponse(BaseModel):
    original_bullet: str
    suggestions: List[BulletSuggestion]


# =========================================================================
# 1-SHOT BULK AI BULLET OPTIMIZATION SCHEMAS (SET A / SET B)
# =========================================================================

class BulkBulletInput(BaseModel):
    id: str
    section: str
    role_or_project: str
    original_text: str


class BulkAiBulletRewriteRequest(BaseModel):
    bullets: List[BulkBulletInput] = Field(..., min_length=1, max_length=50)
    job_title: Optional[str] = None
    job_description: Optional[str] = None


class OptimizedBulletItem(BaseModel):
    bullet_id: str
    text: str
    style: str  # e.g. "Action & Verified Impact" or "Architecture & Systems Depth"
    has_action_verb: bool = True
    has_metric: bool = False
    rationale: str = ""
    is_valid: bool = True
    validation_issues: List[str] = []


class BulkAiBulletRewriteResponse(BaseModel):
    set_a: List[OptimizedBulletItem]
    set_b: List[OptimizedBulletItem]
    total_processed: int
    validation_passed: bool


# =========================================================================
# IMMUTABLE SAVED ATS SCAN REPORT SCHEMAS
# =========================================================================

class SavedScanReportDTO(BaseModel):
    id: str
    userId: str
    reportName: str
    sourceType: Literal["tailored_resume", "file_upload"]
    resumeId: Optional[str] = None
    resumeContentHash: Optional[str] = None
    jobId: Optional[str] = None
    jobTitle: Optional[str] = None
    jobCompany: Optional[str] = None
    overallScore: int
    grade: str
    scanResult: AtsScanResult
    taxonomyVersion: str = "1.0.0"
    createdAt: str
    updatedAt: str


class SaveScanReportRequest(BaseModel):
    reportName: Optional[str] = None
    scanResult: AtsScanResult
