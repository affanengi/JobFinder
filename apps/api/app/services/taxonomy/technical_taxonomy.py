"""
Deterministic ATS Technical Taxonomy & Entity Normalization Engine (v1.0.0).
Provides standard categorization, aliases, canonicalization, action verbs,
weak phrasing detection, and metric extraction.
"""

from __future__ import annotations
import re
from typing import Dict, List, Set, Any, Optional, Tuple

TAXONOMY_VERSION = "1.0.0"

# 10 Domain Taxonomies with Canonical IDs, Aliases, and Importance Weights
TAXONOMY: Dict[str, List[Dict[str, Any]]] = {
    "programming_languages": [
        {"id": "python", "name": "Python", "aliases": ["python", "python3", "py"], "weight": 1.0},
        {"id": "typescript", "name": "TypeScript", "aliases": ["typescript", "ts"], "weight": 1.0},
        {"id": "javascript", "name": "JavaScript", "aliases": ["javascript", "js", "ecmascript", "es6", "es6+"], "weight": 1.0},
        {"id": "java", "name": "Java", "aliases": ["java", "core java", "java 8", "java 11", "java 17", "java 21"], "weight": 1.0},
        {"id": "golang", "name": "Go / Golang", "aliases": ["go", "golang"], "weight": 1.0},
        {"id": "cpp", "name": "C++", "aliases": ["c++", "cpp", "c/c++"], "weight": 1.0},
        {"id": "csharp", "name": "C#", "aliases": ["c#", "csharp", ".net c#"], "weight": 1.0},
        {"id": "c", "name": "C", "aliases": ["c language", "ansi c"], "weight": 0.9},
        {"id": "rust", "name": "Rust", "aliases": ["rust", "rustlang"], "weight": 1.0},
        {"id": "kotlin", "name": "Kotlin", "aliases": ["kotlin"], "weight": 0.9},
        {"id": "swift", "name": "Swift", "aliases": ["swift", "swiftui"], "weight": 0.9},
        {"id": "ruby", "name": "Ruby", "aliases": ["ruby"], "weight": 0.8},
        {"id": "php", "name": "PHP", "aliases": ["php", "php7", "php8"], "weight": 0.8},
        {"id": "sql", "name": "SQL", "aliases": ["sql", "ansi sql", "structured query language"], "weight": 1.0},
        {"id": "r", "name": "R", "aliases": ["r language", "r programming"], "weight": 0.8},
        {"id": "scala", "name": "Scala", "aliases": ["scala"], "weight": 0.9},
        {"id": "bash", "name": "Bash / Shell", "aliases": ["bash", "shell scripting", "shell", "zsh", "sh"], "weight": 0.8},
        {"id": "html_css", "name": "HTML5 / CSS3", "aliases": ["html", "html5", "css", "css3"], "weight": 0.8},
    ],
    "frameworks_libraries": [
        {"id": "react", "name": "React", "aliases": ["react", "react.js", "reactjs"], "weight": 1.0},
        {"id": "nextjs", "name": "Next.js", "aliases": ["next.js", "nextjs", "next"], "weight": 1.0},
        {"id": "vue", "name": "Vue.js", "aliases": ["vue", "vue.js", "vuejs", "vue3", "nuxt", "nuxtjs"], "weight": 0.9},
        {"id": "angular", "name": "Angular", "aliases": ["angular", "angularjs", "angular 2+"], "weight": 0.9},
        {"id": "node", "name": "Node.js", "aliases": ["node", "node.js", "nodejs"], "weight": 1.0},
        {"id": "express", "name": "Express.js", "aliases": ["express", "express.js", "expressjs"], "weight": 0.9},
        {"id": "fastapi", "name": "FastAPI", "aliases": ["fastapi", "fast-api"], "weight": 1.0},
        {"id": "django", "name": "Django", "aliases": ["django", "django rest framework", "drf"], "weight": 1.0},
        {"id": "flask", "name": "Flask", "aliases": ["flask"], "weight": 0.9},
        {"id": "springboot", "name": "Spring Boot", "aliases": ["spring boot", "spring", "spring framework", "spring cloud"], "weight": 1.0},
        {"id": "dotnet", "name": ".NET Core", "aliases": [".net", ".net core", "asp.net", "asp.net core", "dotnet"], "weight": 1.0},
        {"id": "graphql", "name": "GraphQL", "aliases": ["graphql", "apollo", "apollo graphql"], "weight": 0.9},
        {"id": "pytorch", "name": "PyTorch", "aliases": ["pytorch", "torch"], "weight": 1.0},
        {"id": "tensorflow", "name": "TensorFlow", "aliases": ["tensorflow", "tf", "keras"], "weight": 1.0},
        {"id": "scikit_learn", "name": "Scikit-Learn", "aliases": ["scikit-learn", "sklearn", "scikit learn"], "weight": 0.9},
        {"id": "pandas", "name": "Pandas", "aliases": ["pandas"], "weight": 0.9},
        {"id": "numpy", "name": "NumPy", "aliases": ["numpy"], "weight": 0.8},
        {"id": "tailwindcss", "name": "Tailwind CSS", "aliases": ["tailwind", "tailwindcss", "tailwind-css"], "weight": 0.8},
        {"id": "redux", "name": "Redux / State Management", "aliases": ["redux", "redux toolkit", "rtk", "zustand", "mobx"], "weight": 0.8},
        {"id": "langchain", "name": "LangChain / LlamaIndex", "aliases": ["langchain", "llamaindex", "langgraph"], "weight": 0.9},
        {"id": "transformers", "name": "Hugging Face Transformers", "aliases": ["hugging face", "huggingface", "transformers"], "weight": 0.9},
        {"id": "framer_motion", "name": "Framer Motion", "aliases": ["framer motion", "framermotion", "framer"], "weight": 0.8},
        {"id": "shadcn_ui", "name": "shadcn/ui", "aliases": ["shadcn/ui", "shadcn", "shadcnui"], "weight": 0.8},
    ],
    "cloud_infrastructure": [
        {"id": "aws", "name": "Amazon Web Services (AWS)", "aliases": ["aws", "amazon web services", "ec2", "s3", "lambda", "ecs", "eks", "rds", "cloudwatch", "iam"], "weight": 1.0},
        {"id": "gcp", "name": "Google Cloud Platform (GCP)", "aliases": ["gcp", "google cloud", "google cloud platform", "bigquery", "cloud run", "gke", "cloud storage"], "weight": 1.0},
        {"id": "azure", "name": "Microsoft Azure", "aliases": ["azure", "microsoft azure", "azure devops", "blob storage", "aks"], "weight": 1.0},
        {"id": "kubernetes", "name": "Kubernetes (K8s)", "aliases": ["kubernetes", "k8s", "helm", "kube"], "weight": 1.0},
        {"id": "docker", "name": "Docker / Containers", "aliases": ["docker", "containerization", "containers", "dockerfile", "docker-compose"], "weight": 1.0},
        {"id": "terraform", "name": "Terraform / IaC", "aliases": ["terraform", "iac", "infrastructure as code", "terragrunt", "pulumi"], "weight": 1.0},
        {"id": "serverless", "name": "Serverless Computing", "aliases": ["serverless", "aws lambda", "cloud functions", "azure functions"], "weight": 0.9},
    ],
    "databases_storage": [
        {"id": "postgresql", "name": "PostgreSQL", "aliases": ["postgresql", "postgres", "psql"], "weight": 1.0},
        {"id": "mysql", "name": "MySQL", "aliases": ["mysql", "mariadb"], "weight": 0.9},
        {"id": "mongodb", "name": "MongoDB", "aliases": ["mongodb", "mongo", "nosql mongodb"], "weight": 0.9},
        {"id": "redis", "name": "Redis / Caching", "aliases": ["redis", "memcached", "in-memory cache", "caching"], "weight": 0.9},
        {"id": "dynamodb", "name": "Amazon DynamoDB", "aliases": ["dynamodb", "dynamo"], "weight": 0.9},
        {"id": "cassandra", "name": "Apache Cassandra", "aliases": ["cassandra", "apache cassandra", "scylladb"], "weight": 0.9},
        {"id": "elasticsearch", "name": "Elasticsearch / OpenSearch", "aliases": ["elasticsearch", "elastic search", "opensearch", "elk", "solr"], "weight": 0.9},
        {"id": "snowflake", "name": "Snowflake", "aliases": ["snowflake", "snowflake data warehouse"], "weight": 0.9},
        {"id": "bigquery", "name": "Google BigQuery", "aliases": ["bigquery", "bq"], "weight": 0.9},
        {"id": "vector_db", "name": "Vector Databases (Pinecone/Chroma/Qdrant)", "aliases": ["vector db", "pinecone", "chromadb", "qdrant", "weaviate", "milvus", "pgvector"], "weight": 0.9},
        {"id": "firebase", "name": "Firebase / Firestore", "aliases": ["firebase", "firestore", "realtime database"], "weight": 0.8},
        {"id": "sqlite", "name": "SQLite", "aliases": ["sqlite", "sqlite3"], "weight": 0.7},
    ],
    "devops_cicd": [
        {"id": "github_actions", "name": "GitHub Actions", "aliases": ["github actions", "gh actions", "gha"], "weight": 0.9},
        {"id": "gitlab_ci", "name": "GitLab CI/CD", "aliases": ["gitlab ci", "gitlab ci/cd"], "weight": 0.9},
        {"id": "jenkins", "name": "Jenkins", "aliases": ["jenkins", "jenkins ci"], "weight": 0.9},
        {"id": "cicd_general", "name": "CI/CD Pipelines", "aliases": ["ci/cd", "ci cd", "continuous integration", "continuous deployment", "continuous delivery"], "weight": 1.0},
        {"id": "argocd", "name": "ArgoCD / GitOps", "aliases": ["argocd", "argo cd", "gitops", "fluxcd"], "weight": 0.9},
        {"id": "prometheus_grafana", "name": "Monitoring (Prometheus / Grafana)", "aliases": ["prometheus", "grafana", "datadog", "new relic", "observability", "metrics", "opentelemetry", "cloudwatch"], "weight": 0.9},
    ],
    "developer_tools": [
        {"id": "git", "name": "Git / Version Control", "aliases": ["git", "github", "gitlab", "bitbucket", "version control", "vcs"], "weight": 1.0},
        {"id": "postman", "name": "Postman / API Testing", "aliases": ["postman", "swagger", "openapi", "insomnia", "curl"], "weight": 0.8},
        {"id": "linux", "name": "Linux / Unix Environments", "aliases": ["linux", "unix", "ubuntu", "debian", "centos", "redhat", "alpine"], "weight": 0.9},
        {"id": "vite_webpack", "name": "Build Tools (Vite / Webpack)", "aliases": ["vite", "webpack", "babel", "rollup", "esbuild", "turbo", "turbopack"], "weight": 0.8},
        {"id": "jira", "name": "Jira / Issue Tracking", "aliases": ["jira", "confluence", "linear", "trello", "asana"], "weight": 0.7},
        {"id": "n8n_automation", "name": "n8n & Workflow Automation", "aliases": ["n8n", "n8n automation", "workflow automation", "webhooks", "api integration"], "weight": 0.9},
        {"id": "vercel_netlify", "name": "Vercel & Netlify Deployment", "aliases": ["vercel", "netlify"], "weight": 0.8},
        {"id": "office_productivity", "name": "Office & Data Productivity (Excel / Sheets / PowerPoint)", "aliases": ["microsoft excel", "excel", "ms excel", "google sheets", "sheets", "powerpoint", "ms powerpoint", "data analysis", "reporting"], "weight": 0.8},
    ],
    "testing_qa": [
        {"id": "pytest", "name": "Pytest / Python Testing", "aliases": ["pytest", "unittest", "mock", "pytest-mock"], "weight": 0.9},
        {"id": "jest_vitest", "name": "Jest / Vitest", "aliases": ["jest", "vitest", "mocha", "chai"], "weight": 0.9},
        {"id": "cypress_playwright", "name": "E2E Testing (Cypress / Playwright)", "aliases": ["cypress", "playwright", "selenium", "puppeteer", "end-to-end testing", "e2e"], "weight": 0.9},
        {"id": "unit_testing", "name": "Unit & Integration Testing", "aliases": ["unit testing", "integration testing", "test coverage", "tdd", "test driven development", "bdd"], "weight": 1.0},
    ],
    "architecture_methodologies": [
        {"id": "microservices", "name": "Microservices Architecture", "aliases": ["microservices", "microservice architecture", "distributed systems", "service-oriented architecture", "soa"], "weight": 1.0},
        {"id": "rest_apis", "name": "RESTful API Design", "aliases": ["rest", "restful", "rest api", "rest apis", "restful apis", "api design", "web services"], "weight": 1.0},
        {"id": "event_driven", "name": "Event-Driven Architecture / Kafka", "aliases": ["event-driven", "kafka", "apache kafka", "rabbitmq", "pub/sub", "sqs", "event driven", "message broker", "message queues"], "weight": 1.0},
        {"id": "oop_system_design", "name": "Object-Oriented Design & System Design", "aliases": ["system design", "oop", "object oriented", "design patterns", "clean code", "clean architecture", "solid principles"], "weight": 1.0},
        {"id": "agile_scrum", "name": "Agile / Scrum Methodologies", "aliases": ["agile", "scrum", "kanban", "sprint planning", "retrospectives", "standups"], "weight": 0.8},
    ],
    "roles_domains": [
        {"id": "fullstack", "name": "Full Stack Engineering", "aliases": ["full stack", "fullstack", "full-stack"], "weight": 0.8},
        {"id": "backend", "name": "Backend Engineering", "aliases": ["backend", "back-end", "back end", "server-side"], "weight": 0.8},
        {"id": "frontend", "name": "Frontend Engineering", "aliases": ["frontend", "front-end", "front end", "client-side", "ui/ux", "web development"], "weight": 0.8},
        {"id": "data_engineering", "name": "Data Engineering / ETL", "aliases": ["data engineering", "etl", "elt", "data pipeline", "data pipelines", "spark", "apache spark", "airflow", "apache airflow"], "weight": 0.9},
        {"id": "ml_ai", "name": "Machine Learning & AI", "aliases": ["machine learning", "deep learning", "ai", "artificial intelligence", "nlp", "computer vision", "llm", "llms", "genai", "generative ai", "rag"], "weight": 0.9},
        {"id": "devops_sre", "name": "DevOps & SRE", "aliases": ["devops", "sre", "site reliability engineering", "platform engineering"], "weight": 0.9},
    ],
    "soft_skills_collaboration": [
        {"id": "cross_functional", "name": "Cross-Functional Collaboration", "aliases": ["cross-functional", "cross functional", "stakeholder management", "partnering with product"], "weight": 0.7},
        {"id": "code_review", "name": "Code Review & Quality Assurance", "aliases": ["code reviews", "code review", "peer review", "mentoring", "technical leadership", "mentorship"], "weight": 0.8},
        {"id": "technical_writing", "name": "Technical Documentation", "aliases": ["technical documentation", "documentation", "rfc", "design docs", "architecture documentation"], "weight": 0.7},
        {"id": "problem_solving", "name": "Root-Cause Analysis & Debugging", "aliases": ["root cause analysis", "debugging", "troubleshooting", "incident management", "problem solving"], "weight": 0.8},
        {"id": "communication_soft", "name": "Professional Communication & Collaboration", "aliases": ["communication", "team collaboration", "analytical thinking", "time management", "adaptability", "attention to detail"], "weight": 0.8},
        {"id": "spoken_languages", "name": "Spoken Languages (English / Hindi / Telugu)", "aliases": ["english", "hindi", "telugu", "fluent english", "fluent hindi", "conversational telugu"], "weight": 0.7},
    ]
}

