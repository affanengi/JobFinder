"""Golden Test Dataset for Job Analysis & Truth-Locked Profile Matching.

Includes 5 standardized test JDs:
1. Software Engineering JD (SDK, Fastify, APIs, TypeScript, React)
2. Data Analyst / Data Science JD (Python, SQL, R, Statistics, Dashboarding)
3. QA / Test Automation JD (Test automation, replay harness, bug tracking, Jest/Playwright)
4. Product / Operations JD (Cross-functional communication, roadmap, user metrics, Agile)
5. Malformed or Incomplete JD (Minimal or garbled text, missing sections)
"""

from typing import Any

GOLDEN_SWE_JD: dict[str, Any] = {
    "id": "golden-swe-01",
    "title": "Junior Full Stack Engineer (Browser SDK & Backend)",
    "company": "Nexus Technologies",
    "location": "Remote, India",
    "workMode": "remote",
    "employmentType": "full_time",
    "seniority": "junior",
    "category": "technical",
    "experienceYearsRequired": 1.0,
    "experienceText": "0 - 2 yrs (Fresher OK)",
    "requiredSkills": [
        "TypeScript",
        "JavaScript",
        "React",
        "Node.js",
        "Fastify",
        "REST APIs",
        "SQL",
    ],
    "preferredSkills": [
        "Python",
        "Browser Extensions",
        "Event Pipelines",
        "Docker",
    ],
    "description": """
About Nexus Technologies:
We build high-performance client analytics and developer observability tools.

Role Overview:
We are seeking a Junior Full Stack Engineer to join our core telemetry and web engineering team. In this role, you will help build client-side browser SDKs, optimize event capture, and interface with our Fastify and PostgreSQL event ingestion microservices.

Key Responsibilities:
- Develop, maintain, and test browser-based JavaScript/TypeScript SDKs capturing client events without degrading performance.
- Build clean, resilient RESTful API endpoints using Node.js and Fastify for ingestion pipelines.
- Integrate frontend visualization components in React for internal analytics dashboards.
- Write robust unit tests, load scripts, and synthetic data replay harnesses to ensure pipeline reliability.
- Collaborate with senior engineers on schema design and database queries in SQL/PostgreSQL.

Required Qualifications:
- Bachelor's degree in Computer Science, Information Technology, or related discipline (or equivalent experience).
- 0-2 years of software engineering experience or strong project-based portfolio.
- Proficiency in JavaScript and TypeScript.
- Demonstrated hands-on experience building backend APIs (Node.js, Express, or Fastify).
- Working knowledge of SQL (PostgreSQL, MySQL, or SQLite).
- Understanding of web fundamentals: DOM events, REST architecture, and HTTP protocol.

Preferred Qualifications:
- Familiarity with event batching, session tracking, or synthetic load replay.
- Experience with React, Vite, or modern frontend frameworks.
- Exposure to Python scripting for automation or data tasks.
- Knowledge of PII sanitization or client-side privacy controls.
""",
}

GOLDEN_DATA_JD: dict[str, Any] = {
    "id": "golden-data-02",
    "title": "Junior Data Analyst",
    "company": "DataVibe Analytics",
    "location": "Bengaluru, India",
    "workMode": "hybrid",
    "employmentType": "full_time",
    "seniority": "entry",
    "category": "data",
    "experienceYearsRequired": 0.5,
    "experienceText": "0 - 1 yr",
    "requiredSkills": [
        "Python",
        "SQL",
        "R Programming",
        "Data Analysis",
        "Data Visualization",
    ],
    "preferredSkills": [
        "Tableau",
        "Power BI",
        "Statistical Testing",
        "Time Series Analysis",
    ],
    "description": """
About DataVibe:
DataVibe powers enterprise intelligence through statistical modeling and automated data pipelines.

Role Overview:
We are looking for a motivated Junior Data Analyst to clean, analyze, and visualize complex datasets. You will work directly with our analytics team to extract actionable insights from user sessions, operational telemetry, and structured business records.

Key Responsibilities:
- Extract, clean, and validate data from relational databases using SQL queries.
- Perform exploratory data analysis (EDA), regression, and clustering using Python and R.
- Design interactive data visualizations, dashboards, and metric reports for business stakeholders.
- Investigate anomalies, session transitions, and trend patterns in event data.
- Ensure data integrity, documentation, and reproducibility of analytical scripts.

Required Qualifications:
- Degree in Computer Science, Statistics, Mathematics, or Data Science.
- Strong foundational knowledge of SQL (joins, aggregations, window functions).
- Experience analyzing data using Python (Pandas, NumPy) or R Programming.
- Familiarity with data visualization libraries (Matplotlib, Seaborn, ggplot2).
- Strong analytical mindset and problem-solving ability.

Preferred Qualifications:
- Formal coursework or certification in Data Science, R, or Statistical Analysis.
- Experience analyzing event streams or time-series datasets.
- Knowledge of Excel, Tableau, or Power BI.
""",
}

