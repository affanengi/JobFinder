"""Source-aware, structure-preserving Job Description Parser and Block Extractor."""

import copy
import html
import logging
import re
from typing import Literal

import lxml.html

from app.schemas.job import JobDescriptionBlock

logger = logging.getLogger("jobFinder.services.job_structure_parser")


class JobStructureParser:
    """Parses raw ATS HTML and structured lists into explicit canonical JobDescriptionBlocks."""

    @staticmethod
    def clean_inline_text(raw: str) -> str:
        """Unescape HTML entities, strip extra spaces, preserve punctuation and colons."""
        if not raw:
            return ""
        text = html.unescape(raw)
        # Normalize whitespace per line
        lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
        return " ".join(line for line in lines if line).strip()

    @classmethod
    def extract_li_items(cls, list_element, indent_level: int = 0) -> list[str]:
        """Recursively extract list items while preserving nested list indentation."""
        results: list[str] = []
        for li in list_element.iterchildren("li"):
            child_lists = li.findall("./ul") + li.findall("./ol")
            if not child_lists:
                text = cls.clean_inline_text(li.text_content())
                if text:
                    indent = "  " * indent_level
                    results.append(f"{indent}{text}" if indent_level > 0 else text)
            else:
                # To prevent child lists from duplicating text in parent li:
                li_copy = copy.deepcopy(li)
                for cl in li_copy.findall("./ul") + li_copy.findall("./ol"):
                    li_copy.remove(cl)
                parent_text = cls.clean_inline_text(li_copy.text_content())
                if parent_text:
                    indent = "  " * indent_level
                    results.append(f"{indent}{parent_text}" if indent_level > 0 else parent_text)
                for cl in child_lists:
                    sub_items = cls.extract_li_items(cl, indent_level=indent_level + 1)
                    results.extend(sub_items)
        return results

    @classmethod
    def parse_element_children(cls, element) -> list[JobDescriptionBlock]:
        """Recursively parse child DOM elements into blocks without duplicating container text."""
        blocks: list[JobDescriptionBlock] = []
        for child in element:
            tag = child.tag.lower() if isinstance(child.tag, str) else ""
            if not tag or tag in ["style", "script", "svg", "noscript", "meta", "iframe"]:
                continue

            if tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                level = int(tag[1])
                text = cls.clean_inline_text(child.text_content())
                if text:
                    blocks.append(JobDescriptionBlock(type="heading", level=level, text=text))
            elif tag == "ul":
                items = cls.extract_li_items(child, indent_level=0)
                if items:
                    blocks.append(JobDescriptionBlock(type="bullet_list", items=items))
            elif tag == "ol":
                items = cls.extract_li_items(child, indent_level=0)
                if items:
                    blocks.append(JobDescriptionBlock(type="ordered_list", items=items))
            elif tag == "p":
                text = cls.clean_inline_text(child.text_content())
                if text:
                    # Check if paragraph is entirely a bold heading (common in Greenhouse/ATS)
                    # e.g., <p><strong>Mission</strong></p> or <p><strong>What we look for:</strong></p>
                    strongs = child.findall(".//strong") + child.findall(".//b")
                    is_heading = False
                    if strongs and len(text) <= 80:
                        strong_text = cls.clean_inline_text(" ".join(s.text_content() for s in strongs))
                        if strong_text == text and not text.endswith("."):
                            is_heading = True

                    if is_heading:
                        blocks.append(JobDescriptionBlock(type="heading", level=3, text=text.rstrip(":")))
                    else:
                        blocks.append(JobDescriptionBlock(type="paragraph", text=text))
            elif tag in ["div", "section", "article", "main", "span"]:
                # Container element: check if it contains block-level children
                has_block_children = any(
                    isinstance(c.tag, str)
                    and c.tag.lower()
                    in [
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                        "h5",
                        "h6",
                        "ul",
                        "ol",
                        "p",
                        "div",
                        "section",
                        "article",
                        "main",
                    ]
                    for c in child
                )
                if has_block_children:
                    blocks.extend(cls.parse_element_children(child))
                else:
                    text = cls.clean_inline_text(child.text_content())
                    if text:
                        blocks.append(JobDescriptionBlock(type="paragraph", text=text))
            else:
                text = cls.clean_inline_text(child.text_content())
                if text and len(text) > 2:
                    blocks.append(JobDescriptionBlock(type="paragraph", text=text))

        return blocks

    def parse_html_to_blocks(self, raw_html: str) -> list[JobDescriptionBlock]:
        """Parse semantic HTML (Greenhouse, Ashby, etc.) into structured blocks."""
        if not raw_html or not raw_html.strip():
            return []

        try:
            # Wrap in root container to handle arbitrary multi-root HTML fragments
            wrapped = f"<div>{raw_html}</div>"
            doc = lxml.html.fragment_fromstring(wrapped)
            return self.parse_element_children(doc)
        except Exception as e:
            logger.warning(f"Error parsing HTML with lxml, falling back to regex: {e}")
            return self.parse_text_to_blocks(raw_html)

    def parse_lever_to_blocks(
        self,
        description_plain: str | None,
        lists: list[dict] | None,
        additional_plain: str | None = None,
        additional_html: str | None = None,
    ) -> list[JobDescriptionBlock]:
        """Parse Lever structured JSON (descriptionPlain, lists, additionalPlain) into blocks."""
        blocks: list[JobDescriptionBlock] = []

        # 1. Preamble paragraphs
        if description_plain and description_plain.strip():
            paras = description_plain.strip().split("\n\n")
            for p in paras:
                clean_p = self.clean_inline_text(p)
                if clean_p:
                    blocks.append(JobDescriptionBlock(type="paragraph", text=clean_p))

        # 2. Structured lists with titles
        for lst in lists or []:
            title = self.clean_inline_text(lst.get("text", ""))
            if title:
                blocks.append(JobDescriptionBlock(type="heading", level=3, text=title))

            content = lst.get("content", "")
            if content and content.strip():
                try:
                    wrapped = f"<div>{content}</div>"
                    doc = lxml.html.fragment_fromstring(wrapped)
                    list_items = [
                        self.clean_inline_text(li.text_content())
                        for li in doc.findall(".//li")
                        if self.clean_inline_text(li.text_content())
                    ]
                    if list_items:
                        blocks.append(JobDescriptionBlock(type="bullet_list", items=list_items))
                except Exception:
                    # Fallback for plain text content in list
                    items = [self.clean_inline_text(line) for line in content.split("\n") if line.strip()]
                    if items:
                        blocks.append(JobDescriptionBlock(type="bullet_list", items=items))

        # 3. Postamble / additional text (prioritize authentic semantic HTML)
        if additional_html and additional_html.strip():
            html_blocks = self.parse_html_to_blocks(additional_html)
            blocks.extend(html_blocks)
        elif additional_plain and additional_plain.strip():
            paras = additional_plain.strip().split("\n\n")
            for p in paras:
                clean_p = self.clean_inline_text(p)
                if clean_p:
                    blocks.append(JobDescriptionBlock(type="paragraph", text=clean_p))

        return blocks

    def parse_text_to_blocks(self, raw_text: str) -> list[JobDescriptionBlock]:
        """Safe fallback for unstructured plain text: split into paragraphs without guessing fake structure."""
        if not raw_text or not raw_text.strip():
            return []

        blocks: list[JobDescriptionBlock] = []
        paras = re.split(r"\n\n+", raw_text.strip())
        for p in paras:
            lines = [l.strip() for l in p.split("\n") if l.strip()]
            if not lines:
                continue
            # If all lines start with bullet markers, treat as bullet list
            if all(line.startswith(("•", "-", "*")) for line in lines):
                cleaned_items = [re.sub(r"^[•\-\*]\s*", "", l).strip() for l in lines]
                blocks.append(JobDescriptionBlock(type="bullet_list", items=cleaned_items))
            else:
                blocks.append(JobDescriptionBlock(type="paragraph", text=" ".join(lines)))

        return blocks

    def blocks_to_clean_text(self, blocks: list[JobDescriptionBlock]) -> str:
        """Deterministically derive clean plaintext with newlines and bullet markers from blocks."""
        parts: list[str] = []
        for b in blocks:
            if b.type == "heading":
                if b.text:
                    parts.append(f"### {b.text}")
            elif b.type == "paragraph":
                if b.text:
                    parts.append(b.text)
            elif b.type == "bullet_list":
                if b.items:
                    parts.append("\n".join(f"• {item}" for item in b.items if item))
            elif b.type == "ordered_list":
                if b.items:
                    parts.append("\n".join(f"{i+1}. {item}" for i, item in enumerate(b.items) if item))

        text = "\n\n".join(p for p in parts if p.strip())
        return re.sub(r"\n{3,}", "\n\n", text).strip()


job_structure_parser = JobStructureParser()
