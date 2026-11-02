"""API Endpoints for Opportunity Research and Company Intelligence."""

import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_authenticated_user_id
from app.schemas.company_intelligence import (
    CompanyIntelligenceResult,
    ResearchOpportunityRequest,
)
from app.schemas.opportunity_contact import (
    ContactDiscoveryResponse,
    ContactDismissRequest,
    ContactReviewRequest,
    DiscoverContactsRequest,
    DiscoveredContact,
)
from app.schemas.outreach import (
    ApproveOutreachRequest,
    GenerateOutreachRequest,
    ManualReviewReplyRequest,
    OutreachMessage,
    OutreachReply,
    SaveOutreachDraftRequest,
    SendOutreachResponse,
    SyncRepliesResponse,
    ThreadTimelineResponse,
)
from app.services.company_intelligence_service import company_intelligence_service

logger = logging.getLogger("jobFinder.api.opportunities")

router = APIRouter(prefix="/opportunities", tags=["Opportunities & Research"])


@router.post(
    "/{opportunity_id}/research",
    response_model=CompanyIntelligenceResult,
    status_code=status.HTTP_200_OK,
)
async def research_opportunity_company(
    opportunity_id: str,
    request: ResearchOpportunityRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Trigger or refresh Company Intelligence & Scam Shield research for a saved opportunity."""
    force_refresh = request.forceRefresh if request else False
    try:
        return await company_intelligence_service.research_opportunity(
            opportunity_id=opportunity_id,
            user_id=user_id,
            force_refresh=force_refresh,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error researching opportunity {opportunity_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Company intelligence research failed: {str(e)}",
        ) from e


@router.get(
    "/{opportunity_id}/intelligence",
    response_model=CompanyIntelligenceResult,
    status_code=status.HTTP_200_OK,
)
async def get_opportunity_company_intelligence(
    opportunity_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve existing cached company intelligence record for an opportunity."""
    intel = company_intelligence_service.get_intelligence(
        opportunity_id=opportunity_id,
        user_id=user_id,
    )
    if not intel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company intelligence has not yet been generated for this opportunity.",
        )
    return intel


# ==============================================================================
# Phase 2: Professional Contact Discovery & Evidence Classification Endpoints
# ==============================================================================

