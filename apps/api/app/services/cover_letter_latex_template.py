"""Controlled Standalone ATS Cover Letter LaTeX Template Generator."""

from app.schemas.cover_letter import CoverLetterContent


class CoverLetterLatexEngine:
    """Transforms CoverLetterContent into clean, Overleaf-compatible standalone LaTeX."""

    def _escape(self, text: str | None) -> str:
        if not text:
            return ""
        s = text
        s = s.replace("\\", "\\textbackslash{}")
        s = s.replace("&", "\\&")
        s = s.replace("%", "\\%")
        s = s.replace("$", "\\$")
        s = s.replace("#", "\\#")
        s = s.replace("_", "\\_")
        s = s.replace("{", "\\{")
        s = s.replace("}", "\\}")
        s = s.replace("~", "\\textasciitilde{}")
        s = s.replace("^", "\\textasciicircum{}")
        return s.strip()

    def generate_latex(self, content: CoverLetterContent) -> str:
        """Generate clean, standalone LaTeX code suitable for Overleaf and pdflatex."""
        full_name = self._escape(content.fullName or "Candidate")
        email = self._escape(content.email or "")
        phone = self._escape(content.phone or "")
        linkedin = self._escape(content.linkedin or "")
        github = self._escape(content.github or "")
        city = self._escape(content.city or "")
        country = self._escape(content.country or "India")
        location_line = f"{city}, {country}" if city else country

        contact_items = []
        if email:
            contact_items.append(f"\\href{{mailto:{email}}}{{{email}}}")
        if phone:
            contact_items.append(phone)
        if linkedin:
            contact_items.append(f"\\href{{{linkedin}}}{{LinkedIn}}")
        if github:
            contact_items.append(f"\\href{{{github}}}{{GitHub}}")

        contact_line = " $|$ ".join(contact_items)

        date_str = self._escape(content.date)
        recipient = self._escape(content.recipientName)
        company = self._escape(content.companyName)
        job_title = self._escape(content.jobTitle)
        greeting = self._escape(content.greeting)
        if not greeting.endswith(","):
            greeting += ","
        subject_line = self._escape(content.subject or f"Application for {job_title}")
        
        p1 = self._escape(content.paragraph1_hook)
        p2 = self._escape(content.paragraph2_evidence)
        p3 = self._escape(content.paragraph3_impact)
        signoff = self._escape(content.signOff or "Sincerely,")
        if not signoff.endswith(","):
            signoff += ","

        latex_doc = f"""\\documentclass[letterpaper,10pt]{{article}}

\\usepackage[empty]{{fullpage}}
\\usepackage{{hyperref}}
\\usepackage{{titlesec}}
\\usepackage{{setspace}}
\\usepackage{{tabularx}}

\\hypersetup{{
    colorlinks=true,
    urlcolor=black,
    linkcolor=black
}}

\\pagestyle{{empty}}
\\setlength{{\\parindent}}{{0pt}}
\\setlength{{\\parskip}}{{10pt}}

\\begin{{document}}

%----------HEADER (CENTERED)----------
\\begin{{center}}
    {{\\Large \\textbf{{{full_name}}}}} \\[3pt]
    {location_line} \\[2pt]
    \\small {contact_line}
\\end{{center}}

\\vspace{{12pt}}

%----------DATE & RECIPIENT----------
\\begin{{tabular*}}{{\\textwidth}}[t]{{l@{{\\extracolsep{{\\fill}}}}r}}
    \\textbf{{{recipient}}} & \\textbf{{{date_str}}} \\
    {company} & \\
\\end{{tabular*}}

\\vspace{{10pt}}

%----------SALUTATION & SUBJECT----------
{greeting} \\[6pt]
\\textbf{{Subject: {subject_line}}}

%----------BODY PARAGRAPHS----------
{p1}

{p2}

{p3}

\\vspace{{10pt}}

%----------CLOSING----------
{signoff} \\[24pt]
\\textbf{{{full_name}}}

\\end{{document}}
"""
        return latex_doc


cover_letter_latex_engine = CoverLetterLatexEngine()
