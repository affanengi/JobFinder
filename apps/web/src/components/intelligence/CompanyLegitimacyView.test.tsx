import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyLegitimacyView } from './CompanyLegitimacyView';
import * as api from '../../lib/api';
import { CompanyIntelligenceResult } from '../../types/companyIntelligence';

vi.mock('../../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

const mockSafeIntel: CompanyIntelligenceResult = {
  id: 'comp-intel-123',
  userId: 'user_test',
  opportunityId: 'opp_123',
  companyName: 'Acme Cloud Technologies',
  officialDomain: 'acmecloud.tech',
  careersUrl: 'https://careers.acmecloud.tech/jobs/123',
  riskTier: 'NO_OBVIOUS_RED_FLAGS_FOUND',
  summary: 'Verified official corporate careers domain. No payment solicitations found.',
  evaluatedDimensions: {
    domainConsistency: {
      status: 'PASS',
      evidence: 'Domain acmecloud.tech matches company.',
      confidence: 1.0,
    },
    paymentSolicitations: {
      status: 'PASS',
      evidence: 'Zero application or equipment fees.',
      confidence: 1.0,
    },
  },
  redFlags: [],
  positiveSignals: ['Verified enterprise portal'],
  sourceUrls: ['https://careers.acmecloud.tech/jobs/123'],
  researchedAt: new Date().toISOString(),
  ttlExpiresAt: new Date(Date.now() + 86400000 * 14).toISOString(),
  disclaimer: 'Absence of detected red flags does not constitute a legal guarantee of employer legitimacy.',
};

const mockScamIntel: CompanyIntelligenceResult = {
  id: 'comp-intel-scam',
  userId: 'user_test',
  opportunityId: 'opp_scam',
  companyName: 'Suspicious Corp',
  officialDomain: 'unverified-site.biz',
  careersUrl: 'https://unverified-site.biz/apply',
  riskTier: 'SIGNIFICANT_RED_FLAGS',
  summary: 'Upfront deposit scam detected.',
  evaluatedDimensions: {
    paymentSolicitations: {
      status: 'FAIL',
      evidence: 'Demands $200 onboarding software fee.',
      confidence: 1.0,
    },
  },
  redFlags: ['Demands $200 onboarding software fee', 'Directs candidates solely to Telegram'],
  positiveSignals: [],
  sourceUrls: ['https://unverified-site.biz/apply'],
  researchedAt: new Date().toISOString(),
  ttlExpiresAt: new Date(Date.now() + 86400000 * 14).toISOString(),
  disclaimer: 'Absence of detected red flags does not constitute a legal guarantee of employer legitimacy.',
};

describe('CompanyLegitimacyView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when opportunity has not yet been researched (404)', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    } as any);

    render(
      <CompanyLegitimacyView
        opportunityId="opp_123"
        companyName="Acme Cloud Technologies"
        opportunityUrl="https://careers.acmecloud.tech/jobs/123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No Research Generated Yet')).toBeInTheDocument();
    });

    expect(screen.getByText('Research Company & Scam Shield')).toBeInTheDocument();
  });

  it('triggers research and renders NO_OBVIOUS_RED_FLAGS_FOUND results', async () => {
    // Initial fetch returns 404
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    } as any);

    // Research POST returns mockSafeIntel
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSafeIntel,
    } as any);

    render(
      <CompanyLegitimacyView
        opportunityId="opp_123"
        companyName="Acme Cloud Technologies"
        opportunityUrl="https://careers.acmecloud.tech/jobs/123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Research Company & Scam Shield')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Research Company & Scam Shield'));

    await waitFor(() => {
      expect(screen.getByText('NO_OBVIOUS_RED_FLAGS_FOUND')).toBeInTheDocument();
      expect(screen.getByText('No Obvious Red Flags Detected')).toBeInTheDocument();
    });

    expect(screen.getByText(mockSafeIntel.summary)).toBeInTheDocument();
    expect(screen.getByText('acmecloud.tech')).toBeInTheDocument();
    expect(screen.getByText(mockSafeIntel.disclaimer)).toBeInTheDocument();
  });

  it('renders SIGNIFICANT_RED_FLAGS tier and warning red flags callout', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockScamIntel,
    } as any);

    render(
      <CompanyLegitimacyView
        opportunityId="opp_scam"
        companyName="Suspicious Corp"
        opportunityUrl="https://unverified-site.biz/apply"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('SIGNIFICANT_RED_FLAGS')).toBeInTheDocument();
      expect(screen.getByText('Significant Red Flags Detected')).toBeInTheDocument();
    });

    expect(screen.getByText(/Warning Signals & Red Flags/)).toBeInTheDocument();
    expect(screen.getByText('Demands $200 onboarding software fee')).toBeInTheDocument();
    expect(screen.getByText('Directs candidates solely to Telegram')).toBeInTheDocument();
  });

  it('displays error message and retry button when research request fails', async () => {
    vi.mocked(api.fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Target domain unreachable or protected by bot shield.' }),
    } as any);

    render(
      <CompanyLegitimacyView
        opportunityId="opp_err"
        companyName="Broken Corp"
        opportunityUrl="https://broken.invalid"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Company Intelligence Research Failed')).toBeInTheDocument();
      expect(screen.getByText('Target domain unreachable or protected by bot shield.')).toBeInTheDocument();
    });

    expect(screen.getByText('Retry Research')).toBeInTheDocument();
  });
});
