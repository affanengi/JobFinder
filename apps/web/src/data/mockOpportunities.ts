import { JobOpportunity } from '../types/job'

export const INITIAL_MOCK_OPPORTUNITIES: JobOpportunity[] = [
  {
    id: 'job-101',
    title: 'AI Automation & Data Operations Intern',
    company: 'ScaleAI Innovations',
    location: 'Remote (India / US-Hours Flexible)',
    workMode: 'remote',
    employmentType: 'internship',
    seniority: 'Internship / Entry',
    salary: {
      min: 35000,
      max: 55000,
      currency: 'INR',
      period: 'month'
    },
    description: 'We are seeking an energetic AI Automation Intern to build intelligent workflow agents, extract data, automate browser-based pipelines, and support AI operations using Python and modern LLM APIs.',
    responsibilities: [
      'Build and maintain Python-based automation pipelines and integration scripts.',
      'Implement browser automation using Playwright / Selenium for data verification.',
      'Integrate LLM APIs (Gemini/OpenAI) for structured data extraction and classification.',
      'Collaborate with cross-functional product and operations teams.'
    ],
    requiredSkills: ['Python', 'FastAPI', 'Playwright', 'LLM APIs / Prompting', 'Git'],
    preferredSkills: ['TypeScript', 'Docker', 'Google Cloud / Firebase'],
    educationRequirements: ["Enrolled in or recent graduate of B.Tech / B.S. in Computer Science or related STEM field."],
    experienceRequirements: ['0-1 years with demonstrated personal projects in AI automation.'],
    applicationUrl: 'https://boards-api.greenhouse.io/scaleai/jobs/101',
    postedAt: '2026-09-02T10:00:00Z',
    discoveredAt: '2026-09-03T08:30:00Z',
    source: {
      sourceName: 'Greenhouse Public API',
      sourceType: 'api',
      sourceUrl: 'https://boards.greenhouse.io/scaleai/jobs/101',
      retrievedAt: '2026-09-03T08:30:00Z'
    },
    recommendation: {
      id: 'rec-101',
      score: 95,
      category: 'strong_match',
      breakdown: {
        skills: 98,
        experience: 94,
        rolePreference: 100,
        education: 95,
        location: 100,
        seniority: 95,
        compensation: 90,
        historicalSignal: 85
      },
      matchedRequirements: [
        'Python & FastAPI backend experience',
        'Demonstrated Playwright browser automation skills',
        'Hands-on LLM API & Agentic integration experience',
        'Matches Remote internship preference'
      ],
      gaps: [
        'Docker production orchestration preferred but not mandatory'
      ],
      unknowns: [
        'Exact daily shift hours flexibility'
      ],
      reasoning: 'Exceptional fit. Your verified experience with Python automation, Playwright browser scripts, and Gemini API matches 95% of their core requirements with zero hard-filter violations.',
      status: 'new'
    }
  },
  {
    id: 'job-102',
    title: 'Full Stack AI Developer Intern',
    company: 'CognitiveWorks Labs',
    location: 'Bangalore, India (Hybrid)',
    workMode: 'hybrid',
    employmentType: 'internship',
    seniority: 'Internship',
    salary: {
      min: 40000,
      max: 60000,
      currency: 'INR',
      period: 'month'
    },
    description: 'Join our fast-paced product engineering team to build web applications powered by generative AI. You will work across FastAPI backends, React frontends, and vector search systems.',
    responsibilities: [
      'Develop modern React UI components for AI-assisted tools.',
      'Design RESTful APIs and asynchronous background tasks in FastAPI.',
      'Work with structured database storage and semantic vector retrieval.',
      'Write clean, modular code with automated unit tests.'
    ],
    requiredSkills: ['React', 'TypeScript', 'Python', 'FastAPI', 'REST APIs'],
    preferredSkills: ['Tailwind CSS', 'Vector Databases', 'pytest'],
    educationRequirements: ['B.Tech / B.E. in Computer Science or Information Technology.'],
    experienceRequirements: ['Project experience in full-stack web development.'],
    applicationUrl: 'https://api.lever.co/v0/postings/cognitiveworks/102',
    postedAt: '2026-09-01T14:20:00Z',
    discoveredAt: '2026-09-03T07:15:00Z',
    source: {
      sourceName: 'Lever Public API',
      sourceType: 'api',
      sourceUrl: 'https://jobs.lever.co/cognitiveworks/102',
      retrievedAt: '2026-09-03T07:15:00Z'
    },
    recommendation: {
      id: 'rec-102',
      score: 91,
      category: 'strong_match',
      breakdown: {
        skills: 92,
        experience: 88,
        rolePreference: 95,
        education: 95,
        location: 85,
        seniority: 95,
        compensation: 95,
        historicalSignal: 80
      },
      matchedRequirements: [
        'React + TypeScript modern frontend stack',
        'FastAPI asynchronous backend development',
        'REST API design and integration',
        'B.Tech CS degree alignment'
      ],
      gaps: [
        'Hybrid location in Bangalore (check commute or hybrid schedule)'
      ],
      unknowns: [
        'PPO / Full-time conversion timeline'
      ],
      reasoning: 'Strong match across the entire full-stack AI toolkit. The role directly aligns with your React/FastAPI stack.',
      status: 'new'
    }
  },
  {
    id: 'job-103',
    title: 'Cloud & Data Systems Intern',
    company: 'NexusCloud Systems',
    location: 'Remote',
    workMode: 'remote',
    employmentType: 'internship',
    seniority: 'Internship',
    salary: {
      min: 30000,
      max: 45000,
      currency: 'INR',
      period: 'month'
    },
    description: 'Looking for an intern eager to learn cloud data architectures, SQL optimization, automated testing, and serverless backends.',
    responsibilities: [
      'Write and optimize SQL queries and data transformations.',
      'Maintain automated integration test suites.',
      'Assist in cloud deployment configurations.'
    ],
    requiredSkills: ['Python', 'SQL', 'Git', 'Linux Basics'],
    preferredSkills: ['Google Cloud / AWS', 'Docker', 'pytest'],
    educationRequirements: ['STEM Degree Candidate'],
    experienceRequirements: ['Academic or project coursework in databases and Python.'],
    applicationUrl: 'https://jobs.ashbyhq.com/nexuscloud/103',
    postedAt: '2026-08-30T11:00:00Z',
    discoveredAt: '2026-09-02T19:00:00Z',
    source: {
      sourceName: 'Ashby Public Feed',
      sourceType: 'feed',
      sourceUrl: 'https://jobs.ashbyhq.com/nexuscloud/103',
      retrievedAt: '2026-09-02T19:00:00Z'
    },
    recommendation: {
      id: 'rec-103',
      score: 87,
      category: 'good_match',
      breakdown: {
        skills: 85,
        experience: 82,
        rolePreference: 90,
        education: 95,
        location: 100,
        seniority: 95,
        compensation: 85,
        historicalSignal: 75
      },
      matchedRequirements: [
        'Python and SQL proficiency',
        'Linux environment familiarity',
        'Remote work preference match'
      ],
      gaps: [
        'Extensive enterprise cloud experience preferred'
      ],
      unknowns: [
        'Specific cloud certifications required'
      ],
      reasoning: 'Good foundational match. Core Python and database qualifications match well.',
      status: 'saved'
    }
  },
  {
    id: 'job-104',
    title: 'Junior QA & Automation Engineer',
    company: 'VerifyStream Tech',
    location: 'Hyderabad, India (Hybrid)',
    workMode: 'hybrid',
    employmentType: 'full_time',
    seniority: 'Junior / Entry',
    salary: {
      min: 450000,
      max: 650000,
      currency: 'INR',
      period: 'year'
    },
    description: 'Join our QA Engineering team to automate end-to-end browser workflows, API performance tests, and continuous regression suites using Playwright and Python.',
    responsibilities: [
      'Author robust end-to-end automation test scripts using Playwright and pytest.',
      'Test REST APIs and validate schema correctness with automated test runners.',
      'Investigate bug reports and isolate edge cases.'
    ],
    requiredSkills: ['Playwright', 'Python', 'pytest', 'REST API Testing'],
    preferredSkills: ['CI/CD (GitHub Actions)', 'TypeScript'],
    educationRequirements: ['B.Tech / B.E. / BCA / MCA in Computer Science'],
    experienceRequirements: ['0-1 years with automated browser testing tools'],
    applicationUrl: 'https://jobs.lever.co/verifystream/104',
    postedAt: '2026-09-01T09:00:00Z',
    discoveredAt: '2026-09-02T22:30:00Z',
    source: {
      sourceName: 'Lever Public API',
      sourceType: 'api',
      sourceUrl: 'https://jobs.lever.co/verifystream/104',
      retrievedAt: '2026-09-02T22:30:00Z'
    },
    recommendation: {
      id: 'rec-104',
      score: 89,
      category: 'good_match',
      breakdown: {
        skills: 95,
        experience: 85,
        rolePreference: 85,
        education: 95,
        location: 95,
        seniority: 90,
        compensation: 90,
        historicalSignal: 80
      },
      matchedRequirements: [
        'Hands-on Playwright browser automation mastery',
        'Python & pytest test suite structuring',
        'Hyderabad local presence match'
      ],
      gaps: [
        'Role is Full-Time rather than Internship (verify availability)'
      ],
      unknowns: [
        'Notice period requirement'
      ],
      reasoning: 'Strong technical fit for Playwright testing and Python automation in your local city.',
      status: 'new'
    }
  },
  {
    id: 'job-105',
    title: 'Senior Distributed Systems Architect',
    company: 'Enterprise Core Corp',
    location: 'New York, USA (On-site)',
    workMode: 'onsite',
    employmentType: 'full_time',
    seniority: 'Senior / Staff',
    salary: {
      min: 180000,
      max: 240000,
      currency: 'USD',
      period: 'year'
    },
    description: 'Looking for a Senior Architect with 10+ years designing distributed consensus protocols and Kubernetes control planes.',
    responsibilities: ['Architect planetary-scale distributed storage engines.'],
    requiredSkills: ['C++', 'Rust', 'Distributed Consensus', '10+ Years Experience'],
    preferredSkills: ['Linux Kernel Hacking'],
    educationRequirements: ['Master / PhD in CS'],
    experienceRequirements: ['10+ years'],
    applicationUrl: 'https://enterprisecore.com/careers/arch',
    postedAt: '2026-08-25T00:00:00Z',
    discoveredAt: '2026-09-01T12:00:00Z',
    source: {
      sourceName: 'Manual URL Ingest',
      sourceType: 'manual',
      sourceUrl: 'https://enterprisecore.com/careers/arch',
      retrievedAt: '2026-09-01T12:00:00Z'
    },
    recommendation: {
      id: 'rec-105',
      score: 22,
      category: 'reject',
      breakdown: {
        skills: 10,
        experience: 5,
        rolePreference: 10,
        education: 60,
        location: 0,
        seniority: 10,
        compensation: 50,
        historicalSignal: 0
      },
      matchedRequirements: [],
      gaps: [
        'Requires 10+ years of distributed systems experience',
        'On-site in New York (excluded location)',
        'Seniority materially exceeds target level'
      ],
      unknowns: [],
      reasoning: 'HARD REJECT. Seniority and on-site US location violate your preference constraints.',
      status: 'rejected'
    }
  }
]