@router.post(
    "/{opportunity_id}/contacts/discover",
    response_model=ContactDiscoveryResponse,
    status_code=status.HTTP_200_OK,
)
async def discover_opportunity_contacts(
    opportunity_id: str,
    request: DiscoverContactsRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Discover, classify, rank, and persist public professional contacts for an opportunity."""
    from app.services.contact_discovery_service import contact_discovery_service

    force_refresh = request.forceRefresh if request else False
    try:
        return await contact_discovery_service.discover_contacts(
            user_id=user_id,
            opportunity_id=opportunity_id,
            force_refresh=force_refresh,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error discovering contacts for opportunity {opportunity_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Contact discovery failed: {str(e)}",
        ) from e


@router.get(
    "/{opportunity_id}/contacts",
    response_model=list[DiscoveredContact],
    status_code=status.HTTP_200_OK,
)
async def list_opportunity_contacts(
    opportunity_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve all discovered professional contacts associated with an opportunity."""
    from app.services.contact_discovery_service import contact_discovery_service

    return contact_discovery_service.get_contacts(
        user_id=user_id,
        opportunity_id=opportunity_id,
    )


@router.patch(
    "/{opportunity_id}/contacts/{contact_id}/dismiss",
    response_model=DiscoveredContact,
    status_code=status.HTTP_200_OK,
)
async def update_contact_dismissal(
    opportunity_id: str,
    contact_id: str,
    request: ContactDismissRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update contact dismissal status (with strict tenant isolation)."""
    from app.services.contact_discovery_service import contact_discovery_service

    updated = contact_discovery_service.update_contact_status(
        user_id=user_id,
        contact_id=contact_id,
        is_dismissed=request.isDismissed,
    )
    if not updated or (
        updated.opportunityId != opportunity_id
        and opportunity_id not in (updated.associatedOpportunityIds or [])
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found or does not belong to the authenticated user.",
        )
    return updated


@router.patch(
    "/{opportunity_id}/contacts/{contact_id}/review",
    response_model=DiscoveredContact,
    status_code=status.HTTP_200_OK,
)
async def update_contact_review(
    opportunity_id: str,
    contact_id: str,
    request: ContactReviewRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Toggle contact reviewed status (with strict tenant isolation)."""
    from app.services.contact_discovery_service import contact_discovery_service

    updated = contact_discovery_service.update_contact_status(
        user_id=user_id,
        contact_id=contact_id,
        is_reviewed=request.isReviewed,
    )
    if not updated or (
        updated.opportunityId != opportunity_id
        and opportunity_id not in (updated.associatedOpportunityIds or [])
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found or does not belong to the authenticated user.",
        )
    return updated


@router.delete(
    "/{opportunity_id}/contacts/{contact_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_opportunity_contact(
    opportunity_id: str,
    contact_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Soft-delete a discovered contact with strict user ownership and opportunity verification."""
    from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo

    contact = opportunity_contact_repo.get_contact(user_id=user_id, contact_id=contact_id)
    if not contact:
        # Check if contact belongs to another user for 403 Forbidden
        other_contact = opportunity_contact_repo.get_contact_any_user(contact_id)
        if other_contact and other_contact.userId != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: contact belongs to another user account.",
            )
        # Idempotent response
        return {
            "success": True,
            "idempotent": True,
            "message": "Contact already deleted or not found.",
            "contactId": contact_id,
        }

    if contact.isDeleted:
        return {
            "success": True,
            "idempotent": True,
            "message": "Contact already deleted.",
            "contactId": contact_id,
        }

    # Verify user ownership
    if contact.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: contact belongs to another user account.",
        )

    # Verify opportunity association
    associated_ids = contact.associatedOpportunityIds or []
    if contact.opportunityId != opportunity_id and opportunity_id not in associated_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contact is not associated with this opportunity.",
        )

    # Soft delete and record company-scoped tombstone
    deleted = opportunity_contact_repo.soft_delete_contact(
        user_id=user_id,
        contact_id=contact_id,
        reason="USER_INITIATED_DELETION",
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to soft-delete contact.",
        )

    return {
        "success": True,
        "idempotent": False,
        "message": "Contact deleted successfully.",
        "contactId": contact_id,
    }


# --- Phase 3: Truth-Lock Outreach Endpoints ---


@router.post(
    "/{opportunity_id}/contacts/{contact_id}/outreach/generate",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def generate_outreach_draft(
    opportunity_id: str,
    contact_id: str,
    request: GenerateOutreachRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate a personalized, Truth-Locked outreach draft grounded in verified candidate facts."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        return await outreach_orchestration_service.generate_outreach_draft(
            user_id=user_id,
            opportunity_id=opportunity_id,
            contact_id=contact_id,
            notes=request.notes,
            tone=request.tone,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error generating outreach draft for contact {contact_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Outreach generation failed: {str(e)}",
        ) from e


@router.post(
    "/{opportunity_id}/contacts/{contact_id}/outreach",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def save_contact_outreach_draft(
    opportunity_id: str,
    contact_id: str,
    request: SaveOutreachDraftRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Save or update an outreach draft for a contact, running Truth-Lock audit."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        return outreach_orchestration_service.save_manual_draft(
            user_id=user_id,
            opportunity_id=opportunity_id,
            contact_id=contact_id,
            subject=request.subject,
            body=request.body,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error saving outreach draft for contact {contact_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Saving draft failed: {str(e)}",
        ) from e


@router.get(
    "/{opportunity_id}/contacts/{contact_id}/outreach",
    response_model=OutreachMessage | None,
    status_code=status.HTTP_200_OK,
)
async def get_contact_outreach(
    opportunity_id: str,
    contact_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Get active outreach draft for a contact if one exists."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    return outreach_orchestration_service.get_by_contact(
        user_id=user_id,
        opportunity_id=opportunity_id,
        contact_id=contact_id,
    )


@router.put(
    "/{opportunity_id}/outreach/{outreach_id}",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def update_outreach_draft(
    opportunity_id: str,
    outreach_id: str,
    request: SaveOutreachDraftRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update an outreach draft by ID, invalidating prior approval on modification."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        msg = outreach_orchestration_service.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not msg or msg.opportunityId != opportunity_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Outreach draft not found or does not belong to this opportunity.",
            )
        return outreach_orchestration_service.update_draft(
            user_id=user_id,
            outreach_id=outreach_id,
            subject=request.subject,
            body=request.body,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error updating outreach draft {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Updating draft failed: {str(e)}",
        ) from e


@router.post(
    "/{opportunity_id}/outreach/{outreach_id}/approve",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def approve_outreach_draft(
    opportunity_id: str,
    outreach_id: str,
    request: ApproveOutreachRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Explicitly approve an outreach draft for sending (or revoke approval)."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        msg = outreach_orchestration_service.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not msg or msg.opportunityId != opportunity_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Outreach draft not found or does not belong to this opportunity.",
            )
        return outreach_orchestration_service.set_approval_status(
            user_id=user_id,
            outreach_id=outreach_id,
            is_approved=request.isApproved,
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error approving outreach draft {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Approval status update failed: {str(e)}",
        ) from e


# --- Phase 4: Gmail Sending & Reconciliation Endpoints ---


@router.post(
    "/{opportunity_id}/outreach/{outreach_id}/send",
    response_model=SendOutreachResponse,
    status_code=status.HTTP_200_OK,
)
async def send_outreach_message(
    opportunity_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Dispatch an explicitly approved outreach message via authorized Gmail account."""
    from app.services.gmail_sending_service import (
        AmbiguousSendError,
        DuplicateSendError,
        GmailNotConnectedError,
        IneligibleRecipientError,
        UnapprovedDraftError,
        gmail_sending_service,
    )

    try:
        return await gmail_sending_service.send_approved_outreach(
            user_id=user_id,
            opportunity_id=opportunity_id,
            outreach_id=outreach_id,
        )
    except UnapprovedDraftError as ude:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ude)) from ude
    except IneligibleRecipientError as ire:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ire)) from ire
    except GmailNotConnectedError as gnc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(gnc)) from gnc
    except DuplicateSendError as dse:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(dse)) from dse
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error sending outreach message {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Sending failed: {str(e)}",
        ) from e


