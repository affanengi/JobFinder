import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfilePage } from './ProfilePage';
import { AuthProvider, mockTestUser } from '../context/AuthContext';

// Mock api
vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from '../lib/api';

const mockProfile = {
  userId: 'user_default',
  personal: {
    fullName: 'Mohammed Affan Razvi',
    email: 'affan@example.com',
    phone: '+91 8978293087',
    city: 'Hyderabad',
    country: 'India',
    links: {
      github: 'https://github.com/affanengi',
      linkedin: 'https://linkedin.com/in/affan-razvi',
      portfolio: 'https://affan.dev',
    },
  },
  skills: [
    { id: 'sk_1', name: 'Python', category: 'Backend', confidence: 0.95 },
    { id: 'sk_2', name: 'FastAPI', category: 'Backend', confidence: 0.9 },
  ],
  projects: [
    {
      id: 'proj_1',
      name: 'Agentic OS',
      summary: 'Autonomous agentic workflow orchestrator',
      skills: ['Python', 'FastAPI'],
      metrics: [{ metric: 'Latency', value: '-45%', context: 'Reduced p99 latency' }],
    },
  ],
  experience: [
    {
      id: 'exp_1',
      company: 'Aristocrat IT Solutions',
      title: 'Fullstack AI Engineer',
      startDate: '2025-01-01',
      endDate: 'Present',
      bullets: ['Engineered scalable microservices'],
      skills: ['Python', 'Docker'],
      metrics: [],
    },
  ],
  education: [
    {
      id: 'edu_1',
      degree: 'B.Tech Computer Science',
      institution: 'JNTU',
      field: 'Computer Science',
      endDate: '2024',
      grade: 'Distinction',
    },
  ],
  courseCertifications: [],
  profileVersion: 1,
};

describe('ProfilePage Master Profile & Truth Experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderProfile = (user: any = mockTestUser) =>
    render(
      <AuthProvider initialUser={user}>
        <ProfilePage />
      </AuthProvider>
    );

  it('suppresses network call to /api/v1/profile and displays AuthRequiredEmptyState for guests', async () => {
    renderProfile(null);

    // Verify /api/v1/profile is NOT called when signed out
    expect(fetchWithAuth).not.toHaveBeenCalledWith('/api/v1/profile');

    // Verify deliberate sign-in onboarding experience replaces "Unable to Load Verified Profile"
    expect(await screen.findByText('Sign In to Build Your Verified Master Profile')).toBeInTheDocument();
    expect(screen.getByText('Verified Ground Truth')).toBeInTheDocument();
    expect(
      screen.getByText(/JobFinder grounds every tailored resume and cover letter exclusively in your verified career facts/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('Unable to Load Verified Profile')).not.toBeInTheDocument();
  });

  it('opens contextual AuthModal when guest clicks Upload General Resume or Edit Profile', async () => {
    renderProfile(null);

    expect(await screen.findByText('Sign In to Build Your Verified Master Profile')).toBeInTheDocument();

    // Click "Upload General Resume"
    const uploadBtn = screen.getByRole('button', { name: /Upload General Resume/i });
    fireEvent.click(uploadBtn);

    // Contextual modal opens with resume upload title
    expect(await screen.findByText('Sign in to Upload Resume')).toBeInTheDocument();
    expect(screen.getByText(/extract and save verified career facts/i)).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeBtn);

    // Click "Edit Profile"
    const editBtn = screen.getByRole('button', { name: /Edit Profile/i });
    fireEvent.click(editBtn);

    // Contextual modal opens with profile edit title
    expect(await screen.findByText('Sign in to Edit Profile')).toBeInTheDocument();
    expect(screen.getByText(/create, update, and manage your verified career facts/i)).toBeInTheDocument();
  });

  it('loads and displays verified profile facts when user is authenticated', async () => {
    (fetchWithAuth as any).mockImplementation((url: string) => {
      if (url === '/api/v1/profile') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderProfile(mockTestUser);

    // Verify /api/v1/profile was requested
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/profile');

    // Verify verified candidate facts appear
    expect(await screen.findByText('Mohammed Affan Razvi')).toBeInTheDocument();
    expect(screen.getByText('affan@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hyderabad, India')).toBeInTheDocument();
    expect(screen.getByText('Aristocrat IT Solutions')).toBeInTheDocument();
    expect(screen.getByText('Fullstack AI Engineer')).toBeInTheDocument();
    expect(screen.getByText('B.Tech Computer Science')).toBeInTheDocument();
    expect(screen.getAllByText('Agentic OS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Deterministic Grounding Active')).toBeInTheDocument();
  });

  it('renders genuine backend failure error state with retry button when authenticated fetch fails', async () => {
    (fetchWithAuth as any).mockImplementation((url: string) => {
      if (url === '/api/v1/profile') {
        return Promise.resolve({
          ok: false,
          status: 500,
        });
      }
      return Promise.resolve({ ok: false });
    });

    renderProfile(mockTestUser);

    // Authenticated user experiencing actual server failure sees error state with retry
    expect(await screen.findByText('Unable to Load Verified Profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry Connection/i })).toBeInTheDocument();
  });
});