# Pre-compiled Canonical Lookup Maps
CANONICAL_LOOKUP: Dict[str, Dict[str, Any]] = {}
ALIAS_TO_CANONICAL: Dict[str, str] = {}

for category, items in TAXONOMY.items():
    for item in items:
        item_id = item["id"]
        CANONICAL_LOOKUP[item_id] = {**item, "category": category}
        # Map primary name
        ALIAS_TO_CANONICAL[item["name"].lower()] = item_id
        # Map aliases
        for alias in item["aliases"]:
            ALIAS_TO_CANONICAL[alias.lower()] = item_id

# Strong ATS Action Verbs mapped to semantic clusters
ACTION_VERBS: Dict[str, List[str]] = {
    "Engineering & Architecture": [
        "architected", "built", "engineered", "developed", "designed", "implemented",
        "constructed", "authored", "programmed", "coded", "deployed", "refactored",
        "migrated", "containerized", "configured", "integrated", "automated", "created",
        "established", "orchestrated", "modernized", "scaled", "compiled", "rendered",
        "structured", "customized", "indexed", "scheduled"
    ],
    "Optimization & Performance": [
        "accelerated", "optimized", "reduced", "streamlined", "enhanced", "boosted",
        "improved", "minimized", "maximized", "eliminated", "consolidated", "upgraded",
        "diminished", "amplified", "trimmed", "expedited", "standardized", "refined",
        "profiled", "monitored"
    ],
    "Leadership & Delivery": [
        "led", "spearheaded", "directed", "managed", "mentored", "guided", "championed",
        "governed", "coordinated", "delivered", "executed", "oversaw", "drove",
        "pioneered", "steered", "facilitated", "coached", "co-founded", "cofounded",
        "founded", "organized", "hosted", "established", "initiated"
    ],
    "Analysis & Innovation": [
        "analyzed", "benchmarked", "diagnosed", "evaluated", "formulated", "researched",
        "discovered", "identified", "solved", "audited", "modeled", "measured",
        "quantified", "validated", "tested", "troubleshot", "derived", "visualized",
        "synthesized", "extracted", "mapped"
    ]
}