GOLDEN_QA_JD: dict[str, Any] = {
    "id": "golden-qa-03",
    "title": "QA Automation Engineer (Test Infrastructure)",
    "company": "Reliant Cloud",
    "location": "Remote",
    "workMode": "remote",
    "employmentType": "full_time",
    "seniority": "junior",
    "category": "qa",
    "experienceYearsRequired": 1.0,
    "experienceText": "1 - 2 yrs",
    "requiredSkills": [
        "Test Automation",
        "Python",
        "JavaScript",
        "API Testing",
        "Regression Testing",
    ],
    "preferredSkills": [
        "Playwright",
        "Jest",
        "Synthetic Event Replay",
        "CI/CD Pipelines",
    ],
    "description": """
About Reliant Cloud:
Reliant Cloud provides cloud testing infrastructure and pipeline reliability tools.

Role Overview:
We are seeking a QA Automation Engineer to design, implement, and run automated test suites. You will validate REST APIs, verify data pipelines using synthetic event replay, and safeguard system reliability across releases.

Key Responsibilities:
- Design and execute end-to-end automated test suites for web applications and backend APIs.
- Construct synthetic event seed harnesses to test high-volume ingestion and pipeline failure modes.
- Perform functional, integration, regression, and sanity testing across staging and production environments.
- Track, document, and reproduce defects with detailed root-cause logs.
- Collaborate with software engineers to automate test coverage and continuous verification.

Required Qualifications:
- Experience writing automated tests using Python, JavaScript, or TypeScript.
- Practical experience with API testing (REST, Postman, or automated HTTP clients).
- Solid understanding of test methodologies: unit, integration, regression, and load testing.
- Strong debugging and analytical skills.

Preferred Qualifications:
- Experience building synthetic data generators or load replay harnesses.
- Exposure to browser automation tools like Playwright or Selenium.
- Basic understanding of Fastify, Express, or microservices architecture.
""",
}

GOLDEN_PRODUCT_OPS_JD: dict[str, Any] = {
    "id": "golden-ops-04",
    "title": "Technical Operations & Product Associate",
    "company": "LaunchOps Labs",
    "location": "Hyderabad, India",
    "workMode": "onsite",
    "employmentType": "full_time",
    "seniority": "entry",
    "category": "non_technical",
    "experienceYearsRequired": 0.0,
    "experienceText": "Freshers Welcome",
    "requiredSkills": [
        "Technical Communication",
        "Process Documentation",
        "Cross-Functional Collaboration",
        "Product Operations",
    ],
    "preferredSkills": [
        "SQL Basics",
        "Project Management",
        "Agile Methodologies",
        "Technical Club Leadership",
    ],
    "description": """
About LaunchOps Labs:
LaunchOps empowers high-growth teams with operational workflows and product execution support.

Role Overview:
We are hiring a Technical Operations Associate to streamline product initiatives, organize technical events, manage cross-functional documentation, and coordinate between developers and stakeholders.

Key Responsibilities:
- Coordinate technical tasks, project milestones, and sprint documentation.
- Organize workshops, technical showcases, and community learning sessions.
- Maintain operational runbooks, user onboarding guides, and feedback logs.
- Gather customer feedback, identify workflow bottlenecks, and suggest product enhancements.
- Assist technical leads in resource allocation and communication tracking.

Required Qualifications:
- Bachelor's degree in any discipline (B.Tech / B.E. preferred).
- Exceptional verbal and written English communication skills.
- Demonstrated leadership or extracurricular initiative (e.g., student club leadership or event organization).
- Ability to learn technical concepts quickly and translate them for diverse audiences.

Preferred Qualifications:
- Experience co-founding or leading a technical club or collegiate organization.
- Basic familiarity with technical tools (Git, SQL, or Google Sheets).
""",
}

GOLDEN_MALFORMED_JD: dict[str, Any] = {
    "id": "golden-malformed-05",
    "title": "Hiring Devs!!! urgent req",
    "company": "QuickHire Unknown",
    "location": "",
    "workMode": "remote",
    "employmentType": "full_time",
    "seniority": "entry",
    "category": "technical",
    "experienceYearsRequired": 0.0,
    "experienceText": "",
    "requiredSkills": [],
    "preferredSkills": [],
    "description": "we need immediate joiners for coding. send cv to test@example.com ASAP. python or js good.",
}
