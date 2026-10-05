"""Deterministic ReportLab Canonical ATS Cover Letter PDF Renderer (100% Local, $0 & Deterministic)."""

import io
import logging
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.schemas.cover_letter import CoverLetterContent

logger = logging.getLogger("jobFinder.reportlab_cover_letter_renderer")


class ReportLabCoverLetterRenderer:
    """Renders structured cover letter content into a clean, executive Overleaf-style ATS-compliant PDF."""

    def __init__(self):
        self._setup_styles()

    def _setup_styles(self):
        styles = getSampleStyleSheet()

        self.style_name = ParagraphStyle(
            "LetterName",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=18,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_CENTER,
            spaceAfter=2,
        )

        self.style_location = ParagraphStyle(
            "LetterLocation",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#475569"),
            alignment=TA_CENTER,
            spaceAfter=2,
        )

        self.style_contact = ParagraphStyle(
            "LetterContact",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            textColor=colors.HexColor("#334155"),
            alignment=TA_CENTER,
            spaceAfter=8,
        )

        self.style_table_left = ParagraphStyle(
            "LetterTableLeft",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_LEFT,
        )

        self.style_table_right = ParagraphStyle(
            "LetterTableRight",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_RIGHT,
        )

        self.style_salutation = ParagraphStyle(
            "LetterSalutation",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=4,
        )

        self.style_subject = ParagraphStyle(
            "LetterSubject",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=10,
        )

        self.style_body = ParagraphStyle(
            "LetterBody",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14.5,
            textColor=colors.HexColor("#1e293b"),
            alignment=TA_JUSTIFY,
            spaceAfter=10,
        )

        self.style_closing = ParagraphStyle(
            "LetterClosing",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#1e293b"),
            spaceBefore=6,
            spaceAfter=18,
        )

        self.style_signature = ParagraphStyle(
            "LetterSignature",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#0f172a"),
        )

    def _clean_text(self, text: str | None) -> str:
        if not text:
            return ""
        return (
            text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .strip()
        )

    def render_to_bytes(self, content: CoverLetterContent) -> bytes:
        """Render cover letter content into raw PDF byte stream matching Overleaf layout."""
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            leftMargin=50,
            rightMargin=50,
            topMargin=42,
            bottomMargin=42,
        )

        story = []

        # 1. Centered Header: Candidate Name
        name_clean = self._clean_text(content.fullName or "Candidate Name")
        story.append(Paragraph(f"<b>{name_clean}</b>", self.style_name))

        # 2. Centered Location
        city = self._clean_text(content.city)
        country = self._clean_text(content.country or "India")
        location_str = f"{city}, {country}" if city else country
        if location_str:
            story.append(Paragraph(location_str, self.style_location))

        # 3. Centered Contact Details (Email, LinkedIn, GitHub)
        contact_parts = []
        if content.email:
            em = self._clean_text(content.email)
            contact_parts.append(f'<a href="mailto:{em}">{em}</a>')
        if content.phone:
            contact_parts.append(self._clean_text(content.phone))
        if content.linkedin:
            li = self._clean_text(content.linkedin)
            contact_parts.append(f'<a href="{li}"><u>LinkedIn</u></a>')
        if content.github:
            gh = self._clean_text(content.github)
            contact_parts.append(f'<a href="{gh}"><u>GitHub</u></a>')

        contact_line = " &nbsp;|&nbsp; ".join(contact_parts)
        if contact_line:
            story.append(Paragraph(contact_line, self.style_contact))

        story.append(Spacer(1, 14))

        # 4. Date & Recipient Grid (Recipient on Left, Date on Right)
        recip_name = self._clean_text(content.recipientName or "Hiring Team")
        comp_name = self._clean_text(content.companyName or "Company")
        date_clean = self._clean_text(content.date or "")

        left_cell_text = f"<b>{recip_name}</b><br/>{comp_name}"
        right_cell_text = f"<b>{date_clean}</b>"

        table_data = [
            [
                Paragraph(left_cell_text, self.style_table_left),
                Paragraph(right_cell_text, self.style_table_right),
            ]
        ]
        t = Table(table_data, colWidths=["65%", "35%"])
        t.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        story.append(t)
        story.append(Spacer(1, 12))

        # 5. Formal Greeting
        greeting = self._clean_text(content.greeting or "Dear Hiring Team,")
        if not greeting.endswith(","):
            greeting += ","
        story.append(Paragraph(greeting, self.style_salutation))

        # 6. Formal Subject Line
        subject = self._clean_text(content.subject or f"Application for {content.jobTitle}")
        story.append(Paragraph(f"<b>Subject: {subject}</b>", self.style_subject))

        # 7. Body Paragraph 1: The Hook & Introduction
        if content.paragraph1_hook:
            story.append(Paragraph(self._clean_text(content.paragraph1_hook), self.style_body))

        # 8. Body Paragraph 2: Core Evidence & Alignment
        if content.paragraph2_evidence:
            story.append(Paragraph(self._clean_text(content.paragraph2_evidence), self.style_body))

        # 9. Body Paragraph 3: Transferable Impact & Closing
        if content.paragraph3_impact:
            story.append(Paragraph(self._clean_text(content.paragraph3_impact), self.style_body))

        # 10. Sign-off & Full Name
        signoff = self._clean_text(content.signOff or "Sincerely,")
        if not signoff.endswith(","):
            signoff += ","
        story.append(Paragraph(signoff, self.style_closing))
        story.append(Paragraph(name_clean, self.style_signature))

        # Build PDF
        doc.build(story)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes


reportlab_cover_letter_renderer = ReportLabCoverLetterRenderer()