ALL_ACTION_VERBS_SET: Set[str] = {
    verb.lower()
    for verb_list in ACTION_VERBS.values()
    for verb in verb_list
}

# Weak/Passive Openers that degrade ATS Bullet Impact
WEAK_PASSIVE_OPENERS: List[Dict[str, Any]] = [
    {"pattern": r"^(worked on|worked with|worked closely with)\b", "phrase": "worked on", "suggestion": "Replace with specific action: 'Architected', 'Engineered', or 'Implemented'"},
    {"pattern": r"^(helped with|helped to|assisted in|assisted with)\b", "phrase": "helped with/assisted", "suggestion": "Specify your individual contribution: 'Co-developed', 'Contributed to', or 'Engineered'"},
    {"pattern": r"^(responsible for|was responsible for)\b", "phrase": "responsible for", "suggestion": "Focus on achievements: 'Spearheaded', 'Directed', or 'Delivered'"},
    {"pattern": r"^(handled|handled the)\b", "phrase": "handled", "suggestion": "Use a stronger technical verb: 'Managed', 'Resolved', or 'Administered'"},
    {"pattern": r"^(tasked with|was tasked with)\b", "phrase": "tasked with", "suggestion": "Frame proactively: 'Executed', 'Formulated', or 'Spearheaded'"},
    {"pattern": r"^(participated in|involved in|was involved with)\b", "phrase": "participated in", "suggestion": "Highlight direct ownership: 'Collaborated on', 'Engineered', or 'Facilitated'"},
    {"pattern": r"^(did|tried to|attempted to)\b", "phrase": "did/tried", "suggestion": "State outcome clearly: 'Implemented', 'Tested', or 'Deployed'"},
]

