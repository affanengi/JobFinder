"""Unit tests for JobStructureParser: semantic preservation of Greenhouse, Ashby, and Lever structures."""

import pytest
from app.schemas.job import JobDescriptionBlock
from app.services.job_structure_parser import job_structure_parser


CANONICAL_GREENHOUSE_HTML = """
<p>Canonical is a leading provider of open source software and operating systems to the global enterprise.</p>
<p>The company is founder led, profitable and growing. We are hiring an Alliances Field Engineer.</p>
<p>Location: This is a home-based role, we are hiring worldwide.</p>
<h3>What your day will look like</h3>
<ul>
  <li>Understand Ubuntu, Linux, networking and services in real-world environments</li>
  <li>Architect cloud infrastructure solutions like Kubernetes, Kubeflow, OpenStack, Ceph, and Spark</li>
  <li>Architect and integrate popular open source software such as PostgreSQL, MongoDB, Kafka</li>
  <li>Help partners to offer and architect joint solutions utilizing Canonical technologies</li>
  <li>Design and publish joint Reference Architectures and perform technical validations</li>
  <li>Prepare and run onboarding sessions/workshops with various partners teams</li>
</ul>
<p>If you have a passion for the latest open source technologies, you will love the Alliances Engineer role.</p>
<h3>What we are looking for in you</h3>
<ul>
  <li>Extensive experience with Linux (Ubuntu preferred), Kubernetes, Ceph, software automation</li>
  <li>Experience designing and implementing solutions on top of public or private clouds</li>
  <li>Python and bash understanding, troubleshooting skills</li>
  <li>Fluent written and spoken English</li>
  <li>Excellent communication and presentation skills</li>
  <li>High motivation, ability to multi-task and follow-up reliably on commitments</li>
  <li>Interest in customer-facing engagement, including pitching and demonstrating</li>
  <li>Interest in new technologies like LXD, Juju and Snaps</li>
  <li>Ability to travel globally up to 30% of the time</li>
  <li>Degree in Computer Science, Mathematics, Physics or related technical field experience</li>
</ul>
<h3>What we offer you</h3>
<p>We consider geographical location, experience, and performance in shaping compensation worldwide. We revisit compensation annually to ensure we recognise outstanding performance. In addition to base pay, we offer a performance-driven annual bonus.</p>
<ul>
  <li>Distributed work environment with twice-yearly team sprints in person - we have been working remotely since 2004!</li>
  <li>Personal learning and development budget of USD 2,000 per year</li>
  <li>Annual compensation review</li>
  <li>Recognition rewards</li>
  <li>Annual holiday leave</li>
  <li>Maternity and paternity leave</li>
  <li>Employee Assistance Programme</li>
  <li>Opportunity to travel to new locations to meet colleagues from your team and others</li>
  <li>Priority Pass for travel and travel upgrades for long flights</li>
</ul>
<h3>About Canonical</h3>
<p>Canonical is a pioneering tech firm that is at the forefront of the global move to open source.</p>
"""


def test_greenhouse_exact_heading_and_order_preservation():
    """Verify exact heading titles, section sequence, and paragraph vs bullet preservation."""
    blocks = job_structure_parser.parse_html_to_blocks(CANONICAL_GREENHOUSE_HTML)

    headings = [b for b in blocks if b.type == "heading"]
    assert len(headings) == 4
    assert headings[0].text == "What your day will look like"
    assert headings[1].text == "What we are looking for in you"
    assert headings[2].text == "What we offer you"
    assert headings[3].text == "About Canonical"

    # Verify no heading was truncated or suffered word-stranding
    assert "in you" not in [b.text for b in blocks if b.type == "paragraph" and b.text and b.text.startswith("in you")]
    assert "you" not in [b.text for b in blocks if b.type == "paragraph" and b.text and b.text.startswith("you ")]


