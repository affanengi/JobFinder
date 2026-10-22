import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpportunitiesPage } from './OpportunitiesPage'
import { AuthProvider, mockTestUser } from '../context/AuthContext'
import { SyncProvider } from '../context/SyncContext'

// Mock API client
vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from '../lib/api'

const mockOpportunities = [
  {
    id: 'opp-1',
    title: 'Senior AI Engineer',
    company: 'Anthropic',
    location: 'San Francisco, CA',
    workMode: 'remote',
    category: 'technical',
    employmentType: 'Full-time',
    seniority: 'Senior',
    fitScore: 94,
    matchTier: 'Strong',
    fitReason: 'Strong alignment with Python, LLMs, and agentic workflows.',
    matchedSkills: ['Python', 'FastAPI', 'PyTorch'],
    missingSkills: ['Kubernetes'],
    salaryText: '$180,000 - $240,000',
    description: 'Build frontier AI platforms and automated reasoning tools.',
    sourceUrl: 'https://anthropic.com/careers/1',
    sourceAdapter: 'greenhouse',
    status: 'recommended',
  },
  {
    id: 'opp-2',
    title: 'Data Science Intern',
    company: 'DeepMind',
    location: 'London, UK',
    workMode: 'hybrid',
    category: 'data',
    employmentType: 'Internship',
    seniority: 'Internship',
    fitScore: 88,
    matchTier: 'Good',
    fitReason: 'Matches data structures and ML foundations.',
    matchedSkills: ['Python', 'SQL'],
    missingSkills: ['JAX'],
    salaryText: '£45,000',
    description: 'Explore novel deep learning architectures.',
    sourceUrl: 'https://deepmind.google/careers/2',
    sourceAdapter: 'lever',
    status: 'recommended',
  },
]

describe('OpportunitiesPage — Guest Mode & Authentication Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fetchWithAuth as any).mockImplementation((url: string, options?: any) => {
      if (url === '/api/v1/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => mockOpportunities,
        })
      }
      if (url.includes('/status') && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        })
      }
      if (url.includes('/discover') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 5 }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  const renderOpportunities = (user: any = mockTestUser) =>
    render(
      <AuthProvider initialUser={user}>
        <SyncProvider>
          <OpportunitiesPage />
        </SyncProvider>
      </AuthProvider>
    )

  it('renders public opportunities for guests without firing protected profile queries', async () => {
    renderOpportunities(null)

    expect(await screen.findByText('Senior AI Engineer')).toBeInTheDocument()
    expect(screen.getByText('Data Science Intern')).toBeInTheDocument()

    // Public recommendations endpoint was fetched
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/recommendations')

    // Protected endpoints were NOT called
    expect(fetchWithAuth).not.toHaveBeenCalledWith('/api/v1/profile')
    expect(fetchWithAuth).not.toHaveBeenCalledWith('/api/v1/applications')
  })

  it('opens contextual AuthModal when guest clicks Save/Bookmark without firing mutation', async () => {
    renderOpportunities(null)

    expect(await screen.findByText('Senior AI Engineer')).toBeInTheDocument()

    // Find and click the Save/Bookmark button on Senior AI Engineer
    const bookmarkBtn = screen.getByLabelText('Save Senior AI Engineer')
    fireEvent.click(bookmarkBtn)

    // Verify AuthModal opened with contextual copy
    await waitFor(() => {
      expect(screen.getByText('Sign in to Save Opportunity')).toBeInTheDocument()
    })

    // Ensure protected status mutation was NOT called
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      expect.stringContaining('/status'),
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('opens contextual AuthModal when guest clicks Tailor Resume without opening ResumeStudio', async () => {
    renderOpportunities(null)

    expect(await screen.findByText('Senior AI Engineer')).toBeInTheDocument()

    // Find Tailor button for the opportunity
    const tailorBtns = screen.getAllByRole('button', { name: /Tailor/i })
    fireEvent.click(tailorBtns[0])

    // Verify AuthModal opened with contextual copy
    await waitFor(() => {
      expect(screen.getByText('Sign in to Tailor Resume')).toBeInTheDocument()
    })
  })

  it('opens contextual AuthModal when guest clicks Run Discovery without calling crawler endpoint', async () => {
    renderOpportunities(null)

    // Find Run Discovery button in the header
    const discoveryBtn = screen.getByRole('button', { name: /Run Discovery/i })
    fireEvent.click(discoveryBtn)

    // Verify AuthModal opened with contextual copy
    await waitFor(() => {
      expect(screen.getByText('Sign in to Run Discovery')).toBeInTheDocument()
    })

    // Crawler endpoint must NOT be triggered
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      '/api/v1/jobs/discover',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('allows authenticated user to save opportunity and invokes status PATCH mutation', async () => {
    renderOpportunities(mockTestUser)

    expect(await screen.findByText('Senior AI Engineer')).toBeInTheDocument()

    // Click the Save/Bookmark button
    const bookmarkBtn = screen.getByLabelText('Save Senior AI Engineer')
    fireEvent.click(bookmarkBtn)

    // Verify status mutation was called on the server
    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/recommendations/opp-1/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'saved' }),
        })
      )
    })
  })
})