# Quantified Metric Detection Regular Expressions
METRIC_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b\d+(\.\d+)?\s*%", re.IGNORECASE),                         # 45%, 99.9%
    re.compile(r"\b\d+(\.\d+)?\s*x\b", re.IGNORECASE),                       # 3x, 10x
    re.compile(r"\$\s*\d+([,\.]\d+)?\s*(k|m|b|million|billion|thousand)?\b", re.IGNORECASE), # $50K, $1.2M
    re.compile(r"\b\d+([,\.]\d+)?\s*(ms|sec|seconds|minutes|hours|hrs|days|weeks|months)\b", re.IGNORECASE), # 50ms, 2 hrs
    re.compile(r"\b\d{1,3}(,\d{3})+(\+)?\b"),                               # 10,000+, 1,000,000
    re.compile(r"\b\d+(\.\d+)?\s*(k|m|b|million|billion)\+?\s*(users|requests|qps|rps|queries|records|events|lines|customers|clients|downloads|visits|endpoints|servers|nodes|pods)\b", re.IGNORECASE), # 10M requests, 50k users
    re.compile(r"\b\d+(\.\d+)?\s*(tb|gb|pb|mb)\b", re.IGNORECASE),           # 10TB data, 500GB
    re.compile(r"\b\d+\s*to\s*\d+\b", re.IGNORECASE),                        # 5 to 10
    re.compile(r"\bfrom\s+\d+.*?\s+to\s+\d+", re.IGNORECASE),                 # from 120ms to 35ms
    re.compile(r"\b(reduced|increased|boosted|cut|saved|scaled|improved)\s+.*?\s+by\s+\d+", re.IGNORECASE), # reduced latency by 40%
    re.compile(r"\b\d+(\.\d+)?\s*\+", re.IGNORECASE),                         # 8+, 10+, 300+, 70+
    re.compile(r"~\s*\d+(?:\s*-\s*\d+)?\s*(?:ms|s|sec|seconds)?\b", re.IGNORECASE), # ~1-2s
    re.compile(r"\b\d+\s*-\s*\d+\s*(?:ms|s|sec|seconds)\b", re.IGNORECASE),   # 1-2s
]


