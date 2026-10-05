import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecentActivitiesPage } from './RecentActivitiesPage';

vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from '../lib/api';

const mockSummary = {
  totalRequests: 42,
  successfulRequests: 40,
  failedRequests: 2,
  successRate: 95.2,
  averageLatencyMs: 380.5,
  fallbackCount: 5,
  providerDistribution: { gemini: 30, openrouter: 12 },
  taskDistribution: { resume_tailoring: 25, cover_letter_gen: 17 },
};

const mockCredentials = [
  { credentialId: 'cred_resume_1', friendlyName: 'Resume & Cover Letter Key', provider: 'gemini' },
  { credentialId: 'cred_sibling_2', friendlyName: 'QA Copilot Backup', provider: 'gemini' },
];

const mockPage1 = {
  items: [
    {
      executionId: 'exec_001',
      userId: 'user_test',
      operationId: 'op_batch_123',
      task: 'resume_tailoring',
      providerUsed: 'gemini',
      modelUsed: 'gemini-3.5-flash',
      credentialIdUsed: 'cred_resume_1',
      success: true,
      latencyMs: 320.5,
      fallbackLevel: 0,
      hopsCount: 1,
      costTier: 'FREE',
      preferredCredentialId: 'cred_resume_1',
      preferredRouteSkipped: false,
      attemptedHops: [
        {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          credential_id: 'cred_resume_1',
          status: 'SUCCESS',
          latency_ms: 320.5,
        },
      ],
      timestamp: '2026-10-05T18:00:00Z',
    },
    {
      executionId: 'exec_002',
      userId: 'user_test',
      operationId: 'op_batch_123',
      task: 'cover_letter_gen',
      providerUsed: 'gemini',
      modelUsed: 'gemini-3.8-flash',
      credentialIdUsed: 'cred_sibling_2',
      success: true,
      latencyMs: 850.0,
      fallbackLevel: 2,
      hopsCount: 2,
      costTier: 'FREE',
      preferredCredentialId: 'cred_resume_1',
      preferredRouteSkipped: true,
      preferredRouteSkipReason: 'RATE_LIMITED_OR_FAILED',
      attemptedHops: [
        {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          credential_id: 'cred_resume_1',
          status: 'FAILED',
          latency_ms: 250.0,
          error: 'Daily project quota exceeded',
        },
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          credential_id: 'cred_sibling_2',
          status: 'SUCCESS',
          latency_ms: 600.0,
        },
      ],
      timestamp: '2026-10-05T17:59:00Z',
    },
  ],
  next_cursor: '2026-10-05T17:59:00Z',
  has_more: true,
};

const mockPage2 = {
  items: [
    {
      executionId: 'exec_003',
      userId: 'user_test',
      operationId: null,
      task: 'ats_scanner',
      providerUsed: 'openrouter',
      modelUsed: 'meta-llama/llama-3.3-70b-instruct:free',
      credentialIdUsed: 'server_openrouter_credential',
      success: true,
      latencyMs: 1200.0,
      fallbackLevel: 0,
      hopsCount: 1,
      costTier: 'FREE',
      preferredCredentialId: null,
      preferredRouteSkipped: false,
      attemptedHops: [],
      timestamp: '2026-10-05T17:00:00Z',
    },
  ],
  next_cursor: null,
  has_more: false,
};

describe('RecentActivitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWithAuth).mockImplementation((url: string) => {
      if (url.includes('/api/v1/ai/telemetry/summary')) {
        return Promise.resolve({ ok: true, json: async () => mockSummary });
      }
      if (url.includes('/api/v1/ai/credentials')) {
        return Promise.resolve({ ok: true, json: async () => mockCredentials });
      }
      if (url.includes('/api/v1/ai/telemetry/history')) {
        if (url.includes('cursor=2026-10-05T17%3A59%3A00Z') || url.includes('cursor=2026-10-05T17:59:00Z')) {
          return Promise.resolve({ ok: true, json: async () => mockPage2 });
        }
        return Promise.resolve({ ok: true, json: async () => mockPage1 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('renders top metric summary cards and executions table', async () => {
    render(<RecentActivitiesPage />);

    // Metric cards
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('95.2%')).toBeInTheDocument();
      expect(screen.getByText('380.5ms')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    // Page 1 table content
    expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    expect(screen.getByText('cover_letter_gen')).toBeInTheDocument();
    expect(screen.getByText('Resume & Cover Letter Key')).toBeInTheDocument();
    expect(screen.getByText('QA Copilot Backup')).toBeInTheDocument();
    expect(screen.getByText('gemini-3.5-flash')).toBeInTheDocument();
    expect(screen.getByText('gemini-3.8-flash')).toBeInTheDocument();

    // Check fallback badge
    expect(screen.getByText(/L2 Credential/i)).toBeInTheDocument();
    expect(screen.getByText('Page 1 (More available)')).toBeInTheDocument();
  });

  it('supports cursor-based next and previous navigation', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeEnabled();

    // Click Next
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('ats_scanner')).toBeInTheDocument();
      expect(screen.getByText('meta-llama/llama-3.3-70b-instruct:free')).toBeInTheDocument();
      expect(screen.getByText('Page 2 (End of log)')).toBeInTheDocument();
    });

    // Previous should now be enabled
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    expect(prevBtn).toBeEnabled();

    // Click Previous
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
      expect(screen.getByText('Page 1 (More available)')).toBeInTheDocument();
    });
  });

  it('filters executions by task and provider', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    });

    const taskSelect = screen.getByLabelText('Filter by task');
    fireEvent.change(taskSelect, { target: { value: 'resume_tailoring' } });

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('task=resume_tailoring')
      );
    });

    const providerSelect = screen.getByLabelText('Filter by provider');
    fireEvent.change(providerSelect, { target: { value: 'gemini' } });

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('provider=gemini')
      );
    });
  });

  it('opens Hop Trace Inspector modal with full attempt breakdown', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('cover_letter_gen')).toBeInTheDocument();
    });

    // Click on Inspect Hops for exec_002
    const inspectBtn = screen.getByRole('button', { name: /Inspect Hops/i });
    fireEvent.click(inspectBtn);

    // Modal should be open
    await waitFor(() => {
      expect(screen.getByText(/Execution Trace: cover_letter_gen/i)).toBeInTheDocument();
      expect(screen.getByText(/Correlated 1-Shot Operation ID/i)).toBeInTheDocument();
      expect(screen.getByText('op_batch_123')).toBeInTheDocument();
      expect(screen.getByText(/Daily project quota exceeded/i)).toBeInTheDocument();
      expect(screen.getByText(/Attempted Hops Sequence \(2 Hops\)/i)).toBeInTheDocument();
    });
  });
});
