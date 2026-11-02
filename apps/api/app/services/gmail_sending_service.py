"""Phase 4: Gmail Sending Service & Lifecycle State Machine.

Implements approved outreach dispatch with strict eligibility gating, idempotency locks,
MIME multipart assembly (optional resume PDF attachment), ambiguous outcome defense,
and reconciliation mechanisms.
"""

import base64
import email
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging
import re
from datetime import UTC, datetime
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.db.repositories.oauth_token_repo import oauth_token_repo
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.db.repositories.outreach_repo import OutreachRepository, outreach_repo
from app.db.repositories.resume_repo import resume_repo
from app.schemas.opportunity_contact import EmailEvidenceClassification
from app.schemas.outreach import OutreachMessage, OutreachStatus, SendOutreachResponse
from app.services.reportlab_renderer import reportlab_renderer

logger = logging.getLogger("jobFinder.services.gmail_sending")

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GMAIL_MESSAGES_LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Strict eligibility policy: Prohibit sending to inferred, unverified, or domain-only addresses
DISALLOWED_EVIDENCE_TIERS: set[EmailEvidenceClassification] = {
    "PATTERN_INFERRED",
    "DOMAIN_MAIL_ENABLED",
    "UNVERIFIED",
    "INVALID_OR_UNSUPPORTED",
}

# Sending locks to prevent concurrent send attempts from duplicate dispatches
_SEND_LOCKS: set[str] = set()


class GmailSendingError(Exception):
    """Base exception for Gmail dispatch failures."""

    pass


class GmailNotConnectedError(GmailSendingError):
    """Raised when user has not authorized Gmail."""

    pass


class IneligibleRecipientError(GmailSendingError):
    """Raised when email evidence classification violates strict sending policy."""

    pass


class UnapprovedDraftError(GmailSendingError):
    """Raised when draft is not in APPROVED state."""

    pass


class DuplicateSendError(GmailSendingError):
    """Raised when message is already sending or sent."""

    pass


class AmbiguousSendError(GmailSendingError):
    """Raised when network timeout occurs and dispatch outcome is uncertain."""

    pass