@router.post(
    "/{opportunity_id}/outreach/{outreach_id}/reconcile",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def reconcile_outreach_message(
    opportunity_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Reconcile an ambiguous outreach message outcome against Gmail sent messages."""
    from app.services.gmail_sending_service import gmail_sending_service

    try:
        return await gmail_sending_service.reconcile_outreach_status(
            user_id=user_id,
            opportunity_id=opportunity_id,
            outreach_id=outreach_id,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error reconciling outreach message {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reconciliation failed: {str(e)}",
        ) from e


# --- Phase 5: Reply Tracking & Intent Classification Endpoints ---


@router.post(
    "/{opportunity_id}/outreach/{outreach_id}/sync-replies",
    response_model=SyncRepliesResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_outreach_replies(
    opportunity_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Synchronize inbound replies from Gmail for a specific outreach thread."""
    from app.services.reply_tracking_service import (
        GmailReadPermissionRequiredError,
        ReplySyncError,
        reply_tracking_service,
    )

    try:
        replies = await reply_tracking_service.sync_replies_for_outreach(
            user_id=user_id,
            opportunity_id=opportunity_id,
            outreach_id=outreach_id,
        )
        return SyncRepliesResponse(
            outreachId=outreach_id,
            newRepliesCount=len(replies),
            totalRepliesCount=len(replies),
            replies=replies,
            hasReadPermission=True,
            message=f"Successfully synced {len(replies)} reply(ies).",
        )
    except GmailReadPermissionRequiredError as rpe:
        return SyncRepliesResponse(
            outreachId=outreach_id,
            newRepliesCount=0,
            totalRepliesCount=0,
            replies=[],
            hasReadPermission=False,
            message=str(rpe),
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except ReplySyncError as rse:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(rse)) from rse
    except Exception as e:
        logger.error(f"Unexpected error syncing replies for outreach {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reply sync failed: {str(e)}",
        ) from e


@router.get(
    "/{opportunity_id}/outreach/{outreach_id}/timeline",
    response_model=ThreadTimelineResponse,
    status_code=status.HTTP_200_OK,
)
async def get_outreach_thread_timeline(
    opportunity_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve full thread timeline (outreach + replies + classifications) for an outreach message."""
    from app.services.reply_tracking_service import reply_tracking_service

    try:
        return reply_tracking_service.get_thread_timeline(
            user_id=user_id,
            opportunity_id=opportunity_id,
            outreach_id=outreach_id,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error fetching thread timeline for outreach {outreach_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Fetching timeline failed: {str(e)}",
        ) from e


@router.post(
    "/{opportunity_id}/outreach/{outreach_id}/replies/{reply_id}/manual-review",
    response_model=OutreachReply,
    status_code=status.HTTP_200_OK,
)
async def manual_review_reply(
    opportunity_id: str,
    outreach_id: str,
    reply_id: str,
    request: ManualReviewReplyRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Manually review an ambiguous or misclassified reply, updating intent and suppression state."""
    from app.services.reply_tracking_service import reply_tracking_service

    try:
        return reply_tracking_service.manual_review_reply(
            user_id=user_id,
            opportunity_id=opportunity_id,
            outreach_id=outreach_id,
            reply_id=reply_id,
            req=request,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error during manual review for reply {reply_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Manual review failed: {str(e)}",
        ) from e


@router.get(
    "/{opportunity_id}/replies",
    response_model=list[OutreachReply],
    status_code=status.HTTP_200_OK,
)
async def list_opportunity_replies(
    opportunity_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """List all replies received for any outreach message associated with this opportunity."""
    from app.db.repositories.outreach_reply_repo import outreach_reply_repo

    return outreach_reply_repo.list_replies_for_opportunity(
        user_id=user_id,
        opportunity_id=opportunity_id,
    )



