"""ReportLab ATS Resume PDF Renderer with Centralized Layout Tokens and Calibrated Vertical Rhythm."""

import io
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.resume import StructuredResumeContent

# ==============================================================================
# CENTRALIZED TYPOGRAPHIC & VERTICAL SPACING DESIGN TOKENS
# ==============================================================================

# Page Margins (in points: 72 points = 1 inch)
PAGE_MARGIN_H = 24.0          # Left and Right horizontal margins (~0.33 inch)
PAGE_MARGIN_TOP = 22.0        # Top margin
PAGE_MARGIN_BOTTOM = 22.0     # Bottom margin

# Typography Sizing & Line Leading
FONT_NAME_SIZE = 15.0
FONT_NAME_LEADING = 17.0

FONT_META_SIZE = 8.0
FONT_META_LEADING = 10.0

FONT_SECTION_SIZE = 9.4
FONT_SECTION_LEADING = 11.2

FONT_TITLE_SIZE = 8.4
FONT_TITLE_LEADING = 10.3

FONT_BODY_SIZE = 8.2
FONT_BODY_LEADING = 10.5

# Vertical Spacing Rhythm
SPACE_HEADER_BOTTOM = 2.5
SPACE_HEADER_HR_BOTTOM = 2.5

SPACE_SECTION_BEFORE = 6.0
SPACE_SECTION_TITLE_BOTTOM = 1.0
SPACE_SECTION_HR_BOTTOM = 2.5
SPACE_SECTION_GAP = 4.5

SPACE_PROJECT_GAP = 4.5
SPACE_PROJECT_HEADER_BOTTOM = 1.2
SPACE_BULLET_BOTTOM = 1.6

SPACE_EDU_ENTRY_GAP = 2.5
SPACE_SKILL_ROW_GAP = 1.4

COLOR_PRIMARY_TEXT = colors.HexColor("#0f172a")    # Slate 900
COLOR_BODY_TEXT = colors.HexColor("#334155")       # Slate 700
COLOR_MUTED_TEXT = colors.HexColor("#475569")      # Slate 600
COLOR_DIVIDER_DARK = colors.HexColor("#94a3b8")    # Slate 400
COLOR_DIVIDER_LIGHT = colors.HexColor("#cbd5e1")   # Slate 300


