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


# Trivial activity / domestic patterns that do not represent technical delivery
TRIVIAL_TASK_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(office supplies|pencils|chairs|drinks|lunch|snacks|coffee|meeting room bookings?|filing papers?)\b", re.IGNORECASE),
]

# Meaningful qualitative engineering milestones (awarded outcome credit without requiring numbers)
QUALITATIVE_OUTCOME_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(eliminat(ed|ing)|resolv(ed|ing)|prevent(ed|ing))\s+(a\s+)?(documented\s+)?(race condition|memory leak|bottleneck|downtime|security vulnerability|deadlock|degradation)\b", re.IGNORECASE),
    re.compile(r"\b(achiev(ed|ing)|ensur(ed|ing)|guarante(ed|eing))\s+(zero[- ]downtime|high availability|fault tolerance|data consistency|acid compliance|sub[- ]second message delivery)\b", re.IGNORECASE),
    re.compile(r"\b(standardiz(ed|ing)|streamlin(ed|ing)|refactor(ed|ing))\s+.*?\b(architecture|pipeline|lifecycle|workflow|schema)\b", re.IGNORECASE),
    re.compile(r"\b(migrat(ed|ing))\s+.*?\bwith\s+zero\s+(data loss|downtime)\b", re.IGNORECASE),
]

# Trivial activity count patterns (e.g., attended 8 meetings weekly)
TRIVIAL_ACTIVITY_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(attended|participated in|joined|held)\s+\d+\s+(meetings|sessions|calls|conferences|events)\b", re.IGNORECASE),
    re.compile(r"\b(ordered|bought|purchased|organized)\s+\d+\s+(office|supplies|chairs|pens|lunches|coffees)\b", re.IGNORECASE),
]

# High-impact measured outcomes (percentages, latency, throughput, cloud cost)
MEASURED_IMPACT_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(reduc(ed|ing)|cut(ting)?|decreas(ed|ing)|improv(ed|ing)|increas(ed|ing)|boost(ed|ing)|sav(ed|ing)|scal(ed|ing))\s+.*?\s+by\s+\d+(\.\d+)?%", re.IGNORECASE),
    re.compile(r"\$\s*\d+([,\.]\d+)?\s*(k|m|b|million|billion|thousand)?\b", re.IGNORECASE),
    re.compile(r"\b\d+(\.\d+)?\s*(k|m|b|million|billion)\+?\s*(users|requests|qps|rps|queries|records|events)\b", re.IGNORECASE),
    re.compile(r"\bfrom\s+\d+.*?\s+to\s+\d+", re.IGNORECASE),
    re.compile(r"\b\d+(\.\d+)?\s*%\s*(reduction|increase|improvement|boost|growth|drop)\b", re.IGNORECASE),
]

# Technical architecture & mechanism patterns
ENGINEERING_MECHANISM_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(microservices?|distributed|concurrency|pipeline|latency|throughput|caching|indexing|normalized|query optimization|ci/cd|autoscaling|multithreading|asynchronous|event[- ]driven|rest api|graphql|schema|migration|race condition|memory leak|sharding|replication|containeriz(ed|ation)|orchestrat(ed|ion))\b", re.IGNORECASE),
]

# Generic corporate buzzwords lacking technical mechanism
VAGUE_BUZZWORD_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(championed excellence|drove innovation|synergy|thought leader|best[- ]in[- ]class|world[- ]class|results[- ]driven|hard worker|go[- ]to person|team player|passionate developer)\b", re.IGNORECASE),
]