class GmailSendingService:
    """Service managing authorized outreach transmission through Gmail API."""

    def __init__(self, repo: OutreachRepository | None = None, http_client: httpx.AsyncClient | None = None):
        self.repo = repo or outreach_repo
        self._client = http_client

    async def _get_valid_access_token(self, user_id: str) -> str:
        """Retrieve a valid Gmail access token, refreshing if needed."""
        token_data = oauth_token_repo.get_decrypted_tokens(user_id)
        if not token_data or not token_data.get("accessToken"):
            raise GmailNotConnectedError(
                "Gmail integration is not connected. Please authorize your Gmail account in Settings."
            )

        access_token = token_data["accessToken"]
        refresh_token = token_data.get("refreshToken")
        expiry = token_data.get("tokenExpiry")

        # Check if expired or near expiry
        is_expired = False
        if expiry:
            try:
                exp_dt = datetime.fromisoformat(expiry)
                if datetime.now(UTC) >= exp_dt:
                    is_expired = True
            except Exception:
                pass

        if is_expired and refresh_token:
            # Refresh access token
            client = self._client or httpx.AsyncClient(timeout=15.0)
            try:
                res = await client.post(
                    GOOGLE_TOKEN_URL,
                    data={
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
                if res.status_code == 200:
                    data = res.json()
                    access_token = data["access_token"]
                    expires_in = data.get("expires_in", 3600)
                    new_exp = datetime.now(UTC).timestamp() + expires_in
                    new_exp_iso = datetime.fromtimestamp(new_exp, UTC).isoformat()
                    existing_scope = token_data.get("scope")
                    saved_scope: str = existing_scope if existing_scope is not None else settings.GMAIL_SEND_SCOPE
                    oauth_token_repo.save_tokens(
                        user_id=user_id,
                        access_token=access_token,
                        refresh_token=refresh_token,
                        expiry=new_exp_iso,
                        scope=saved_scope,
                        gmail_address=token_data.get("gmailAddress"),
                    )
                else:
                    logger.error(f"Token refresh failed: {res.status_code} {res.text}")
            except Exception as e:
                logger.error(f"Error during OAuth token refresh for user {user_id}: {e}")

        return access_token

    def construct_mime_message(
        self,
        sender_email: str,
        recipient_email: str,
        subject: str,
        body_text: str,
        outreach_id: str,
        correlation_id: str,
        resume_attachment_bytes: bytes | None = None,
        resume_filename: str = "Resume.pdf",
    ) -> MIMEMultipart:
        """Construct standard RFC 2822 MIME message with correlation headers and optional attachment."""
        msg = MIMEMultipart("mixed")
        msg["From"] = sender_email
        msg["To"] = recipient_email
        msg["Subject"] = subject
        msg["X-JobFinder-Outreach-ID"] = outreach_id
        msg["X-JobFinder-Correlation-ID"] = correlation_id

        # Plain text body
        text_part = MIMEText(body_text, "plain", "utf-8")
        msg.attach(text_part)

        # PDF Resume attachment if selected
        if resume_attachment_bytes:
            pdf_part = MIMEApplication(resume_attachment_bytes, _subtype="pdf")
            pdf_part.add_header("Content-Disposition", "attachment", filename=resume_filename)
            msg.attach(pdf_part)

        return msg

    async def send_approved_outreach(
        self,
        user_id: str,
        opportunity_id: str,
        outreach_id: str,
    ) -> SendOutreachResponse:
        """Send explicitly approved outreach message via Gmail API."""
        # 1. Fetch outreach draft with strict tenant isolation
        draft = self.repo.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not draft or draft.opportunityId != opportunity_id:
            raise ValueError(f"Outreach message '{outreach_id}' not found for opportunity '{opportunity_id}'.")

        # 2. Check draft approval status
        if draft.status != "APPROVED":
            raise UnapprovedDraftError(
                f"Cannot send outreach with status '{draft.status}'. Explicit user approval is required."
            )

        # 3. Check contact and email evidence classification
        contact = opportunity_contact_repo.get_contact(user_id=user_id, contact_id=draft.contactId)
        if not contact or not contact.email or not contact.email.strip():
            raise IneligibleRecipientError("Contact email address is missing. Sending via Gmail is prohibited for profile-only contacts.")

        # Validate recipient email syntax
        email_str = contact.email.strip()
        if not re.match(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$", email_str):
            raise IneligibleRecipientError(f"Recipient email '{email_str}' has invalid syntax.")

        # Guard against inappropriate organizational channels
        if getattr(contact, "channelPurpose", None) == "ACCOMMODATIONS_ONLY":
            raise IneligibleRecipientError("Sending recruiting outreach to an accommodations-only mailbox is prohibited.")

        if getattr(contact, "contactabilityStatus", None) == "PROFILE_ONLY":
            raise IneligibleRecipientError("Sending via Gmail is prohibited for profile-only contacts without email evidence.")

        # Check suppression rules (Phase 5: Global Opt-out & Job-Specific Rejection)
        if getattr(contact, "doNotContact", False) or getattr(contact, "suppressionState", "NONE") == "GLOBAL_STAKEHOLDER_SUPPRESSION":
            raise IneligibleRecipientError(
                f"Contact '{contact.fullName}' has explicitly opted out of communications (GLOBAL_STAKEHOLDER_SUPPRESSION). Sending is blocked."
            )
        if getattr(contact, "suppressionState", "NONE") == "JOB_SPECIFIC_SUPPRESSION":
            raise IneligibleRecipientError(
                f"Contact '{contact.fullName}' has rejected outreach for this opportunity (JOB_SPECIFIC_SUPPRESSION). Sending further messages is blocked."
            )

        if contact.emailClassification in DISALLOWED_EVIDENCE_TIERS:
            raise IneligibleRecipientError(
                f"Sending restricted: Contact email classification '{contact.emailClassification}' is unverified or inferred. "
                "JobFinder sends strictly to PUBLICLY_LISTED or PROVIDER_VERIFIED email addresses."
            )

        # 4. Check idempotency sending lock
        lock_key = f"{user_id}:{outreach_id}"
        if lock_key in _SEND_LOCKS:
            raise DuplicateSendError("A send attempt is currently in progress for this message.")

        # 5. Retrieve Gmail access token
        access_token = await self._get_valid_access_token(user_id)
        token_info = oauth_token_repo.get_decrypted_tokens(user_id)
        sender_email = (token_info.get("gmailAddress") if token_info else None) or "me"

        # 6. Retrieve optional resume PDF attachment
        resume_bytes: bytes | None = None
        resume_filename = "Resume.pdf"
        if draft.resumeAttachmentId:
            tailored_resume = resume_repo.get_tailored_resume(draft.resumeAttachmentId)
            if not tailored_resume or tailored_resume.userId != user_id:
                raise ValueError(f"Selected resume '{draft.resumeAttachmentId}' does not belong to the user.")
            try:
                resume_bytes = reportlab_renderer.render_to_pdf_bytes(tailored_resume.structuredContent)
                safe_company = (draft.companyName or "Tailored").replace(" ", "_")
                resume_filename = f"{safe_company}_Resume.pdf"
            except Exception as e:
                logger.warning(f"Could not render resume PDF attachment: {e}")

        # 7. Construct MIME message
        mime_msg = self.construct_mime_message(
            sender_email=sender_email,
            recipient_email=contact.email,
            subject=draft.subject,
            body_text=draft.body,
            outreach_id=draft.id,
            correlation_id=draft.correlationId,
            resume_attachment_bytes=resume_bytes,
            resume_filename=resume_filename,
        )
        encoded_raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

        # 8. Set status to SENDING and acquire lock
        _SEND_LOCKS.add(lock_key)
        now_iso = datetime.now(UTC).isoformat()
        draft.status = "SENDING"
        draft.updatedAt = now_iso
        self.repo.save_outreach(draft)

        client = self._client or httpx.AsyncClient(timeout=20.0)

        try:
            res = await client.post(
                GMAIL_SEND_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json={"raw": encoded_raw},
            )

            # Success
            if res.status_code == 200:
                data = res.json()
                gmail_id = data.get("id")
                thread_id = data.get("threadId")
                draft.status = "SENT"
                draft.gmailMessageId = gmail_id
                draft.gmailThreadId = thread_id
                draft.sentAt = datetime.now(UTC).isoformat()
                draft.sendError = None
                self.repo.save_outreach(draft)

                return SendOutreachResponse(
                    outreachId=draft.id,
                    status="SENT",
                    gmailMessageId=gmail_id,
                    correlationId=draft.correlationId,
                    message="Outreach message successfully sent via Gmail.",
                )

            # Definite failure (4xx response from Gmail)
            elif 400 <= res.status_code < 500:
                err_text = res.text
                draft.status = "SEND_FAILED"
                draft.sendError = f"Gmail API error ({res.status_code}): {err_text}"
                self.repo.save_outreach(draft)

                return SendOutreachResponse(
                    outreachId=draft.id,
                    status="SEND_FAILED",
                    correlationId=draft.correlationId,
                    message=f"Sending failed: {err_text}",
                )

            # Ambiguous server failure (5xx response from Gmail)
            else:
                draft.status = "SEND_STATUS_UNKNOWN"
                draft.sendError = f"Ambiguous Gmail response ({res.status_code}): {res.text}"
                self.repo.save_outreach(draft)

                return SendOutreachResponse(
                    outreachId=draft.id,
                    status="SEND_STATUS_UNKNOWN",
                    correlationId=draft.correlationId,
                    message="Send outcome ambiguous (server error). Never automatically resent to prevent duplicates.",
                )

        except (httpx.TimeoutException, httpx.NetworkError) as net_err:
            # Network timeout or connection drop: Ambiguous outcome!
            logger.error(f"Timeout transmitting outreach {draft.id}: {net_err}")
            draft.status = "SEND_STATUS_UNKNOWN"
            draft.sendError = f"Network timeout during transmission: {str(net_err)}"
            self.repo.save_outreach(draft)

            return SendOutreachResponse(
                outreachId=draft.id,
                status="SEND_STATUS_UNKNOWN",
                correlationId=draft.correlationId,
                message="Network timeout occurred. State set to SEND_STATUS_UNKNOWN. Duplicate resend blocked.",
            )

        except Exception as e:
            logger.error(f"Unexpected error dispatching outreach {draft.id}: {e}")
            draft.status = "SEND_FAILED"
            draft.sendError = f"Unexpected failure: {str(e)}"
            self.repo.save_outreach(draft)

            return SendOutreachResponse(
                outreachId=draft.id,
                status="SEND_FAILED",
                correlationId=draft.correlationId,
                message=f"Dispatch failed: {str(e)}",
            )

        finally:
            _SEND_LOCKS.discard(lock_key)

    async def reconcile_outreach_status(
        self,
        user_id: str,
        opportunity_id: str,
        outreach_id: str,
    ) -> OutreachMessage:
        """Reconcile an ambiguous outreach message (SEND_STATUS_UNKNOWN) against Gmail sent items."""
        draft = self.repo.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not draft or draft.opportunityId != opportunity_id:
            raise ValueError(f"Outreach message '{outreach_id}' not found.")

        if draft.status != "SEND_STATUS_UNKNOWN":
            return draft

        # Search Gmail sent messages for correlation ID or recipient
        try:
            access_token = await self._get_valid_access_token(user_id)
            client = self._client or httpx.AsyncClient(timeout=15.0)

            # Query Gmail sent messages for recipient and correlation header
            query = f"to:{draft.recipientEmail}"
            res = await client.get(
                GMAIL_MESSAGES_LIST_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params={"q": query, "maxResults": 10},
            )

            if res.status_code == 200:
                messages_data = res.json().get("messages", [])
                for msg_item in messages_data:
                    # Inspect message details for X-JobFinder-Outreach-ID
                    detail_res = await client.get(
                        f"{GMAIL_MESSAGES_LIST_URL}/{msg_item['id']}",
                        headers={"Authorization": f"Bearer {access_token}"},
                        params={"format": "metadata"},
                    )
                    if detail_res.status_code == 200:
                        detail_json = detail_res.json()
                        headers = {
                            h["name"].lower(): h["value"]
                            for h in detail_json.get("payload", {}).get("headers", [])
                        }
                        if (
                            headers.get("x-jobfinder-outreach-id") == draft.id
                            or headers.get("x-jobfinder-correlation-id") == draft.correlationId
                        ):
                            # Confirmed sent!
                            draft.status = "SENT"
                            draft.gmailMessageId = msg_item["id"]
                            draft.gmailThreadId = detail_json.get("threadId")
                            draft.sentAt = datetime.now(UTC).isoformat()
                            draft.sendError = None
                            return self.repo.save_outreach(draft)

            # If search completed and correlation ID was not found, mark as failed so user can safely retry
            draft.status = "SEND_FAILED"
            draft.sendError = "Reconciliation confirmed message was not recorded in Gmail sent mail. You may safely retry."
            return self.repo.save_outreach(draft)

        except Exception as e:
            logger.error(f"Error during reconciliation for outreach {draft.id}: {e}")
            # Do NOT mark as failed if reconciliation query itself failed; preserve SEND_STATUS_UNKNOWN
            return draft


gmail_sending_service = GmailSendingService()