def test_greenhouse_bullet_counts_and_order():
    """Verify exact bullet item counts, text preservation, and sequence."""
    blocks = job_structure_parser.parse_html_to_blocks(CANONICAL_GREENHOUSE_HTML)

    bullet_lists = [b for b in blocks if b.type == "bullet_list"]
    assert len(bullet_lists) == 3

    # Day list: exactly 6 bullets
    day_list = bullet_lists[0]
    assert len(day_list.items) == 6
    assert day_list.items[0].startswith("Understand Ubuntu, Linux")
    assert day_list.items[-1].startswith("Prepare and run onboarding")

    # Looking for in you: exactly 10 bullets
    look_list = bullet_lists[1]
    assert len(look_list.items) == 10
    assert look_list.items[0].startswith("Extensive experience with Linux")
    assert look_list.items[-1].startswith("Degree in Computer Science")

    # What we offer you: exactly 9 bullets
    offer_list = bullet_lists[2]
    assert len(offer_list.items) == 9
    assert offer_list.items[0].startswith("Distributed work environment")
    assert offer_list.items[-1].startswith("Priority Pass for travel")


def test_greenhouse_compensation_paragraph_not_split():
    """Verify compensation paragraph under What we offer you remains an intact paragraph."""
    blocks = job_structure_parser.parse_html_to_blocks(CANONICAL_GREENHOUSE_HTML)

    # Find the index of What we offer you heading
    offer_idx = next(i for i, b in enumerate(blocks) if b.type == "heading" and b.text == "What we offer you")

    # The next block MUST be the intact paragraph, NOT a bullet list
    next_block = blocks[offer_idx + 1]
    assert next_block.type == "paragraph"
    assert next_block.text.startswith("We consider geographical location")
    assert "In addition to base pay" in next_block.text

    # The block following that MUST be the bullet list
    following_block = blocks[offer_idx + 2]
    assert following_block.type == "bullet_list"
    assert len(following_block.items) == 9


def test_nested_containers_no_content_duplication():
    """Verify nested <div>, <section>, and inline tags do not duplicate text."""
    nested_html = """
    <div class="outer-section">
      <section class="inner-wrapper">
        <h3>Team Mission</h3>
        <p>Build the next generation <strong>cloud platform</strong> with zero friction.</p>
        <div class="list-container">
          <ul>
            <li>High throughput processing</li>
            <li>Zero latency guarantee</li>
          </ul>
        </div>
      </section>
    </div>
    """
    blocks = job_structure_parser.parse_html_to_blocks(nested_html)
    assert len(blocks) == 3
    assert blocks[0].type == "heading"
    assert blocks[0].text == "Team Mission"
    assert blocks[1].type == "paragraph"
    assert blocks[1].text == "Build the next generation cloud platform with zero friction."
    assert blocks[2].type == "bullet_list"
    assert blocks[2].items == ["High throughput processing", "Zero latency guarantee"]


def test_nested_list_indentation_preservation():
    """Verify nested list items are indented without duplicating parent li text."""
    nested_list_html = """
    <ul>
      <li>Core backend systems
        <ul>
          <li>FastAPI services</li>
          <li>Database migrations</li>
        </ul>
      </li>
      <li>Frontend interfaces</li>
    </ul>
    """
    blocks = job_structure_parser.parse_html_to_blocks(nested_list_html)
    assert len(blocks) == 1
    assert blocks[0].type == "bullet_list"
    items = blocks[0].items
    assert len(items) == 4
    assert items[0] == "Core backend systems"
    assert items[1] == "  FastAPI services"
    assert items[2] == "  Database migrations"
    assert items[3] == "Frontend interfaces"


def test_lever_structured_list_extraction():
    """Verify Lever intro paragraphs and structured list mapping."""
    desc_plain = "About Meesho\n\nWe are democratizing internet commerce in India."
    lists = [
        {
            "text": "What you will do",
            "content": "<li>Lead end to end feature development</li><li>Architect clean services</li>",
        },
        {
            "text": "What you will need",
            "content": "<li>3+ years Python experience</li><li>Strong problem solving</li>",
        },
    ]
    additional = "We are an equal opportunity employer."

    blocks = job_structure_parser.parse_lever_to_blocks(desc_plain, lists, additional)
    assert len(blocks) == 7
    assert blocks[0].type == "paragraph"
    assert blocks[0].text == "About Meesho"
    assert blocks[1].type == "paragraph"
    assert blocks[1].text == "We are democratizing internet commerce in India."
    assert blocks[2].type == "heading"
    assert blocks[2].text == "What you will do"
    assert blocks[3].type == "bullet_list"
    assert len(blocks[3].items) == 2
    assert blocks[4].type == "heading"
    assert blocks[4].text == "What you will need"
    assert blocks[5].type == "bullet_list"
    assert len(blocks[5].items) == 2
    assert blocks[6].type == "paragraph"
    assert blocks[6].text == "We are an equal opportunity employer."


