import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { AuthProvider } from '../context/AuthContext';

// Mock api
vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from '../lib/api';

const mockProfile = {
  fullName: 'Mohammed Affan Razvi',
  headline: 'Full Stack AI Engineer & Automation Specialist',
  personal: {
    fullName: 'Mohammed Affan Razvi',
    email: 'affan@example.com',
  },
  skills: Array.from({ length: 62 }, (_, i) => ({ id: `s_${i}`, name: `Skill ${i}` })),
  experience: [{ id: 'exp_1', company: 'Google', title: 'SWE Intern' }],
  projects: [{ id: 'p_1', name: 'Agentic OS' }],
};

const mockRecommendations = [
  {
    id: 'job_high_fit_1',
    title: 'AI Fullstack Software Developer',
    company: 'Aristocrat IT Solutions',
    location: 'Remote',
    workMode: 'remote',
    status: 'recommended',
    requiredSkills: ['Python', 'FastAPI', 'React'],
    recommendation: {
      score: 91,
      category: 'strong_match',
      reasoning: 'Strong skills alignment with verified experience.',
    },
  },
  {
    id: 'job_high_fit_2',
    title: 'Cloud & Data Systems Intern',
    company: 'NexusCloud Systems',
    location: 'Hybrid',
    workMode: 'hybrid',
    status: 'recommended',
    requiredSkills: ['Python', 'SQL', 'Git'],
    recommendation: {
      score: 87,
      category: 'good_match',
      reasoning: 'Matches Python and backend facts.',
    },
  },
  {
    id: 'job_mod_fit',
    title: 'Junior QA Engineer',
    company: 'TestCo',
    location: 'Onsite',
    workMode: 'onsite',
    status: 'recommended',
    requiredSkills: ['Selenium'],
    recommendation: {
      score: 65,
      category: 'possible_match',
    },
  },
  {
    id: 'job_saved_1',
    title: 'Associate Linux Support Engineer',
    company: 'Canonical',
    location: 'Remote',
    workMode: 'remote',
    status: 'saved',
    requiredSkills: ['Linux', 'Bash'],
    recommendation: {
      score: 85,
      category: 'good_match',
    },
  },
];

