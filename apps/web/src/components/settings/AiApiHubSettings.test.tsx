import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AiApiHubSettings } from './AiApiHubSettings'

// Mock API client
vi.mock('../../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from '../../lib/api'

const mockCredentials = [
  {
    credentialId: 'cred_gemini_1',
    provider: 'gemini',
    friendlyName: 'My Gemini Key',
    maskedApiKey: 'AIzaSy...4X9Q',
    projectScope: {
      scope_id: 'gcp-prod-001',
      scope_type: 'USER_DECLARED_PROJECT',
      verified: false,
    },
    costTier: 'FREE_TIER',
    enabled: true,
    createdAt: '2026-09-29T10:00:00Z',
  },
  {
    credentialId: 'cred_openrouter_1',
    provider: 'openrouter',
    friendlyName: 'My OpenRouter Key',
    maskedApiKey: 'sk-or-v1-...99AA',
    costTier: 'FREE_TIER',
    enabled: true,
    createdAt: '2026-09-29T11:00:00Z',
  },
]

const mockSettings = {
  costPolicy: 'FREE_ONLY',
  allowPaidFallback: false,
  taskRouting: {
    resume_generation: 'gemini',
    ats_bulk_rewrite: 'groq',
  },
}

const mockHealth = {
  providers: [
    { provider: 'gemini', operational: true, registeredModelsCount: 7 },
    { provider: 'openrouter', operational: true, registeredModelsCount: 6 },
    { provider: 'groq', operational: true, registeredModelsCount: 4 },
  ],
  credentialStatuses: {
    cred_gemini_1: 'HEALTHY',
    cred_openrouter_1: 'HEALTHY',
  },
  activeCooldowns: [],
  healthyCredentialsCount: 2,
  totalCredentialsCount: 2,
  timestamp: '2026-09-29T12:00:00Z',
}

const mockModels = [
  {
    modelId: 'gemini-2.5-flash',
    provider: 'gemini',
    displayName: 'Gemini 2.5 Flash',
    capabilities: ['Structured JSON', 'High Reasoning'],
    contextWindow: 1048576,
    costTier: 'FREE',
    defaultPriority: 1,
    isAvailable: true,
  },
  {
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    displayName: 'Llama 3.3 70B Instruct (Free)',
    capabilities: ['Fast Inference'],
    contextWindow: 131072,
    costTier: 'FREE',
    defaultPriority: 2,
    isAvailable: true,
  },
  {
    modelId: 'llama-3.3-70b-versatile',
    provider: 'groq',
    displayName: 'Groq Llama 3.3 70B',
    capabilities: ['Ultra Fast'],
    contextWindow: 32768,
    costTier: 'FREE',
    defaultPriority: 3,
    isAvailable: true,
  },
]

const mockTelemetry = {
  summary: {
    totalRequests: 14,
    successfulRequests: 14,
    failedRequests: 0,
    successRate: 100.0,
    averageLatencyMs: 420,
    fallbackCount: 1,
    providerDistribution: { gemini: 10, openrouter: 4 },
    taskDistribution: { resume_generation: 8, ats_bulk_rewrite: 6 },
  },
  recentExecutions: [
    {
      executionId: 'exec_001',
      userId: 'user_123',
      task: 'resume_generation',
      providerUsed: 'gemini',
      modelUsed: 'gemini-2.5-flash',
      credentialIdUsed: 'cred_gemini_1',
      success: true,
      latencyMs: 380,
      fallbackLevel: 0,
      hopsCount: 1,
      failureCategory: null,
      costTier: 'FREE_TIER',
      timestamp: '2026-09-29T12:05:00Z',
    },
  ],
}

describe('AiApiHubSettings - Forensic Audit & Refinement Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchWithAuth).mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/v1/ai/credentials') {
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              credentialId: `cred_${Date.now()}`,
              provider: body.provider,
              friendlyName: body.friendlyName,
              maskedApiKey: 'sk-new-...9999',
              projectScope: body.projectScope,
              costTier: body.costTier || 'FREE_TIER',
              enabled: true,
              createdAt: new Date().toISOString(),
            }),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockCredentials,
        } as Response)
      }
      if (url.startsWith('/api/v1/ai/credentials/') && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string)
        const credId = url.replace('/api/v1/ai/credentials/', '')
        return Promise.resolve({
          ok: true,
          json: async () => ({
            credentialId: credId,
            provider: 'gemini',
            friendlyName: body.friendlyName,
            maskedApiKey: body.apiKey ? 'AIzaSy...9999' : 'AIzaSy...4X9Q',
            projectScope: body.projectScope || {
              scope_id: 'gcp-prod-001',
              scope_type: 'USER_DECLARED_PROJECT',
              verified: false,
            },
            costTier: body.costTier || 'FREE_TIER',
            enabled: true,
            createdAt: '2026-09-29T10:00:00Z',
          }),
        } as Response)
      }
      if (url === '/api/v1/ai/settings') {
        if (options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: async () => JSON.parse(options.body as string),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockSettings,
        } as Response)
      }
      if (url === '/api/v1/ai/health') {
        return Promise.resolve({
          ok: true,
          json: async () => mockHealth,
        } as Response)
      }
      if (url === '/api/v1/ai/models') {
        return Promise.resolve({
          ok: true,
          json: async () => mockModels,
        } as Response)
      }
      if (url === '/api/v1/ai/telemetry') {
        return Promise.resolve({
          ok: true,
          json: async () => mockTelemetry,
        } as Response)
      }
      if (url.includes('/probe')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            credentialId: 'cred_gemini_1',
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            success: true,
            latencyMs: 312,
            message: 'Connection probe succeeded',
            healthStatus: 'HEALTHY',
            timestamp: new Date().toISOString(),
          }),
        } as Response)
      }
      if (url.includes('/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
  })

  it('renders the compact header and status strip with live metrics', async () => {
    render(<AiApiHubSettings />)

    expect(screen.getByText('AI / API Hub')).toBeDefined()
    expect(screen.getByText('Manage your AI providers, credentials and routing.')).toBeDefined()

    await waitFor(() => {
      // 2 configured out of 3
      expect(screen.getByText('2 of 3')).toBeDefined()
      // Live request count appears in status strip and AI usage
      expect(screen.getAllByText('14').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('switches provider tabs and shows contextual credentials, empty states, and guidance', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    // Gemini guidance should be visible
    expect(
      screen.getByText(/Gemini quota is associated with the Google Cloud project/i)
    ).toBeDefined()

    // Switch to OpenRouter tab
    const openRouterTab = screen.getByTestId('provider-tab-openrouter')
    fireEvent.click(openRouterTab)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My OpenRouter Key')).toBeDefined()
      // Gemini key should no longer be in the filtered table
      expect(within(screen.getByTestId('credentials-table')).queryByText('My Gemini Key')).toBeNull()
    })

    // Gemini GCP project warning should NOT be shown on OpenRouter tab
    expect(
      screen.queryByText(/Gemini quota is associated with the Google Cloud project/i)
    ).toBeNull()

    // OpenRouter guidance should be displayed
    expect(screen.getByText(/OpenRouter free endpoints/i)).toBeDefined()

    // Switch to Groq tab (0 configured keys -> renders intentional empty state card)
    const groqTab = screen.getByTestId('provider-tab-groq')
    fireEvent.click(groqTab)

    await waitFor(() => {
      expect(screen.getAllByText('No Groq credentials configured').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/Add a Groq API key to enable Groq models/i).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('opens provider-specific credential modal using shared portal with contextual fields and read-only provider indicator', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    // Open Gemini Add Credential Modal
    const addGeminiBtn = screen.getByRole('button', { name: /Add Gemini Credential/i })
    fireEvent.click(addGeminiBtn)

    // Modal is portaled to document.body, title shows Add Gemini Credential
    expect(screen.getAllByText('Add Gemini Credential').length).toBeGreaterThanOrEqual(2)
    // Read-only indicator shows Google Gemini
    expect(screen.getByText('Adding credential for')).toBeDefined()
    expect(screen.getAllByText('Google Gemini').length).toBeGreaterThanOrEqual(2)
    // Gemini modal should show Project Scope ID field
    expect(screen.getByText('Google Cloud Project ID (Optional)')).toBeDefined()

    // Cancel and close
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByText('Google Cloud Project ID (Optional)')).toBeNull()
    })

    // Switch to OpenRouter
    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i })
    fireEvent.click(openRouterTab)

    // Open OpenRouter Add Credential Modal
    const addOpenRouterBtn = screen.getByRole('button', { name: /Add OpenRouter Credential/i })
    fireEvent.click(addOpenRouterBtn)

    // Modal title shows Add OpenRouter Credential
    expect(screen.getAllByText('Add OpenRouter Credential').length).toBeGreaterThanOrEqual(2)
    // OpenRouter modal must NOT show Google Cloud Project ID field
    expect(screen.queryByText('Google Cloud Project ID (Optional)')).toBeNull()
  })

  it('submits a new credential to POST /api/v1/ai/credentials', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    const addBtn = screen.getByRole('button', { name: /Add Gemini Credential/i })
    fireEvent.click(addBtn)

    const nameInput = screen.getByPlaceholderText(/My Gemini Key/i)
    const keyInput = screen.getByPlaceholderText(/Enter provider API key/i)

    fireEvent.change(nameInput, { target: { value: 'New Test Gemini' } })
    fireEvent.change(keyInput, { target: { value: 'AIzaSyTestKey123' } })

    const saveBtn = screen.getByRole('button', { name: /Save Credential/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/credentials',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
  })

  it('deletes credential using shared DeleteConfirmModal', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    // Click trash button
    const deleteBtn = screen.getByTitle('Delete credential')
    fireEvent.click(deleteBtn)

    // DeleteConfirmModal should be open
    expect(screen.getByText('Delete Provider Credential')).toBeDefined()
    expect(screen.getByText('Permanent Deletion Confirmation')).toBeDefined()

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: /^Delete$/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/credentials/cred_gemini_1',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  it('toggles credential active status via PATCH /api/v1/ai/credentials/:id/status', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    const activeBtn = screen.getByRole('button', { name: /^Active$/i })
    fireEvent.click(activeBtn)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/credentials/cred_gemini_1/status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        })
      )
    })
  })

  it('tests connection probe via POST /api/v1/ai/credentials/:id/probe', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    const testBtn = screen.getByRole('button', { name: /Test Connection/i })
    fireEvent.click(testBtn)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/credentials/cred_gemini_1/probe',
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(screen.getByText(/Probe OK \(312ms\)/i)).toBeDefined()
    })
  })

  it('renders the visual task routing map with animated connections and handles preference change', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Task Routing Map')).toBeDefined()
      expect(screen.getByText('Resume Tailoring')).toBeDefined()
      expect(screen.getByText('ATS Scanner & Rewriter')).toBeDefined()
    })

    // Find select for Cover Letter Generation (which defaults to auto)
    const select = screen.getByLabelText(/Preferred provider for Cover Letter Generation/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'gemini' } })

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/settings',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"cover_letter_generation":"gemini"'),
        })
      )
    })
  })

  it('changes cost policy and conditionally reveals paid fallback toggle', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Free Only')).toBeDefined()
    })

    // In FREE_ONLY, Paid Fallback toggle should NOT be visible
    expect(screen.queryByText('Allow Paid Fallback')).toBeNull()

    // Switch to Free Preferred
    const freePrefRadio = screen.getByLabelText(/Free Preferred/i)
    fireEvent.click(freePrefRadio)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ costPolicy: 'FREE_PREFERRED' }),
        })
      )
    })

    // Paid Fallback toggle should now appear
    expect(screen.getByText('Allow Paid Fallback')).toBeDefined()
  })

  it('renders sticky sidebar with System Status and How Routing Works details modal', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('System Status')).toBeDefined()
      expect(screen.getByText('How Routing Works')).toBeDefined()
    })

    // Open How Routing Works details modal
    const viewDetailsBtn = screen.getByRole('button', { name: /View details/i })
    fireEvent.click(viewDetailsBtn)

    expect(screen.getByText(/3-Tier Unified Fallback Architecture/i)).toBeDefined()
    expect(screen.getByText(/Level 1: Intra-Credential Model Fallback/i)).toBeDefined()
    expect(screen.getByText(/Level 2: Distinct Project \/ Credential Fallback/i)).toBeDefined()
    expect(screen.getByText(/Level 3: Cross-Provider Failover/i)).toBeDefined()

    // Close modal
    const closeBtn = screen.getAllByRole('button', { name: /Close/i })[0]
    fireEvent.click(closeBtn)
  })

  it('opens Model Catalog modal with sticky opaque header, search filter, and catalog disclaimer', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Model Catalog')).toBeDefined()
    })

    const viewCatalogBtn = screen.getByRole('button', { name: /View Model Catalog/i })
    fireEvent.click(viewCatalogBtn)

    expect(screen.getByText('Known Model Catalog')).toBeDefined()
    expect(screen.getByText(/Catalog fact vs User access/i)).toBeDefined()
    expect(screen.getAllByText('gemini-2.5-flash').length).toBeGreaterThanOrEqual(1)

    // Close modal
    const closeBtn = screen.getAllByRole('button', { name: /Close/i })[0]
    fireEvent.click(closeBtn)
  })

  it('renders AI Usage activity and handles refresh', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Recent AI Activity')).toBeDefined()
      expect(screen.getByText('resume_generation')).toBeDefined()
      expect(screen.getByText('380ms')).toBeDefined()
    })

    const refreshUsageBtn = screen.getByRole('button', { name: /Refresh usage/i })
    fireEvent.click(refreshUsageBtn)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/ai/telemetry')
    })
  })

  it('persists route removal when reset to auto is triggered and omits the key from payload', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Task Routing Map')).toBeDefined()
    })

    // Initially resume_generation is routed to gemini
    const resumeSelect = screen.getByLabelText(/Preferred provider for Resume Tailoring/i) as HTMLSelectElement
    expect(resumeSelect.value).toBe('gemini')

    // Change to auto (Reset to Auto)
    fireEvent.change(resumeSelect, { target: { value: 'auto' } })

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ taskRouting: { ats_bulk_rewrite: 'groq' } }),
        })
      )
    })
  })

  it('reverts optimistic routing update if the server PUT request fails', async () => {
    // Force PUT to fail with 500 error
    vi.mocked(fetchWithAuth).mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/v1/ai/settings' && options?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: 'Database error: Failed to save AI settings.' }),
        } as Response)
      }
      if (url === '/api/v1/ai/credentials') {
        return Promise.resolve({ ok: true, json: async () => mockCredentials } as Response)
      }
      if (url === '/api/v1/ai/settings') {
        return Promise.resolve({ ok: true, json: async () => mockSettings } as Response)
      }
      if (url === '/api/v1/ai/health') {
        return Promise.resolve({ ok: true, json: async () => mockHealth } as Response)
      }
      if (url === '/api/v1/ai/models') {
        return Promise.resolve({ ok: true, json: async () => mockModels } as Response)
      }
      if (url === '/api/v1/ai/telemetry') {
        return Promise.resolve({ ok: true, json: async () => mockTelemetry } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })

    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(screen.getByText('Task Routing Map')).toBeDefined()
    })

    const select = screen.getByLabelText(/Preferred provider for Cover Letter Generation/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'openrouter' } })

    // Verify error was handled and rolled back
    await waitFor(() => {
      expect(select.value).toBe('auto')
    })
  })

  it('opens edit credential modal, pre-populates existing values, and submits updates via PUT', async () => {
    render(<AiApiHubSettings />)

    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('My Gemini Key')).toBeDefined()
    })

    // Click the Edit button for "My Gemini Key"
    const editBtn = screen.getByLabelText('Edit My Gemini Key')
    expect(editBtn).toBeDefined()
    fireEvent.click(editBtn)

    // Verify Edit Modal is visible with prefilled fields
    await waitFor(() => {
      expect(screen.getByText('Edit Credential')).toBeDefined()
      expect(screen.getByText('Vault Security:')).toBeDefined()
    })

    const nameInput = screen.getByPlaceholderText('e.g. My Primary Key') as HTMLInputElement
    expect(nameInput.value).toBe('My Gemini Key')

    const projectInput = screen.getByPlaceholderText('e.g. my-gemini-project-123') as HTMLInputElement
    expect(projectInput.value).toBe('gcp-prod-001')

    // Change the name and project scope
    fireEvent.change(nameInput, { target: { value: 'Renamed Gemini Key' } })
    fireEvent.change(projectInput, { target: { value: 'gcp-staging-002' } })

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveBtn)

    // Verify PUT request was made with correct payload
    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/v1/ai/credentials/cred_gemini_1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            friendlyName: 'Renamed Gemini Key',
            costTier: 'FREE_TIER',
            projectScope: {
              scope_id: 'gcp-staging-002',
              scope_type: 'USER_DECLARED_PROJECT',
              verified: false,
            },
          }),
        })
      )
    })

    // Verify UI reflects the updated name in credentials table
    await waitFor(() => {
      expect(within(screen.getByTestId('credentials-table')).getByText('Renamed Gemini Key')).toBeDefined()
      expect(screen.queryByText('Edit Credential')).toBeNull()
    })
  })
})

