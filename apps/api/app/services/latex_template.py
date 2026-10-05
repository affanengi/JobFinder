"""Controlled Single-Column ATS LaTeX Template Generator."""

from app.schemas.resume import StructuredResumeContent


class LatexTemplateEngine:
    """Transforms validated StructuredResumeContent into clean, ATS-compliant LaTeX code."""

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

    def generate_latex(self, resume: StructuredResumeContent) -> str:
        """Generate clean, standalone LaTeX code suitable for Overleaf and pdflatex."""
        p = resume.personal
        full_name = self._escape(p.fullName or "Candidate")
        email = self._escape(p.email or "")
        phone = self._escape(p.phone or "")
        github = self._escape(p.github or "")
        linkedin = self._escape(p.linkedin or "")

        # Clean contact line: Email | Phone | LinkedIn | GitHub (No location)
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

        # 1. Summary block
        summary_text = self._escape(resume.summary)

        # 2. Education block (All verified institutions with academic grades/percentages)
        edu_blocks = []
        for edu in resume.education:
            inst = self._escape(edu.institution)
            deg = self._escape(edu.degree)
            end_date = self._escape(edu.endDate or "")
            grade_part = f" $|$ \\emph{{{self._escape(edu.grade)}}}" if edu.grade else ""
            edu_code = f"""    \\resumeSubheading
        {{{deg}{grade_part}}}{{{end_date}}}
        {{{inst}}}{{}}"""
            edu_blocks.append(edu_code)
        education_block = "\n".join(edu_blocks)
        # 3. Technical skills block
        skills_lines = []
        for cat in resume.skills:
            cat_name = self._escape(cat.category)
            items_str = ", ".join(self._escape(i) for i in cat.items)
            skills_lines.append(f"    \\textbf{{{cat_name}}}: {items_str} \\\\")
        skills_block = "\n".join(skills_lines)

        # 4. Projects block (Single-line project heading with clean tech tags)
        project_blocks = []
        for proj in resume.projects:
            p_name = self._escape(proj.name)
            tech_str = (
                ", ".join(self._escape(t) for t in proj.technologies) if proj.technologies else ""
            )
            header_right = f"$|$ \\emph{{{tech_str}}}" if tech_str else ""
            proj_url = self._escape(proj.url or "")
            if proj_url:
                proj_url = f"\\href{{{proj_url}}}{{Link}}"

            bullet_items = "\n".join(f"        \\item {self._escape(b.text)}" for b in proj.bullets)

            p_code = f"""    \\resumeProjectHeading
        {{\\textbf{{{p_name}}} {header_right}}}{{{proj_url}}}
        \\resumeItemListStart
{bullet_items}
        \\resumeItemListEnd"""
            project_blocks.append(p_code)
        projects_block = "\n".join(project_blocks)

        # 5. Experience block (Canonical Professional Experience — Lodestar)
        experience_block = ""
        if resume.experience:
            experience_blocks = []
            for exp in resume.experience:
                co = self._escape(exp.company)
                title = self._escape(exp.title)
                dates = f"{self._escape(exp.startDate)} - {'Present' if exp.current else self._escape(exp.endDate)}"
                loc = self._escape(exp.location or "")

                exp_bullets = "\n".join(
                    f"        \\item {self._escape(b.text)}" for b in exp.bullets
                )
                exp_code = f"""    \\resumeSubheading
        {{{title}}}{{{dates}}}
        {{{co}}}{{{loc}}}
        \\resumeItemListStart
{exp_bullets}
        \\resumeItemListEnd"""
                experience_blocks.append(exp_code)

            exp_inner = "\n".join(experience_blocks)
            experience_block = f"""%-----------EXPERIENCE-----------
\\section{{Experience}}
  \\resumeItemListStart
{exp_inner}
  \\resumeItemListEnd"""

        # 6. Courses & Certifications block
        courses_block = ""
        if getattr(resume, "course_certifications", None):
            course_items = []
            for c in resume.course_certifications:
                c_title = self._escape(c.title)
                c_year = self._escape(c.completionYear or "")
                c_desc = self._escape(c.description or "")
                c_url = self._escape(c.certificateUrl or "")
                link_str = f"\\href{{{c_url}}}{{Certificate}}" if c_url else ""

                heading_left = f"\\textbf{{{c_title}}}"
                meta_parts = []
                if c.provider:
                    meta_parts.append(self._escape(c.provider))
                if getattr(c, "instructor", None):
                    meta_parts.append(f"Instructor: {self._escape(c.instructor)}")
                if meta_parts:
                    heading_left += f" $|$ \\emph{{{', '.join(meta_parts)}}}"
                if c_year:
                    heading_left += f" $|$ \\emph{{{c_year}}}"

                if c_desc:
                    c_code = f"""    \\resumeProjectHeading
        {{{heading_left}}}{{{link_str}}}
        \\resumeItemListStart
        \\item \\small{{{c_desc}}}
        \\resumeItemListEnd"""
                else:
                    c_code = f"""    \\resumeProjectHeading
        {{{heading_left}}}{{{link_str}}}"""
                course_items.append(c_code)

            c_inner = "\n".join(course_items)
            courses_block = f"""%-----------COURSES & CERTIFICATIONS-----------
\\section{{Courses \\& Certifications}}
  \\resumeItemListStart
{c_inner}
  \\resumeItemListEnd"""

        # 7. Leadership & Activities block (Techniva Technical Club)
        leadership_block = ""
        if getattr(resume, "leadership", None):
            leadership_blocks = []
            for lead in resume.leadership:
                co = self._escape(lead.company)
                title = self._escape(lead.title)
                dates = f"{self._escape(lead.startDate)} - {'Present' if lead.current else self._escape(lead.endDate)}"
                loc = self._escape(lead.location or "")

                lead_bullets = "\n".join(
                    f"        \\item {self._escape(b.text)}" for b in lead.bullets
                )
                lead_code = f"""    \\resumeSubheading
        {{{title}}}{{{dates}}}
        {{{co}}}{{{loc}}}
        \\resumeItemListStart
{lead_bullets}
        \\resumeItemListEnd"""
                leadership_blocks.append(lead_code)

            lead_inner = "\n".join(leadership_blocks)
            leadership_block = f"""%-----------LEADERSHIP & ACTIVITIES-----------
\\section{{Leadership \\& Activities}}
  \\resumeItemListStart
{lead_inner}
  \\resumeItemListEnd"""

        latex_document = f"""\\documentclass[letterpaper,10pt]{{article}}

\\usepackage{{latexsym}}
\\usepackage[empty]{{fullpage}}
\\usepackage{{titlesec}}
\\usepackage{{marvosym}}
\\usepackage[usenames,dvipsnames]{{color}}
\\usepackage{{verbatim}}
\\usepackage{{enumitem}}
\\usepackage[hidelinks]{{hyperref}}
\\usepackage{{fancyhdr}}
\\usepackage[english]{{babel}}
\\usepackage{{tabularx}}

\\pagestyle{{fancy}}
\\fancyhf{{}}
\\renewcommand{{\\headrulewidth}}{{0pt}}
\\renewcommand{{\\footrulewidth}}{{0pt}}

\\addtolength{{\\oddsidemargin}}{{-0.5in}}
\\addtolength{{\\evensidemargin}}{{-0.5in}}
\\addtolength{{\\textwidth}}{{1in}}
\\addtolength{{\\topmargin}}{{-0.5in}}
\\addtolength{{\\textheight}}{{1.0in}}

\\urlstyle{{same}}
\\raggedbottom
\\raggedright
\\setlength{{\\tabcolsep}}{{0in}}

\\titleformat{{\\section}}{{
  \\vspace{{-4pt}}\\scshape\\raggedright\\large
}}{{}}{{0em}}{{}}[\\color{{black}}\\titlerule \\vspace{{-5pt}}]

\\newcommand{{\\resumeItem}}[1]{{
  \\item\\small{{
    {{#1 \\vspace{{-2pt}}}}
  }}
}}

\\newcommand{{\\resumeSubheading}}[4]{{
  \\vspace{{-2pt}}\\item
    \\begin{{tabular*}}{{0.97\\textwidth}}[t]{{l@{{\\extracolsep{{\\fill}}}}r}}
      \\textbf{{#1}} & #2 \\\\
      \\textit{{\\small#3}} & \\textit{{\\small #4}} \\\\
    \\end{{tabular*}}\\vspace{{-7pt}}
}}

\\newcommand{{\\resumeProjectHeading}}[2]{{
  \\vspace{{-2pt}}\\item
    \\begin{{tabular*}}{{0.97\\textwidth}}[t]{{l@{{\\extracolsep{{\\fill}}}}r}}
      #1 & \\small#2 \\\\
    \\end{{tabular*}}\\vspace{{-7pt}}
}}

\\newcommand{{\\resumeItemListStart}}{{\\begin{{itemize}}[leftmargin=0.15in, label={{\\tiny$\\bullet$}}]}}
\\newcommand{{\\resumeItemListEnd}}{{\\end{{itemize}}\\vspace{{-5pt}}}}

\\begin{{document}}

%----------HEADING----------
\\begin{{center}}
    \\textbf{{\\Huge \\scshape {full_name}}} \\\\ \\vspace{{3pt}}
    \\small {contact_line}
\\end{{center}}

%-----------SUMMARY-----------
\\section{{Professional Summary}}
    \\small{{{summary_text}}}

%-----------EDUCATION-----------
\\section{{Education}}
  \\resumeItemListStart
{education_block}
  \\resumeItemListEnd

%-----------TECHNICAL SKILLS-----------
\\section{{Technical Skills}}
 \\begin{{itemize}}[leftmargin=0.15in, label={{}}]
    \\small{{\\item{{
{skills_block}
    }}}}
 \\end{{itemize}}

{experience_block}

%-----------PROJECTS-----------
\\section{{Technical Projects}}
    \\resumeItemListStart
{projects_block}
    \\resumeItemListEnd

{courses_block}

{leadership_block}

\\end{{document}}
"""
        return latex_document


latex_engine = LatexTemplateEngine()