def normalize_token(text: str) -> str:
    """Normalize string for token comparison."""
    clean = text.lower().strip()
    # Normalize punctuation commonly found in tech terms
    clean = re.sub(r"[\s\-_/]+", " ", clean)
    return clean


def extract_technical_entities(text: str) -> List[Dict[str, Any]]:
    """
    Deterministically scan text and extract recognized taxonomy entities.
    Returns matched entity objects with canonical ID, name, category, and match location.
    """
    if not text:
        return []

    lower_text = text.lower()
    matched_ids: Set[str] = set()
    results: List[Dict[str, Any]] = []

    # Sort aliases by length descending so longer multi-word phrases match first
    sorted_aliases = sorted(ALIAS_TO_CANONICAL.keys(), key=lambda k: len(k), reverse=True)

    for alias in sorted_aliases:
        canonical_id = ALIAS_TO_CANONICAL[alias]
        if canonical_id in matched_ids:
            continue

        # Use regex word boundaries when appropriate (avoid substring false positives like 'c' in 'cat')
        escaped_alias = re.escape(alias)
        # Check special single-character / short tokens
        if len(alias) <= 2 and not alias.startswith('.'):
            pattern = rf"(?:\b|\A){escaped_alias}(?:\b|\Z|[,\.;\(\)])"
        else:
            pattern = rf"(?:\b|\A){escaped_alias}(?:\b|\Z|[,\.;\(\)])"

        if re.search(pattern, lower_text):
            canonical_info = CANONICAL_LOOKUP.get(canonical_id)
            if canonical_info:
                matched_ids.add(canonical_id)
                results.append({
                    "id": canonical_info["id"],
                    "name": canonical_info["name"],
                    "category": canonical_info["category"],
                    "matched_alias": alias,
                    "weight": canonical_info.get("weight", 1.0)
                })

    return results