def audit_bullet_text(
    bullet: str,
    job_context: Optional[Any] = None,
    target_role: Optional[str] = None
) -> Dict[str, Any]:
    """
    Perform a 4-dimensional contextual bullet audit assessing:
    1. Action & Scope (0 - 25 pts)
    2. Technical Substance & Mechanism (0 - 25 pts)
    3. Outcome Credibility & Value Delivered (0 - 25 pts, qualitative or quantitative)
    4. Target Role Relevance (0 - 25 pts)

    Eliminates arbitrary point bonuses (+25 verb, +15 metric, +20 length) and replaces them
    with an evidence-grounded rubric.
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
            "status": "weak",
            "rubric_breakdown": {
                "action_scope_score": 0.0,
                "technical_substance_score": 0.0,
                "outcome_credibility_score": 0.0,
                "job_relevance_score": 0.0,
                "rubric_notes": ["Empty statement"]
            }
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

    # 3. Quantified Metric Detection (boolean flag preserved for legacy contracts)
    has_metric = False
    for pat in METRIC_PATTERNS:
        if pat.search(clean_bullet):
            has_metric = True
            break

    issues: List[str] = []

    # -------------------------------------------------------------------------
    # DIMENSION 1: Action & Scope (0 - 25 pts)
    # -------------------------------------------------------------------------
    is_trivial_task = any(pat.search(clean_bullet) for pat in TRIVIAL_TASK_PATTERNS)
    extracted_entities = extract_technical_entities(clean_bullet)
    has_mechanism = any(pat.search(clean_bullet) for pat in ENGINEERING_MECHANISM_PATTERNS)
    has_buzzword = any(pat.search(clean_bullet) for pat in VAGUE_BUZZWORD_PATTERNS)

    hard_technical_entities = [e for e in extracted_entities if not str(e.get("category", "")).startswith("soft_skills")]

    if has_weak_opener:
        action_scope = 5.0
        issues.append(f"Weak/Passive phrasing: {weak_suggestion}")
    elif is_trivial_task:
        action_scope = 8.0
        issues.append("Action verb applied to administrative or trivial task")
    elif has_buzzword and not has_mechanism:
        action_scope = 10.0
        issues.append("Action verb coupled with generic corporate buzzwords lacking implementation scope")
    elif has_action_verb:
        if word_count < 8:
            action_scope = 16.0
            issues.append(f"Action context is very concise ({word_count} words); expand with implementation scope")
        elif word_count > 34:
            action_scope = 19.0
            issues.append(f"Action context is lengthy ({word_count} words); tighten to maintain focus")
        else:
            action_scope = 23.0
    else:
        action_scope = 10.0
        issues.append(f"Missing strong action verb opener (starts with '{words[0]}')")

    # -------------------------------------------------------------------------
    # DIMENSION 2: Technical Substance & Mechanism (0 - 25 pts)
    # -------------------------------------------------------------------------
    # Detect keyword dumping (high entity count with very few descriptive words)
    if len(extracted_entities) >= 4 and (len(extracted_entities) / max(word_count, 1)) > 0.40:
        technical_substance = 8.0
        issues.append("Uncontextualized keyword dump detected; incorporate technologies into descriptive implementation statements")
    elif has_buzzword and not has_mechanism:
        technical_substance = 8.0
        issues.append("Vague phrasing lacking technical implementation mechanism or architectural detail")
    elif len(hard_technical_entities) >= 1 and has_mechanism:
        technical_substance = min(21.0 + len(hard_technical_entities), 25.0)
    elif has_mechanism:
        technical_substance = 20.0
    elif has_weak_opener and not has_mechanism:
        technical_substance = 10.0
    elif len(hard_technical_entities) >= 1:
        technical_substance = 16.0
    elif has_buzzword:
        technical_substance = 8.0
        issues.append("Vague phrasing lacking technical implementation mechanism or architectural detail")
    else:
        technical_substance = 11.0
        if word_count >= 8:
            issues.append("Lacks technical implementation mechanism (architecture, protocol, algorithm, or tools)")

    # -------------------------------------------------------------------------
    # DIMENSION 3: Outcome Credibility & Value Delivered (0 - 25 pts)
    # -------------------------------------------------------------------------
    is_trivial_activity = any(pat.search(clean_bullet) for pat in TRIVIAL_ACTIVITY_PATTERNS)
    has_measured_impact = any(pat.search(clean_bullet) for pat in MEASURED_IMPACT_PATTERNS)
    has_qualitative_outcome = any(pat.search(clean_bullet) for pat in QUALITATIVE_OUTCOME_PATTERNS)

    if is_trivial_activity:
        outcome_credibility = 7.0
        issues.append("Activity count detected without delivered impact or qualitative milestone")
    elif has_measured_impact:
        outcome_credibility = 24.0
    elif has_qualitative_outcome:
        # High outcome credit awarded for genuine qualitative engineering milestones!
        outcome_credibility = 22.0
    elif has_metric:
        # Generic metric (e.g., team of 4)
        outcome_credibility = 14.0
    else:
        outcome_credibility = 10.0
        issues.append("Lacks explicit outcome or qualitative milestone (e.g., latency, reliability, or business impact)")

    # -------------------------------------------------------------------------
    # DIMENSION 4: Target Role Relevance (0 - 25 pts)
    # -------------------------------------------------------------------------
    if job_context or target_role:
        jd_text = ""
        if isinstance(job_context, dict):
            jd_text = (
                str(job_context.get("description", ""))
                + " " + " ".join(job_context.get("requirements", []))
                + " " + str(job_context.get("title", ""))
            )
        elif isinstance(job_context, str):
            jd_text = job_context
        role_text = (target_role or "").lower()

        jd_entities = {e["id"] for e in extract_technical_entities(jd_text)} if jd_text else set()
        bullet_entities = {e["id"] for e in extracted_entities}

        # Domain mismatch detection
        mobile_techs = {"swift", "kotlin", "ios", "android", "flutter", "react native", "swiftui"}
        backend_techs = {"python", "fastapi", "django", "go", "golang", "java", "postgresql", "redis", "docker", "kubernetes", "aws"}

        is_mobile_bullet = bool(bullet_entities.intersection(mobile_techs)) or "ios" in clean_bullet.lower() or "swift" in clean_bullet.lower()
        is_backend_target = bool(jd_entities.intersection(backend_techs)) or "backend" in role_text or "distributed" in role_text

        if is_mobile_bullet and is_backend_target and not bool(bullet_entities.intersection(jd_entities)):
            job_relevance = 6.0
            issues.append("Experience domain (mobile) does not align with target role requirements (backend)")
        elif bullet_entities and jd_entities and bool(bullet_entities.intersection(jd_entities)):
            job_relevance = 24.0
        elif jd_entities and not bool(bullet_entities.intersection(jd_entities)):
            job_relevance = 12.0
            issues.append("Statement does not mention required skills from target job description")
        else:
            job_relevance = 14.0 if has_weak_opener else 18.0
    else:
        # Calibrated baseline scan without specific target job
        if has_weak_opener or has_buzzword or is_trivial_task:
            job_relevance = 10.0
        else:
            job_relevance = 18.0

    # -------------------------------------------------------------------------
    # COMPOSITE SCORE & STATUS CLASSIFICATION
    # -------------------------------------------------------------------------
    score = round(action_scope + technical_substance + outcome_credibility + job_relevance)
    score = max(0, min(100, score))

    if score >= 75:
        status = "strong"
    elif score >= 50:
        status = "moderate"
    else:
        status = "weak"

    rubric_breakdown = {
        "action_scope_score": action_scope,
        "technical_substance_score": technical_substance,
        "outcome_credibility_score": outcome_credibility,
        "job_relevance_score": job_relevance,
        "rubric_notes": [
            f"Action & Scope: {action_scope}/25",
            f"Technical Substance: {technical_substance}/25",
            f"Outcome Credibility: {outcome_credibility}/25",
            f"Target Role Relevance: {job_relevance}/25"
        ]
    }

    return {
        "text": clean_bullet,
        "has_action_verb": has_action_verb,
        "has_metric": has_metric,
        "has_weak_opener": has_weak_opener,
        "verb": detected_verb,
        "word_count": word_count,
        "issues": issues,
        "score": score,
        "status": status,
        "rubric_breakdown": rubric_breakdown
    }