class ReportLabResumeRenderer:
    """Compiles structured ATS JSON into a high-density, beautifully balanced 1-page PDF using ReportLab."""

    def __init__(self):
        self.style_name = ParagraphStyle(
            "ResumeName",
            fontName="Helvetica-Bold",
            fontSize=FONT_NAME_SIZE,
            leading=FONT_NAME_LEADING,
            alignment=1,  # Center
            textColor=COLOR_PRIMARY_TEXT,
            spaceAfter=SPACE_HEADER_BOTTOM,
        )

        self.style_contact = ParagraphStyle(
            "ResumeContact",
            fontName="Helvetica",
            fontSize=FONT_META_SIZE,
            leading=FONT_META_LEADING,
            alignment=1,  # Center
            textColor=COLOR_BODY_TEXT,
            spaceAfter=SPACE_HEADER_BOTTOM,
        )

        self.style_section_title = ParagraphStyle(
            "ResumeSectionTitle",
            fontName="Helvetica-Bold",
            fontSize=FONT_SECTION_SIZE,
            leading=FONT_SECTION_LEADING,
            textColor=COLOR_PRIMARY_TEXT,
            spaceBefore=SPACE_SECTION_BEFORE,
            spaceAfter=SPACE_SECTION_TITLE_BOTTOM,
            keepWithNext=True,
        )

        self.style_item_title = ParagraphStyle(
            "ResumeItemTitle",
            fontName="Helvetica-Bold",
            fontSize=FONT_TITLE_SIZE,
            leading=FONT_TITLE_LEADING,
            textColor=COLOR_PRIMARY_TEXT,
            spaceAfter=SPACE_PROJECT_HEADER_BOTTOM,
        )

        self.style_item_meta = ParagraphStyle(
            "ResumeItemMeta",
            fontName="Helvetica",
            fontSize=FONT_META_SIZE,
            leading=FONT_META_LEADING,
            textColor=COLOR_MUTED_TEXT,
        )

        self.style_item_date = ParagraphStyle(
            "ResumeItemDate",
            fontName="Helvetica",
            fontSize=FONT_META_SIZE,
            leading=FONT_META_LEADING,
            alignment=2,  # Right-aligned
            textColor=COLOR_MUTED_TEXT,
        )

        self.style_body = ParagraphStyle(
            "ResumeBody",
            fontName="Helvetica",
            fontSize=FONT_BODY_SIZE,
            leading=FONT_BODY_LEADING,
            textColor=COLOR_BODY_TEXT,
        )

        self.style_bullet = ParagraphStyle(
            "ResumeBullet",
            fontName="Helvetica",
            fontSize=FONT_BODY_SIZE,
            leading=FONT_BODY_LEADING,
            leftIndent=10,
            firstLineIndent=-7,
            spaceAfter=SPACE_BULLET_BOTTOM,
            textColor=COLOR_BODY_TEXT,
        )

    def _clean_text(self, text: str | None) -> str:
        if not text:
            return ""
        cleaned = re.sub(r"\*\*(.*?)\*\*", r"<b>\\1</b>", text)
        cleaned = cleaned.replace("&", "&amp;")
        cleaned = cleaned.replace("&amp;lt;", "&lt;").replace("&amp;gt;", "&gt;")
        cleaned = cleaned.replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
        cleaned = cleaned.replace("&lt;u&gt;", "<u>").replace("&lt;/u&gt;", "</u>")
        cleaned = cleaned.replace("&lt;font", "<font").replace("&lt;/font&gt;", "</font>")
        cleaned = re.sub(r"color=&#x27;(.*?)&#x27;", r"color=\1", cleaned)
        cleaned = re.sub(r"color=&apos;(.*?)&apos;", r"color=\1", cleaned)
        cleaned = re.sub(r"color=&quot;(.*?)&quot;", r"color=\1", cleaned)
        cleaned = re.sub(r"href=&#x27;(.*?)&#x27;", r"href=\1", cleaned)
        cleaned = re.sub(r"href=&apos;(.*?)&apos;", r"href=\1", cleaned)
        cleaned = re.sub(r"href=&quot;(.*?)&quot;", r"href=\1", cleaned)
        return cleaned

    def render_to_pdf_bytes(self, content: StructuredResumeContent) -> bytes:
        """Alias for render_pdf for endpoint compatibility."""
        return self.render_pdf(content)

    def render_to_bytes(self, content: StructuredResumeContent) -> bytes:
        """Alias for render_pdf for endpoint compatibility."""
        return self.render_pdf(content)

    def render_pdf(self, content: StructuredResumeContent) -> bytes:
        """Render structured resume content to bytes ensuring a crisp 1-page canvas."""
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            leftMargin=PAGE_MARGIN_H,
            rightMargin=PAGE_MARGIN_H,
            topMargin=PAGE_MARGIN_TOP,
            bottomMargin=PAGE_MARGIN_BOTTOM,
        )

        story = []

        # 1. Candidate Name & Contact Line
        full_name = self._clean_text(content.personal.fullName)
        story.append(Paragraph(full_name, self.style_name))

        contact_parts = []
        if content.personal.email:
            email_clean = self._clean_text(content.personal.email)
            contact_parts.append("<a href=\"mailto:" + email_clean + "\">" + email_clean + "</a>")
        if content.personal.phone:
            contact_parts.append(self._clean_text(content.personal.phone))
        loc_parts = [p for p in [content.personal.city, content.personal.country] if p]
        if loc_parts:
            contact_parts.append(self._clean_text(", ".join(loc_parts)))
        if content.personal.linkedin:
            li_url = self._clean_text(content.personal.linkedin)
            contact_parts.append("<a href=\"" + li_url + "\"><u>LinkedIn</u></a>")
        if content.personal.github:
            gh_url = self._clean_text(content.personal.github)
            contact_parts.append("<a href=\"" + gh_url + "\"><u>GitHub</u></a>")
        if getattr(content.personal, "portfolio", None):
            port_url = self._clean_text(content.personal.portfolio)
            contact_parts.append("<a href=\"" + port_url + "\"><u>Portfolio</u></a>")
        contact_line = "  |  ".join(contact_parts)
        story.append(Paragraph(contact_line, self.style_contact))
        story.append(
            HRFlowable(width="100%", thickness=0.6, color=COLOR_DIVIDER_DARK, spaceAfter=SPACE_HEADER_HR_BOTTOM)
        )

        # 2. Professional Summary
        if content.summary:
            story.append(Paragraph("PROFESSIONAL SUMMARY", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            story.append(Paragraph(self._clean_text(content.summary), self.style_body))
            story.append(Spacer(1, SPACE_SECTION_GAP))

        # 3. Education (Structured 2-line layout with clean typographic hierarchy)
        if content.education:
            story.append(Paragraph("EDUCATION", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for edu in content.education:
                deg = self._clean_text(edu.degree)
                inst = self._clean_text(edu.institution)
                dates = self._clean_text(edu.endDate or "")
                grade_str = ("<b>" + self._clean_text(edu.grade) + "</b>") if edu.grade else ""

                table_data = [
                    [
                        Paragraph(f"<b>{deg}</b>", self.style_item_title),
                        Paragraph(dates, self.style_item_date),
                    ],
                    [
                        Paragraph(inst, self.style_item_meta),
                        Paragraph(grade_str, self.style_item_date),
                    ],
                ]
                t = Table(table_data, colWidths=["75%", "25%"])
                t.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.1),
                            ("TOPPADDING", (0, 0), (-1, -1), 0.1),
                        ]
                    )
                )
                story.append(t)
                story.append(Spacer(1, SPACE_EDU_ENTRY_GAP))
            story.append(Spacer(1, max(0, SPACE_SECTION_GAP - SPACE_EDU_ENTRY_GAP)))

        # 4. Technical Skills
        if content.skills:
            story.append(Paragraph("TECHNICAL SKILLS", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for sk_cat in content.skills:
                cat_name = self._clean_text(sk_cat.category)
                items_str = ", ".join(self._clean_text(i) for i in sk_cat.items)
                skill_line = f"<b>{cat_name}:</b> {items_str}"
                story.append(Paragraph(skill_line, self.style_body))
                story.append(Spacer(1, SPACE_SKILL_ROW_GAP))
            story.append(Spacer(1, max(0, SPACE_SECTION_GAP - SPACE_SKILL_ROW_GAP)))

        # 5. Experience (Canonical Professional Experience — Lodestar)
        if content.experience:
            story.append(Paragraph("EXPERIENCE", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for exp in content.experience:
                co = self._clean_text(exp.company)
                title = self._clean_text(exp.title)
                cur_str = "Present" if exp.current else self._clean_text(exp.endDate or "")
                start_str = self._clean_text(exp.startDate or "")
                dates = (start_str + " - " + cur_str) if start_str else cur_str

                table_data = [
                    [
                        Paragraph(f"<b>{title}</b> — {co}", self.style_item_title),
                        Paragraph(dates, self.style_item_date),
                    ]
                ]
                t = Table(table_data, colWidths=["75%", "25%"])
                t.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.1),
                            ("TOPPADDING", (0, 0), (-1, -1), 0.1),
                        ]
                    )
                )
                story.append(t)

                for b in exp.bullets:
                    b_text = "•  " + self._clean_text(b.text)
                    story.append(Paragraph(b_text, self.style_bullet))
                story.append(Spacer(1, SPACE_PROJECT_GAP))
            story.append(Spacer(1, max(0, SPACE_SECTION_GAP - SPACE_PROJECT_GAP)))

        # 6. Technical Projects (Clean single-line header with inline tech stack)
        if content.projects:
            story.append(Paragraph("TECHNICAL PROJECTS", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for proj in content.projects:
                p_name = self._clean_text(proj.name)
                tech_items = ", ".join(self._clean_text(t) for t in proj.technologies) if proj.technologies else ""
                tech_str = (" | " + tech_items) if tech_items else ""
                header_text = f"<b>{p_name}</b><font color=#475569>{tech_str}</font>"

                if proj.url:
                    url_clean = self._clean_text(proj.url)
                    url_display = url_clean.replace("https://", "").replace("http://", "").rstrip("/")
                    url_link = "<a href=\"" + url_clean + "\"><u>" + url_display + "</u></a>"
                    table_data = [
                        [
                            Paragraph(header_text, self.style_item_title),
                            Paragraph(url_link, self.style_item_date),
                        ]
                    ]
                    t = Table(table_data, colWidths=["85%", "15%"])
                    t.setStyle(
                        TableStyle(
                            [
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.1),
                                ("TOPPADDING", (0, 0), (-1, -1), 0.1),
                            ]
                        )
                    )
                    story.append(t)
                else:
                    story.append(Paragraph(header_text, self.style_item_title))

                for b in proj.bullets:
                    b_text = "•  " + self._clean_text(b.text)
                    story.append(Paragraph(b_text, self.style_bullet))
                story.append(Spacer(1, SPACE_PROJECT_GAP))
            story.append(Spacer(1, max(0, SPACE_SECTION_GAP - SPACE_PROJECT_GAP)))

        # 7. Courses & Certifications
        if getattr(content, "course_certifications", None):
            story.append(Paragraph("COURSES &amp; CERTIFICATIONS", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for cert in content.course_certifications:
                title = self._clean_text(cert.title)
                year_str = self._clean_text(cert.completionYear or "")

                header_title = f"<b>{title}</b>"
                meta_parts = []
                if cert.provider:
                    meta_parts.append(self._clean_text(cert.provider))
                if getattr(cert, "instructor", None):
                    meta_parts.append(f"Instructor: {self._clean_text(cert.instructor)}")
                if meta_parts:
                    header_title += f" — <font color=#475569>{' | '.join(meta_parts)}</font>"

                right_parts = []
                if year_str:
                    right_parts.append(year_str)
                if cert.certificateUrl:
                    url_clean = self._clean_text(cert.certificateUrl)
                    right_parts.append(f'<a href="{url_clean}"><u>Certificate</u></a>')
                right_text = " | ".join(right_parts)

                table_data = [
                    [
                        Paragraph(header_title, self.style_item_title),
                        Paragraph(right_text, self.style_item_date),
                    ]
                ]
                t = Table(table_data, colWidths=["75%", "25%"])
                t.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.1),
                            ("TOPPADDING", (0, 0), (-1, -1), 0.1),
                        ]
                    )
                )
                story.append(t)

                if cert.description:
                    desc_text = "•  " + self._clean_text(cert.description)
                    story.append(Paragraph(desc_text, self.style_bullet))
                story.append(Spacer(1, SPACE_PROJECT_GAP))
            story.append(Spacer(1, max(0, SPACE_SECTION_GAP - SPACE_PROJECT_GAP)))

        # 8. Leadership & Activities (Techniva Technical Club)
        leadership_items = getattr(content, "leadership", None) or []
        if leadership_items:
            story.append(Paragraph("LEADERSHIP &amp; ACTIVITIES", self.style_section_title))
            story.append(
                HRFlowable(
                    width="100%", thickness=0.4, color=COLOR_DIVIDER_LIGHT, spaceAfter=SPACE_SECTION_HR_BOTTOM
                )
            )
            for lead in leadership_items:
                co = self._clean_text(lead.company)
                title = self._clean_text(lead.title)
                cur_str = "Present" if lead.current else self._clean_text(lead.endDate or "")
                start_str = self._clean_text(lead.startDate or "")
                dates = (start_str + " - " + cur_str) if start_str else cur_str

                table_data = [
                    [
                        Paragraph(f"<b>{title}</b> — {co}", self.style_item_title),
                        Paragraph(dates, self.style_item_date),
                    ]
                ]
                t = Table(table_data, colWidths=["75%", "25%"])
                t.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.1),
                            ("TOPPADDING", (0, 0), (-1, -1), 0.1),
                        ]
                    )
                )
                story.append(t)

                for b in lead.bullets:
                    b_text = "•  " + self._clean_text(b.text)
                    story.append(Paragraph(b_text, self.style_bullet))
                story.append(Spacer(1, SPACE_PROJECT_GAP))

        doc.build(story)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes


reportlab_renderer = ReportLabResumeRenderer()
