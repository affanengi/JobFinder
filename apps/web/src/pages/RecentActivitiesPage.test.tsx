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
  indeterminateRequests: 0,
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
      preferenceConfigured: true,
      preferredCredentialId: 'cred_resume_1',
      preferredRouteSkipped: false,
      preferenceStatus: 'CONFIRMED_PREFERRED_ATTEMPTED',
      executionResult: 'SUCCESS',
      routeClassification: 'DIRECT_ROUTE',
      executionOutcome: 'DIRECT_SUCCESS',
      traceStatus: 'RECORDED_DIRECT',
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
      preferenceConfigured: true,
      preferredCredentialId: 'cred_resume_1',
      preferredRouteSkipped: true,
      preferredRouteSkipReason: 'RATE_LIMITED_OR_FAILED',
      preferenceStatus: 'CONFIRMED_PREFERRED_SKIPPED_REASON',
      executionResult: 'SUCCESS',
      routeClassification: 'FALLBACK_ROUTE',
      executionOutcome: 'FALLBACK_SUCCESS',
      traceStatus: 'RECORDED_MULTI_HOP',
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
    {
      executionId: 'exec_hist_003',
      userId: 'user_test',
      operationId: null,
      task: 'resume_generation',
      providerUsed: 'gemini',
      modelUsed: 'gemini-2.5-flash',
      credentialIdUsed: 'cred_resume_1',
      success: true,
      latencyMs: 400.0,
      fallbackLevel: 1,
      hopsCount: 2,
      costTier: 'FREE',
      preferenceConfigured: null,
      preferredCredentialId: null,
      preferredRouteSkipped: false,
      preferenceStatus: 'PREFERENCE_NOT_RECORDED',
      executionResult: 'SUCCESS',
      routeClassification: 'FALLBACK_ROUTE',
      executionOutcome: 'FALLBACK_SUCCESS',
      traceStatus: 'INCOMPLETE_MULTI_HOP',
      attemptedHops: null,
      timestamp: '2026-10-03T10:00:00Z',
    },
  ],
  nextCursor: '2026-10-03T10:00:00Z',
  hasMore: true,
};

const mockPage2 = {
  items: [
    {
      executionId: 'exec_004',
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
      preferenceConfigured: false,
      preferredCredentialId: null,
      preferredRouteSkipped: false,
      preferenceStatus: 'CONFIRMED_NO_PREFERENCE',
      executionResult: 'SUCCESS',
      routeClassification: 'UNKNOWN_ROUTE',
      executionOutcome: 'SUCCESS_UNKNOWN_ROUTE',
      traceStatus: 'TRACE_UNAVAILABLE',
      attemptedHops: null,
      timestamp: '2026-10-02T17:00:00Z',
    },
  ],
  nextCursor: null,
  hasMore: false,
};

describe('RecentActivitiesPage', () => {
  const createResponse = (data: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWithAuth).mockImplementation((url: string) => {
      if (url.includes('/api/v1/ai/telemetry/history')) {
        if (
          url.includes('cursor=2026-10-03T10%3A00%3A00Z') ||
          url.includes('cursor=2026-10-03T10:00:00Z')
        ) {
          return createResponse(mockPage2);
        }
        return createResponse(mockPage1);
      }
      if (url.includes('/api/v1/ai/telemetry')) {
        // Test boxed TelemetryResponse structure
        return createResponse({
          summary: mockSummary,
          recentExecutions: [],
          timestamp: '2026-10-06T12:00:00Z',
        });
      }
      if (url.includes('/api/v1/ai/credentials')) {
        return createResponse(mockCredentials);
      }
      return createResponse({});
    });
  });

  it('unboxes summary metrics and renders cards with non-zero values', async () => {
    render(<RecentActivitiesPage />);

    // Metric cards must display non-zero unboxed values
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('95.2%')).toBeInTheDocument();
      expect(screen.getByText('380.5ms')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('renders preference and outcome badges accurately', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    });

    // Dimension 1: Preference Badges
    expect(screen.getByText('Preferred Attempted')).toBeInTheDocument();
    expect(screen.getByText(/Skipped \(RATE_LIMITED_OR_FAILED\)/i)).toBeInTheDocument();
    expect(screen.getByText('Preference Not Recorded')).toBeInTheDocument();

    // Dimension 2: Execution Outcome Badges
    expect(screen.getByText('Direct Success')).toBeInTheDocument();
    expect(screen.getAllByText('Fallback Success').length).toBeGreaterThan(0);
  });

  it('supports cursor pagination navigation and casing compatibility', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeEnabled();

    // Navigate to Page 2
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('ats_scanner')).toBeInTheDocument();
      expect(screen.getByText('No Preference')).toBeInTheDocument();
      expect(screen.getByText('Success (Route Unverified)')).toBeInTheDocument();
      expect(screen.getByText('Page 2 (End of log)')).toBeInTheDocument();
    });

    // Navigate back to Page 1
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    expect(prevBtn).toBeEnabled();
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
      expect(screen.getByText('Page 1 (More available)')).toBeInTheDocument();
    });
  });

  it('propagates filter changes to BOTH summary and history endpoints', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_tailoring')).toBeInTheDocument();
    });

    const taskSelect = screen.getByLabelText('Filter by task');
    fireEvent.change(taskSelect, { target: { value: 'resume_tailoring' } });

    await waitFor(() => {
      // Both telemetry summary and history must receive the task filter
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/ai\/telemetry\?task=resume_tailoring/),
        expect.anything()
      );
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/ai\/telemetry\/history\?.*task=resume_tailoring/),
        expect.anything()
      );
    });

    // Reset Filters button appears and resets state
    const resetBtn = screen.getByRole('button', { name: /Reset Filters/i });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/telemetry',
        expect.anything()
      );
    });
  });

  it('opens Trace Modal for multi-hop execution showing step sequence and route summary banner', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('cover_letter_gen')).toBeInTheDocument();
    });

    // Click on Inspect Hops for exec_002
    const inspectButtons = screen.getAllByRole('button', { name: /Inspect Hops/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Execution Trace: cover_letter_gen/i)).toBeInTheDocument();
      expect(screen.getByText('RECORDED_MULTI_HOP')).toBeInTheDocument();
      expect(screen.getByText(/Attempted Hops Sequence \(2 Hops\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Daily project quota exceeded/i)).toBeInTheDocument();
    });
  });

  it('shows Historical Multi-Hop Notice for multi-hop records with missing hop lists', async () => {
    render(<RecentActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('resume_generation')).toBeInTheDocument();
    });

    // Click on row for exec_hist_003
    const row = screen.getByText('resume_generation').closest('tr')!;
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText(/Historical Multi-Hop Notice/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Detailed step-by-step trace was not captured for this execution/i)
      ).toBeInTheDocument();
      // Must NOT show "Single direct attempt using..."
      expect(screen.queryByText(/Single direct attempt using/i)).not.toBeInTheDocument();
    });
  });
});
