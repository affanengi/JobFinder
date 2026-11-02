import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StakeholderDirectory } from './StakeholderDirectory';
import * as api from '../../lib/api';
import { DiscoveredContact, ContactSearchLink } from '../../types/opportunityContact';

vi.mock('../../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

const mockContacts: DiscoveredContact[] = [
  {
    id: 'contact-1',
    userId: 'user_test',
    opportunityId: 'opp_123',
    companyName: 'Acme Corp',
    fullName: 'Alice Smith',
    roleTitle: 'Senior Technical Recruiter',
    stakeholderTier: 'RECRUITER',
    location: 'Hyderabad, India',
    isHyderabad: true,
    email: 'alice@acme.com',
    emailClassification: 'PUBLICLY_LISTED',
    emailEvidenceSummary: 'Explicitly listed on official public careers page.',
    mxStatus: 'VALID_MX',
    sourceUrls: ['https://acme.com/careers'],
    evidenceSnippets: [],
    searchProviderUsed: 'company_page',
    confidenceScore: 0.85,
    rankingScore: 490,
    rankingReason: 'Stakeholder tier: Recruiter (+400) • Hyderabad location match (+50) • Publicly listed contact email (+40)',
    isDismissed: false,
    isReviewed: false,
    discoveredAt: new Date().toISOString(),
  },
  {
    id: 'contact-2',
    userId: 'user_test',
    opportunityId: 'opp_123',
    companyName: 'Acme Corp',
    fullName: 'Bob Jones',
    roleTitle: 'Engineering Manager',
    stakeholderTier: 'HIRING_MANAGER',
    location: 'Bengaluru, India',
    isHyderabad: false,
    email: 'bob@acme.com',
    emailClassification: 'DOMAIN_MAIL_ENABLED',
    emailEvidenceSummary: 'Domain has confirmed MX mail exchangers.',
    mxStatus: 'VALID_MX',
    sourceUrls: ['https://linkedin.com/in/bobjones'],
    evidenceSnippets: [],
    searchProviderUsed: 'exa',
    confidenceScore: 0.7,
    rankingScore: 325,
    rankingReason: 'Stakeholder tier: Hiring Manager (+300) • Domain mail enabled (+25)',
    isDismissed: false,
    isReviewed: false,
    discoveredAt: new Date().toISOString(),
  },
  {
    id: 'contact-3',
    userId: 'user_test',
    opportunityId: 'opp_123',
    companyName: 'Acme Corp',
    fullName: 'Charlie Davis',
    roleTitle: 'Staff Architect & Tech Lead',
    stakeholderTier: 'TECH_LEAD',
    location: 'Remote',
    isHyderabad: false,
    email: null,
    emailClassification: 'UNVERIFIED',
    emailEvidenceSummary: 'No public email address discovered for this contact.',
    mxStatus: 'UNCHECKED',
    sourceUrls: ['https://linkedin.com/in/charlie'],
    evidenceSnippets: [],
    searchProviderUsed: 'search',
    confidenceScore: 0.5,
    rankingScore: 200,
    rankingReason: 'Stakeholder tier: Tech Lead (+200)',
    isDismissed: false,
    isReviewed: false,
    discoveredAt: new Date().toISOString(),
  },
];

const mockSearchLinks: ContactSearchLink[] = [
  {
    title: 'Recruiters & Talent Acquisition (Acme Corp • Hyderabad)',
    query: 'site:linkedin.com/in "Acme Corp" recruiter Hyderabad',
    url: 'https://www.google.com/search?q=test_recruiter',
    platform: 'google',
  },
  {
    title: 'Hiring & Engineering Managers (Acme Corp • Hyderabad)',
    query: 'site:linkedin.com/in "Acme Corp" "engineering manager"',
    url: 'https://www.google.com/search?q=test_hm',
    platform: 'google',
  },
];

describe('StakeholderDirectory Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no contacts exist yet', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as any);

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No Professional Contacts Discovered Yet')).toBeInTheDocument();
    });

    expect(screen.getByText('Discover Contacts Now')).toBeInTheDocument();
  });

  it('renders discovered contacts list with stakeholder badges, evidence tiers, and Hyderabad match', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockContacts,
    } as any);

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('Charlie Davis')).toBeInTheDocument();
    });

    // Check stakeholder priority badges
    expect(screen.getByText('Recruiter / Talent')).toBeInTheDocument();
    expect(screen.getByText('Hiring Manager')).toBeInTheDocument();
    expect(screen.getByText('Technical Lead')).toBeInTheDocument();

    // Check Hyderabad location badge
    expect(screen.getByText('Hyderabad Match')).toBeInTheDocument();

    // Check 6-tier evidence classification badges
    expect(screen.getByText('Publicly Listed')).toBeInTheDocument();
    expect(screen.getByText('Domain Mail Enabled')).toBeInTheDocument();
    expect(screen.getByText('Unverified Address')).toBeInTheDocument();

    // Check MX status pill
    expect(screen.getAllByText('MX: VALID_MX')).toHaveLength(2);
  });

  it('triggers discover contacts and renders search fallback links', async () => {
    // Initial fetch returns empty
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as any);

    // POST /discover returns contacts + searchLinks
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        opportunityId: 'opp_123',
        companyName: 'Acme Corp',
        contacts: mockContacts,
        searchLinks: mockSearchLinks,
        providerUsed: 'fallback_links',
        costPolicyEnforced: 'FREE_ONLY',
        message: 'Discovered contacts',
      }),
    } as any);

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Discover Contacts Now')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Discover Contacts Now'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Free Browser Search Exploration Links')).toBeInTheDocument();
      expect(screen.getByText('Recruiters & Talent Acquisition (Acme Corp • Hyderabad)')).toBeInTheDocument();
    });
  });

  it('allows dismissing and un-dismissing a contact with toggle filter', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockContacts,
    } as any);

    // Mock PATCH /dismiss
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...mockContacts[0], isDismissed: true }),
    } as any);

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Dismiss first contact
    const dismissBtns = screen.getAllByTitle('Dismiss contact');
    expect(dismissBtns.length).toBeGreaterThan(0);
    fireEvent.click(dismissBtns[0]);

    // Now Alice Smith should be hidden unless "Show Dismissed" is clicked
    await waitFor(() => {
      expect(screen.getByText(/Show Dismissed/i)).toBeInTheDocument();
    });
  });

  it('toggles reviewed status for a contact', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockContacts,
    } as any);

    // Mock PATCH /review
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...mockContacts[0], isReviewed: true }),
    } as any);

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const reviewBtns = screen.getAllByTitle('Mark as reviewed');
    expect(reviewBtns.length).toBeGreaterThan(0);
    fireEvent.click(reviewBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('Reviewed')).toBeInTheDocument();
    });
  });

  it('renders error banner with retry action on failure', async () => {
    vi.mocked(api.fetchWithAuth).mockRejectedValueOnce(new Error('Network disconnected'));

    render(
      <StakeholderDirectory
        opportunityId="opp_123"
        companyName="Acme Corp"
        careersUrl="https://acme.com/careers"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Network error loading discovered contacts.')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
