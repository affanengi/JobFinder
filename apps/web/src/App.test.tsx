import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App';

const MOCK_RECOMMENDATIONS = [
  {
    id: 'rec-1',
    title: 'AI Automation & Data Operations Intern',
    company: 'ScaleAI Innovations',
    location: 'Remote',
    workMode: 'remote',
    category: 'technical',
    employmentType: 'internship',
    seniority: 'internship',
    fitScore: 95,
    matchTier: 'Strong',
    fitReason: 'Exceptional fit with Python and Playwright.',
    matchedSkills: ['Python', 'FastAPI', 'Playwright'],
    missingSkills: ['Docker'],
    salaryText: 'INR 35,000 - 55,000 / month',
    description: 'Build automated AI agent workflows and data scraping pipelines.',
    sourceUrl: 'https://boards.greenhouse.io/scaleai/jobs/1',
    sourceAdapter: 'greenhouse',
    status: 'recommended',
  },
  {
    id: 'rec-2',
    title: 'Full Stack AI Developer Intern',
    company: 'CognitiveWorks Labs',
    location: 'Bangalore, India',
    workMode: 'hybrid',
    category: 'technical',
    employmentType: 'internship',
    seniority: 'internship',
    fitScore: 91,
    matchTier: 'Strong',
    fitReason: 'Strong match across React/FastAPI.',
    matchedSkills: ['React', 'TypeScript', 'FastAPI'],
    missingSkills: [],
    salaryText: 'INR 40,000 - 60,000 / month',
    description: 'Full stack AI platform development using Next.js and FastAPI.',
    sourceUrl: 'https://jobs.lever.co/cognitive/2',
    sourceAdapter: 'lever',
    status: 'recommended',
  },
];

const MOCK_PROFILE = {
  userId: 'user-affan',
  personal: {
    fullName: 'Mohammed Affan Razvi',
    email: 'mohammedaffanrazvi604@gmail.com',
    city: 'Hyderabad',
    country: 'India',
  },
  summary: 'AI Automation student with hands-on experience in Python and Playwright.',
  skills: [{ id: 's1', name: 'Python', verified: true, source: 'user', category: 'programming', proficiency: 'advanced' }],
  experience: [],
  education: [],
  projects: [],
  profileVersion: 1,
};

describe('JobFinder Notion-Style Dark Theme UI & Master Profile Hub', () => {
  beforeEach(() => {
    window.location.hash = '';
    try {
      localStorage.clear();
    } catch {}

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/recommendations')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(MOCK_RECOMMENDATIONS),
          });
        }
        if (url.includes('/api/v1/profile')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(MOCK_PROFILE),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      })
    );
  });

  it('renders the sidebar and default Opportunities page with recommendations', async () => {
    render(<App />);
    expect(screen.getByText('jobFinder')).toBeInTheDocument();
    expect(screen.getAllByText('Opportunities').length).toBeGreaterThan(0);
    expect(
      await screen.findByText(/AI Automation & Data Operations Intern/i)
    ).toBeInTheDocument();
  });

  it('navigates to Master Profile page when sidebar link is clicked', async () => {
    render(<App />);
    const profileBtn = screen.getByRole('button', { name: /Master Profile/i });
    fireEvent.click(profileBtn);

    expect(
      await screen.findByRole('heading', { name: /Master Profile & Truth/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Upload General Resume/i)
    ).toBeInTheDocument();
  });

  it('allows filtering by search keywords in opportunities', async () => {
    render(<App />);
    expect(
      await screen.findByText(/AI Automation & Data Operations Intern/i)
    ).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(
      /Search role, skills, company.../i
    );
    fireEvent.change(searchInput, { target: { value: 'Full Stack' } });

    expect(
      await screen.findByText(/Full Stack AI Developer Intern/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/AI Automation & Data Operations Intern/i)
    ).not.toBeInTheDocument();
  });

  it('renders CompanyFilterRibbon with live tab-scoped counts and filters by company', async () => {
    render(<App />);
    expect(await screen.findByText('All Companies')).toBeInTheDocument();
    
    // Check All Companies has count 2 inside its button
    const allCompBtn = screen.getByRole('button', { name: /All Companies/i });
    expect(allCompBtn).toHaveTextContent('2');

    // Check company chip for CognitiveWorks Labs
    const compChip = await screen.findByRole('button', { name: /Cognitiveworks Labs/i });
    expect(compChip).toBeInTheDocument();
    expect(compChip).toHaveTextContent('1');

    // Click company chip to filter
    fireEvent.click(compChip);

    // Only CognitiveWorks job should remain
    expect(screen.getByText(/Full Stack AI Developer Intern/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI Automation & Data Operations Intern/i)).not.toBeInTheDocument();

    // Click All Companies to reset
    fireEvent.click(allCompBtn);

    // Both should be visible again
    expect(screen.getByText(/Full Stack AI Developer Intern/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Automation & Data Operations Intern/i)).toBeInTheDocument();
  });

  it('opens Opportunity Details Modal when card body is clicked, but clicking title opens external link without opening modal', async () => {
    render(<App />);
    expect(await screen.findByText(/AI Automation & Data Operations Intern/i)).toBeInTheDocument();

    // 1. Click job title link: verify modal is NOT opened
    const titleLink = screen.getByRole('link', { name: /AI Automation & Data Operations Intern/i });
    expect(titleLink).toHaveAttribute('href', 'https://boards.greenhouse.io/scaleai/jobs/1');
    expect(titleLink).toHaveAttribute('target', '_blank');

    fireEvent.click(titleLink);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 2. Click card body (e.g. description container or match reason inside card)
    const reasonBox = screen.getByText(/Exceptional fit with Python and Playwright/i);
    fireEvent.click(reasonBox);

    // Modal dialog must now be open
    const modal = await screen.findByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Full Job Description/i })).toBeInTheDocument();
    expect(screen.getByText(/Build automated AI agent workflows/i)).toBeInTheDocument();

    // 3. Close modal with X button
    const closeBtn = screen.getByRole('button', { name: /Close details/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores active tab from URL hash on boot and handles hashchange navigation', async () => {
    window.location.hash = '#resumes';
    render(<App />);

    expect(await screen.findByText(/Tailored Resumes/i)).toBeInTheDocument();

    // Simulate browser Back/Forward (hashchange)
    window.location.hash = '#opportunities';
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(await screen.findByText('Ranked & scored match recommendations')).toBeInTheDocument();
  });

  it("renders structured job description with section headings and bullet points", async () => {
    render(<App />);
    expect(await screen.findByText(/AI Automation & Data Operations Intern/i)).toBeInTheDocument();

    // Click card body to open modal
    const reasonBox = screen.getByText(/Exceptional fit with Python and Playwright/i);
    fireEvent.click(reasonBox);

    const modal = await screen.findByRole("dialog");
    expect(modal).toBeInTheDocument();
    
    // Check that Full Job Description heading is present
    expect(screen.getByRole("heading", { name: /Full Job Description/i })).toBeInTheDocument();
    expect(screen.getByText(/Role Overview/i)).toBeInTheDocument();
  });
});
