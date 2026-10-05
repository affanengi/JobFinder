export interface VerifiedProfileFact {
  id: string
  category: 'skill' | 'experience' | 'project' | 'education' | 'certification' | 'preference'
  title: string
  detail: string
  verified: boolean
  source: 'user' | 'imported_resume'
  updatedAt: string
}

export const MOCK_VERIFIED_PROFILE = {
  name: "Mohammed Affan Razvi",
  email: "affan.razvi@example.com",
  phone: "+91 98765 43210",
  location: "Hyderabad, India",
  links: {
    github: "https://github.com/affanengi",
    linkedin: "https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
    portfolio: "https://affanrazvi.dev"
  },
  summary: "AI Solutions & Automation Engineer with experience building agentic workflows, Python/FastAPI microservices, Playwright browser automation, and data pipelines.",
  education: [
    {
      institution: "Osmania University / Engineering Institute",
      degree: "Bachelor of Technology (B.Tech)",
      field: "Computer Science & Engineering",
      endDate: "2026",
      verified: true
    }
  ],
  skills: [
    { name: "Python", category: "programming", proficiency: "advanced", verified: true },
    { name: "FastAPI", category: "web", proficiency: "advanced", verified: true },
    { name: "Playwright", category: "tools", proficiency: "advanced", verified: true },
    { name: "TypeScript / React", category: "web", proficiency: "intermediate", verified: true },
    { name: "SQL / Firestore / BigQuery", category: "data", proficiency: "intermediate", verified: true },
    { name: "Google Gemini / LLM APIs", category: "ai_ml", proficiency: "advanced", verified: true },
    { name: "Docker & Linux", category: "cloud", proficiency: "intermediate", verified: true }
  ],
  projects: [
    {
      id: "p1",
      name: "Personal AI Career Agent (jobFinder)",
      technologies: ["Python", "FastAPI", "Playwright", "Firestore", "React"],
      bullets: [
        "Architected an ATS resume engine with automated truth auditing to block hallucinated claims.",
        "Built browser automation pipelines with Playwright to pre-fill multi-step job application portals.",
        "Engineered hybrid job recommendation algorithms combining hard filters, vector search, and structured score breakdowns."
      ],
      verified: true
    },
    {
      id: "p2",
      name: "Advanced Video & Media Processing Pipeline",
      technologies: ["Python", "AsyncIO", "FFmpeg", "REST APIs"],
      bullets: [
        "Developed high-throughput media parsing and analysis workflows handling asynchronous batch tasks.",
        "Implemented structured metadata extraction and automated categorization pipelines."
      ],
      verified: true
    }
  ],
  preferences: {
    desiredRoles: ["AI Automation Intern", "Data Operations Specialist", "Software Engineer Intern", "Product Operations Intern"],
    excludedRoles: ["Senior Architect", "Hardware Engineer", "Cold Sales Representative"],
    workModes: ["remote", "hybrid"],
    employmentTypes: ["internship", "full_time"],
    dailyRecommendationTarget: 10
  }
}