def match_keywords_against_job(resume_text_or_tokens: str, job_description: str) -> Dict[str, Any]:
    """
    Compare resume content against target Job Description entities using the deterministic taxonomy.
    Calculates matched keywords, missing critical keywords, and transferable/bonus skills.
    """
    jd_entities = extract_technical_entities(job_description)
    resume_entities = extract_technical_entities(resume_text_or_tokens)

    jd_entity_map = {e["id"]: e for e in jd_entities}
    resume_entity_map = {e["id"]: e for e in resume_entities}

    matched_keywords: List[Dict[str, Any]] = []
    missing_keywords: List[Dict[str, Any]] = []
    transferable_skills: List[Dict[str, Any]] = []

    for item_id, jd_item in jd_entity_map.items():
        if item_id in resume_entity_map:
            matched_keywords.append({
                "id": item_id,
                "name": jd_item["name"],
                "category": jd_item["category"],
                "importance": "High" if jd_item.get("weight", 1.0) >= 1.0 else "Medium",
                "status": "matched"
            })
        else:
            missing_keywords.append({
                "id": item_id,
                "name": jd_item["name"],
                "category": jd_item["category"],
                "importance": "High" if jd_item.get("weight", 1.0) >= 1.0 else "Medium",
                "status": "missing",
                "recommendation": f"Consider adding verified experience or projects utilizing {jd_item['name']} if applicable."
            })

    # Find transferable/bonus skills present in resume but not explicitly required in JD
    for item_id, res_item in resume_entity_map.items():
        if item_id not in jd_entity_map:
            transferable_skills.append({
                "id": item_id,
                "name": res_item["name"],
                "category": res_item["category"],
                "importance": "Bonus",
                "status": "transferable"
            })

    total_required = len(jd_entity_map)
    matched_count = len(matched_keywords)

    if total_required > 0:
        match_percentage = round((matched_count / total_required) * 100, 1)
    else:
        # If no JD keywords found or general scan, base on resume technical richness
        match_percentage = 100.0 if len(resume_entities) >= 8 else round((len(resume_entities) / 8.0) * 100, 1)

    return {
        "matched_keywords": matched_keywords,
        "missing_keywords": missing_keywords,
        "transferable_skills": transferable_skills,
        "total_required": total_required,
        "matched_count": matched_count,
        "missing_count": len(missing_keywords),
        "transferable_count": len(transferable_skills),
        "match_percentage": match_percentage
    }