def test_blocks_to_clean_text_synchronization():
    """Verify derived plaintext is in 100% deterministic sync with blocks."""
    blocks = [
        JobDescriptionBlock(type="heading", level=3, text="What your day will look like"),
        JobDescriptionBlock(type="bullet_list", items=["Task A", "Task B"]),
        JobDescriptionBlock(type="paragraph", text="Closing statement for the team."),
    ]
    derived_text = job_structure_parser.blocks_to_clean_text(blocks)
    expected = "### What your day will look like\n\n• Task A\n• Task B\n\nClosing statement for the team."
    assert derived_text == expected


def test_databricks_bold_paragraphs_parsed_as_headings():
    """Verify Greenhouse rich-text bold paragraphs are recognized as authentic headings."""
    html_content = """
    <p>Req: FEQ227R196<br>Location: Tokyo, Japan</p>
    <p><strong>Mission</strong></p>
    <p>The AI Forward Deployed Engineering team is a specialized team.</p>
    <p><strong>The impact you will have:</strong></p>
    <ul>
      <li>Develop cutting-edge GenAI solutions</li>
      <li>Own production rollouts</li>
    </ul>
    <p><strong>What we look for:</strong></p>
    <ul>
      <li>Experience building GenAI applications</li>
      <li>Expertise in deploying production-grade apps</li>
    </ul>
    <div class="content-conclusion">
      <p><strong>About Databricks</strong></p>
      <p>Databricks is the Data and AI company.</p>
    </div>
    """
    blocks = job_structure_parser.parse_html_to_blocks(html_content)
    headings = [b.text for b in blocks if b.type == "heading"]
    assert "Mission" in headings
    assert "The impact you will have" in headings
    assert "What we look for" in headings
    assert "About Databricks" in headings

    # Long bold text should NOT become a heading
    long_bold = "<p><strong>" + ("A" * 90) + "</strong></p>"
    long_blocks = job_structure_parser.parse_html_to_blocks(long_bold)
    assert long_blocks[0].type == "paragraph"


def test_lever_additional_html_structure_preservation():
    """Verify Lever additional HTML extracts headings and bullet lists rather than clustering into one paragraph."""
    add_html = """
    <div>
      <h3><strong>About us&nbsp;</strong></h3>
      <p>Welcome to Meesho, where every story begins with a spark of inspiration.</p>
      <h3><strong>Our Mission</strong></h3>
      <p>Democratising internet commerce for everyone.</p>
      <h3><strong>Culture and Total Rewards</strong></h3>
      <p>Our focus is on cultivating a dynamic workplace.</p>
      <ul>
        <li>Equal Opportunity for all</li>
        <li>Accessible Workplace with amenities</li>
      </ul>
    </div>
    """
    blocks = job_structure_parser.parse_lever_to_blocks(
        description_plain="Preamble text",
        lists=[{"text": "What you will do", "content": "<li>Build awesome software</li>"}],
        additional_plain="Fallback plain text",
        additional_html=add_html,
    )
    headings = [b.text for b in blocks if b.type == "heading"]
    assert "What you will do" in headings
    assert "About us" in headings
    assert "Our Mission" in headings
    assert "Culture and Total Rewards" in headings

    bullets = [b for b in blocks if b.type == "bullet_list"]
    assert len(bullets) == 2  # 1 from lists, 1 from additional_html
    assert bullets[1].items == ["Equal Opportunity for all", "Accessible Workplace with amenities"]


def test_greenhouse_custom_domain_url_extraction():
    """Verify GreenhouseAdapter can extract job_id and slug from custom career site URLs."""
    from app.sources.greenhouse import GreenhouseAdapter
    adapter = GreenhouseAdapter()

    # 1. Custom domain with gh_jid query param
    slug, job_id = adapter.extract_slug_and_id_from_url(
        "https://databricks.com/company/careers/open-positions/job?gh_jid=8569392002"
    )
    assert slug == "databricks"
    assert job_id == "8569392002"

    # 2. Standard board URL
    slug, job_id = adapter.extract_slug_and_id_from_url(
        "https://boards.greenhouse.io/canonical/jobs/748392"
    )
    assert slug == "canonical"
    assert job_id == "748392"