const mockApplications = [
  {
    id: 'app_ready_1',
    userId: 'user_default',
    jobId: 'job_cred',
    company: 'Cred',
    jobTitle: 'Growth and Business Intern',
    location: 'Bengaluru',
    status: 'ready',
    isExternal: false,
    portalUrl: 'https://careers.cred.club/apply/123',
    resumeSnapshot: {
      resumeId: 'res_cred_1',
      version: 1,
      jobId: 'job_cred',
      targetRole: 'Growth and Business Intern',
      skillsUsed: ['Python', 'Analytics'],
      bulletCount: 12,
      approvedAt: '2026-09-27T10:00:00Z',
    },
    atsScoreSnapshot: {
      overallScore: 88,
      evaluatedAt: '2026-09-27T10:00:00Z',
      scannerVersion: '1.0.0',
      breakdown: {},
    },
    stageTimestamps: {
      saved: '2026-09-26T00:00:00Z',
      ready: '2026-09-27T10:00:00Z',
    },
    updatedAt: '2026-09-27T10:00:00Z',
  },
  {
    id: 'app_applied_1',
    userId: 'user_default',
    jobId: 'job_aristocrat',
    company: 'Aristocrat IT Solutions',
    jobTitle: 'AI Fullstack Software Developer',
    location: 'Chennai, India',
    status: 'applied',
    isExternal: false,
    stageTimestamps: {
      applied: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    appliedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

const mockResumes = [
  { id: 'res_1', jobTitle: 'AI Engineer', jobCompany: 'Canonical' },
  { id: 'res_2', jobTitle: 'Frontend Lead', jobCompany: 'Vercel' },
];

const mockScanReports = [
  {
    id: 'scan_1',
    reportName: 'ScaleAI Labs — AI Automation Intern',
    overallScore: 94,
    grade: 'A+',
    createdAt: '2026-10-01T12:00:00Z',
  },
];

const mockAiCredentials = [
  { id: 'cred_1', provider: 'gemini', label: 'Primary Gemini Flash' },
  { id: 'cred_2', provider: 'gemini', label: 'Backup Gemini Pro' },
  { id: 'cred_3', provider: 'groq', label: 'Groq Llama 3' },
];

const mockAiHealth = {
  providers: [{ provider: 'gemini', operational: true }],
  healthyCredentialsCount: 3,
  activeCooldowns: [],
};

describe('JobFinder Dashboard - Live Command Center', () => {
  const onNavigateToOpportunities = vi.fn();
  const onNavigateToTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWithAuth as any).mockImplementation((url: string) => {
      if (url === '/api/v1/profile') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProfile) });
      }
      if (url === '/api/v1/recommendations') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRecommendations) });
      }
      if (url === '/api/v1/applications') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockApplications) });
      }
      if (url === '/api/v1/resumes') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResumes) });
      }
      if (url === '/api/v1/scanner/reports') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockScanReports) });
      }
      if (url === '/api/v1/ai/credentials') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAiCredentials) });
      }
      if (url === '/api/v1/ai/health') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAiHealth) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  const renderDashboard = () =>
    render(
      <AuthProvider>
        <DashboardPage
          onNavigateToOpportunities={onNavigateToOpportunities}
          onNavigateToTab={onNavigateToTab}
        />
      </AuthProvider>
    );

  it('renders command header with real user name, headline, and system status', async () => {
    renderDashboard();

    expect(await screen.findByText(/Mohammed/)).toBeInTheDocument();
    expect(screen.getByText('Full Stack AI Engineer & Automation Specialist')).toBeInTheDocument();
    expect(screen.getByText('Firestore Synced • AI Hub Active')).toBeInTheDocument();
  });

  it('calculates and displays live Career Pulse metrics without fake numbers', async () => {
    renderDashboard();

    // High-fit opportunities score >= 80%: 2 items ('job_high_fit_1' 91%, 'job_high_fit_2' 87%)
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('Score ≥ 80%')).toBeInTheDocument();

    // Ready to Submit: 1 item ('app_ready_1')
    expect(screen.getByText('1 Approved Resume')).toBeInTheDocument();

    // In-Flight: 1 item ('app_applied_1')
    expect(screen.getByText('In-Flight Apps')).toBeInTheDocument();

    // Saved backlog: 1 item ('job_saved_1')
    expect(screen.getByText('Saved Backlog')).toBeInTheDocument();
  });

  it('renders Action Required banner for Ready to Apply applications with quick actions', async () => {
    renderDashboard();

    expect(await screen.findByText(/Action Required: Ready for Submission/i)).toBeInTheDocument();
    expect(screen.getAllByText('Growth and Business Intern').length).toBeGreaterThan(0);
    expect(screen.getByText('88% ATS Match')).toBeInTheDocument();
    expect(screen.getByText('Tailored Resume Ready')).toBeInTheDocument();

    // Open portal external link
    const portalLink = screen.getByRole('link', { name: /Open Portal/i });
    expect(portalLink).toHaveAttribute('href', 'https://careers.cred.club/apply/123');

    // Mark as applied button triggers PATCH
    const markAppliedBtn = screen.getByRole('button', { name: /Mark as Applied/i });
    fireEvent.click(markAppliedBtn);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/applications/app_ready_1/status',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"newStatus":"applied"'),
        })
      );
    });
  });

  it('renders Strongest Recommended Matches with real live items and scores', async () => {
    renderDashboard();

    expect(await screen.findByText('Strongest Recommended Matches')).toBeInTheDocument();
    expect(screen.getAllByText('AI Fullstack Software Developer').length).toBeGreaterThan(0);
    expect(screen.getByText('Cloud & Data Systems Intern')).toBeInTheDocument();

    // Clicking Review & Apply calls onNavigateToOpportunities
    const reviewButtons = screen.getAllByRole('button', { name: /Review & Apply/i });
    expect(reviewButtons.length).toBeGreaterThan(0);
    fireEvent.click(reviewButtons[0]);
    expect(onNavigateToOpportunities).toHaveBeenCalled();
  });

  it('renders live Recent Activity and Career Assets & AI health without exposing secrets', async () => {
    renderDashboard();

    // Recent pipeline activity
    expect(await screen.findByText('Recent Pipeline Activity')).toBeInTheDocument();
    expect(screen.getByText(/Applied to Aristocrat IT Solutions/i)).toBeInTheDocument();

    // Career assets
    expect(screen.getByText('2 Tailored Resumes')).toBeInTheDocument();
    expect(screen.getByText(/ATS Score: 94% \(Grade A\+\)/i)).toBeInTheDocument();

    // AI Hub accurate description: 3 credentials across 2 providers (gemini, groq)
    expect(screen.getByText('3 AI Credentials · 2 Providers')).toBeInTheDocument();
    expect(screen.getByText(/100% Operational/i)).toBeInTheDocument();

    // Verify no secret tokens or keys are present
    expect(screen.queryByText(/AIza/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
  });

  it('handles completely empty datasets gracefully without errors or fake numbers', async () => {
    (fetchWithAuth as any).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    );

    renderDashboard();

    // Resolves with 0s and friendly empty state
    expect(await screen.findByText('Strongest Recommended Matches')).toBeInTheDocument();
    expect(screen.getByText('No recommended opportunities match your current filters.')).toBeInTheDocument();
    expect(screen.getByText('No recent application activity logged yet.')).toBeInTheDocument();
    expect(screen.getByText('0 Tailored Resumes')).toBeInTheDocument();
  });
});