def audit_bullet_text(bullet: str) -> Dict[str, Any]:
    """
    Perform a multi-dimensional bullet audit assessing:
    1. Strong action verb opener (strength & technical precision)
    2. Weak/passive phrasing detection
    3. Technical implementation depth & context
    4. Quantified metric evidence (bonus, not sole determinant)
    5. Optimal word length (12-32 words target)
    """
    clean_bullet = bullet.strip().lstrip("-•* ").strip()
    if not clean_bullet:
        return {
            "text": bullet,
            "has_action_verb": False,
            "has_metric": False,
            "has_weak_opener": False,
            "verb": None,
            "word_count": 0,
            "issues": ["Empty bullet point"],
            "score": 0,
            "status": "weak"
        }

    words = clean_bullet.split()
    word_count = len(words)
    first_word = words[0].lower().rstrip(",:;.")

    # 1. Action Verb Check
    has_action_verb = first_word in ALL_ACTION_VERBS_SET
    detected_verb = first_word if has_action_verb else None

    # Check 2-word action verbs (e.g., "co-founded", "fine-tuned")
    if not has_action_verb and len(words) > 1:
        two_word = f"{words[0]} {words[1]}".lower().rstrip(",:;.")
        if two_word in ALL_ACTION_VERBS_SET:
            has_action_verb = True
            detected_verb = two_word

    # 2. Weak Opener Check
    has_weak_opener = False
    weak_suggestion = None
    for weak_rule in WEAK_PASSIVE_OPENERS:
        if re.search(weak_rule["pattern"], clean_bullet, re.IGNORECASE):
            has_weak_opener = True
            weak_suggestion = weak_rule["suggestion"]
            break

    # 3. Quantified Metric Check
    has_metric = False
    for pat in METRIC_PATTERNS:
        if pat.search(clean_bullet):
            has_metric = True
            break

    # 4. Multi-dimensional Bullet Scoring (Base 40 pts)
    score = 40
    issues: List[str] = []

    if has_weak_opener:
        score -= 25
        issues.append(f"Weak/Passive phrasing: {weak_suggestion}")
    elif has_action_verb:
        score += 25
    else:
        score -= 15
        issues.append(f"Missing strong action verb opener (starts with '{words[0]}')")

    # Technical depth / implementation clarity heuristic
    if word_count < 10:
        score -= 15
        issues.append(f"Too concise ({word_count} words); expand with technical context and implementation details")
    elif word_count >= 12:
        score += 20
    else:
        score += 10

    if word_count > 34:
        score -= 10
        issues.append(f"Too lengthy ({word_count} words); tighten to maintain reader focus")

    if has_metric:
        score += 15

    score = min(max(score, 0), 100)

    # Status classification
    if score >= 80:
        status = "strong"
    elif score >= 55:
        status = "moderate"
    else:
        status = "weak"

    return {
        "text": clean_bullet,
        "has_action_verb": has_action_verb,
        "has_metric": has_metric,
        "has_weak_opener": has_weak_opener,
        "verb": detected_verb,
        "word_count": word_count,
        "issues": issues,
        "score": score,
        "status": status
    }
