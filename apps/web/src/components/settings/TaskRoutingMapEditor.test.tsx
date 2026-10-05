import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TaskRoutingMapEditor, CredentialItem } from './TaskRoutingMapEditor'

const mockCredentials: CredentialItem[] = [
  {
    id: 'cred_gemini_1',
    credentialId: 'cred_gemini_1',
    provider: 'gemini',
    friendlyName: 'Gemini API Key 1',
    maskedApiKey: 'AIza...4X9Q',
    costTier: 'FREE_TIER',
    isActive: true,
  },
  {
    id: 'cred_gemini_2',
    credentialId: 'cred_gemini_2',
    provider: 'gemini',
    friendlyName: 'Resume Gemini',
    maskedApiKey: 'AIza...88ZZ',
    costTier: 'FREE_TIER',
    isActive: true,
  },
  {
    id: 'cred_openrouter_paid',
    credentialId: 'cred_openrouter_paid',
    provider: 'openrouter',
    friendlyName: 'Paid OpenRouter',
    maskedApiKey: 'sk-or...55AA',
    costTier: 'PAID_TIER',
    isActive: true,
  },
]

describe('TaskRoutingMapEditor Component', () => {
  it('renders all 6 JobFinder tasks on the left and 3 providers on the right', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    // Verify 6 tasks
    expect(screen.getByText('Resume Tailoring')).toBeDefined()
    expect(screen.getByText('Cover Letter Generation')).toBeDefined()
    expect(screen.getByText('ATS Scanner & Rewriter')).toBeDefined()
    expect(screen.getByText('Q&A Co-pilot Answerer')).toBeDefined()
    expect(screen.getByText('Resume PDF Parser')).toBeDefined()
    expect(screen.getByText('Job Discovery & Ingestion')).toBeDefined()

    // Verify 3 providers
    expect(screen.getAllByText('Google Gemini').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('OpenRouter').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Groq').length).toBeGreaterThanOrEqual(1)

    // 0 configured routes -> onboarding helper is visible
    expect(screen.getByText(/Drag a connection from a task handle/i)).toBeDefined()
  })

  it('renders credential child nodes with friendly names and masked keys', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    expect(screen.getByText('Gemini API Key 1')).toBeDefined()
    expect(screen.getByText('Resume Gemini')).toBeDefined()
    expect(screen.getByText('Paid OpenRouter')).toBeDefined()
    expect(screen.getByText('AIza...4X9Q')).toBeDefined()
  })

  it('handles click-to-connect from task handle to credential handle', async () => {
    const handleSave = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={handleSave}
        onRemoveRoute={vi.fn()}
      />
    )

    // Click output handle on Resume Tailoring
    const resumeHandle = screen.getByTitle('Drag or click to route Resume Tailoring')
    fireEvent.click(resumeHandle)

    // Click input handle on Gemini API Key 1
    const credHandle = screen.getByTitle('Route specifically to Gemini API Key 1')
    fireEvent.click(credHandle)

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith('resume_generation', 'cred_gemini_1')
    })
  })

  it('handles click-to-connect to a provider-level target', async () => {
    const handleSave = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={handleSave}
        onRemoveRoute={vi.fn()}
      />
    )

    // Click output handle on Cover Letter Generation
    const coverHandle = screen.getByTitle('Drag or click to route Cover Letter Generation')
    fireEvent.click(coverHandle)

    // Click provider-level handle on Google Gemini
    const geminiHandle = screen.getByTitle('Route to Google Gemini (Provider-level preference)')
    fireEvent.click(geminiHandle)

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith('cover_letter_generation', 'gemini')
    })
  })

  it('blocks routing paid credentials when cost policy is FREE_ONLY and shows clear warning', async () => {
    const handleSave = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={handleSave}
        onRemoveRoute={vi.fn()}
      />
    )

    // Click output handle on ATS Scanner
    const atsHandle = screen.getByTitle('Drag or click to route ATS Scanner & Rewriter')
    fireEvent.click(atsHandle)

    // Click input handle on Paid OpenRouter
    const paidHandle = screen.getByTitle(/Paid tier blocked under Free Only/i)
    fireEvent.click(paidHandle)

    // Should NOT save route
    expect(handleSave).not.toHaveBeenCalled()

    // Should show warning banner
    expect(
      screen.getByText(
        /"Paid OpenRouter" is classified as Paid and cannot be routed under the Free Only cost policy/i
      )
    ).toBeDefined()
  })

  it('inspects route and removes route (reverting to Auto)', async () => {
    const handleRemove = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{ resume_generation: 'cred_gemini_2' }}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={handleRemove}
      />
    )

    // Active route badge
    expect(screen.getByText(/1 preferred route/i)).toBeDefined()

    // Inspect route button
    const inspectBtn = screen.getByRole('button', { name: /Inspect/i })
    fireEvent.click(inspectBtn)

    // Modal / popover appears showing route details
    expect(screen.getByText('Preferred Route: Resume Tailoring')).toBeDefined()
    expect(screen.getByText('Specific Credential Preference')).toBeDefined()
    expect(screen.getAllByText('Resume Gemini').length).toBeGreaterThanOrEqual(1)

    // Click Remove Route button
    const removeBtn = screen.getByRole('button', { name: /Remove Route/i })
    fireEvent.click(removeBtn)

    expect(handleRemove).toHaveBeenCalledWith('resume_generation')
  })

  it('renders zero credentials state for a provider with an Add Credential button', () => {
    const onAddClick = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials} // No Groq credentials configured
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
        onAddCredentialClick={onAddClick}
      />
    )

    expect(screen.getByText('No Groq credentials configured')).toBeDefined()
    const addGroqBtn = screen.getByRole('button', { name: /\+ Add Groq Credential/i })
    fireEvent.click(addGroqBtn)
    expect(onAddClick).toHaveBeenCalledWith('groq')
  })

  it('shows active cooldown badge when a credential ID is in activeCooldowns', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{ resume_generation: 'cred_gemini_1' }}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
        activeCooldowns={['cred_gemini_1']}
      />
    )

    expect(screen.getByText('Cooldown')).toBeDefined()
  })

  it('opens Task Details modal when task node is clicked and allows Reset to Auto', async () => {
    const handleRemove = vi.fn()
    render(
      <TaskRoutingMapEditor
        taskRouting={{ resume_generation: 'cred_gemini_2' }}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={handleRemove}
      />
    )

    // Click task node body
    const taskNode = screen.getByTestId('task-node-resume_generation')
    fireEvent.click(taskNode)

    // Task Details modal appears
    expect(screen.getByText('Task Purpose')).toBeDefined()
    expect(
      screen.getAllByText(/Generates tailored resume content grounded in verified profile facts/i).length
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Routing Behavior Guarantee/i)).toBeDefined()
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName.toLowerCase() === 'p' &&
          (el?.textContent?.includes('preference, not an exclusive hard lock') ?? false)
      )
    ).toBeDefined()

    // Click Reset to Auto
    const resetBtn = screen.getByRole('button', { name: /Reset to Auto/i })
    fireEvent.click(resetBtn)

    expect(handleRemove).toHaveBeenCalledWith('resume_generation')
  })

  it('generates friendly default names when credential friendlyName is missing or empty', () => {
    const unnamedCreds: CredentialItem[] = [
      {
        id: 'cred_gemini_unnamed',
        credentialId: 'cred_gemini_unnamed',
        provider: 'gemini',
        friendlyName: '',
        maskedApiKey: 'AIza...0001',
        costTier: 'FREE_TIER',
      },
    ]

    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={unnamedCreds}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    expect(screen.getByText('Gemini API Key 1')).toBeDefined()
  })

  it('supports collapsing and expanding provider credentials', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    // Initially expanded
    expect(screen.getByText('Gemini API Key 1')).toBeDefined()

    // Toggle collapse Gemini
    const toggleBtn = screen.getByTestId('toggle-credentials-gemini')
    fireEvent.click(toggleBtn)

    // Now hidden with count indicator
    expect(screen.queryByText('Gemini API Key 1')).toBeNull()
    expect(screen.getByText(/2 credentials hidden/i)).toBeDefined()

    // Toggle expand Gemini
    fireEvent.click(toggleBtn)

    // Visible again
    expect(screen.getByText('Gemini API Key 1')).toBeDefined()
  })

  it('keeps credential route edge visible and re-anchors to provider handle when collapsed, and returns to credential on expand', async () => {
    const handleSave = vi.fn()
    const handleRemove = vi.fn()

    render(
      <TaskRoutingMapEditor
        taskRouting={{ resume_generation: 'cred_gemini_1' }}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={handleSave}
        onRemoveRoute={handleRemove}
      />
    )

    // 1. With provider expanded: edge targets credential handle
    const edge = screen.getByTestId('route-edge-resume_generation')
    expect(edge).toBeDefined()
    expect(edge.getAttribute('data-target-handle')).toBe('cred-cred_gemini_1')
    expect(edge.getAttribute('data-is-collapsed')).toBe('false')

    // 2. Collapse Google Gemini
    const toggleBtn = screen.getByTestId('toggle-credentials-gemini')
    fireEvent.click(toggleBtn)

    // 3. Edge remains visible, now terminating at provider handle
    const collapsedEdge = screen.getByTestId('route-edge-resume_generation')
    expect(collapsedEdge).toBeDefined()
    expect(collapsedEdge.getAttribute('data-target-handle')).toBe('provider-gemini')
    expect(collapsedEdge.getAttribute('data-is-collapsed')).toBe('true')

    // 4. Click the edge to open Preferred Route Modal: verify underlying route identity is preserved
    fireEvent.click(collapsedEdge)
    expect(screen.getByText(/Preferred Route: Resume Tailoring/i)).toBeDefined()
    expect(screen.getAllByText('Gemini API Key 1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Specific Credential Preference')).toBeDefined()

    // Close modal
    const closeBtn = screen.getAllByRole('button', { name: /Close/i })[0]
    fireEvent.click(closeBtn)

    // 5. Expand Google Gemini again
    fireEvent.click(toggleBtn)

    // 6. Edge returns to credential node handle
    const expandedAgainEdge = screen.getByTestId('route-edge-resume_generation')
    expect(expandedAgainEdge.getAttribute('data-target-handle')).toBe('cred-cred_gemini_1')
    expect(expandedAgainEdge.getAttribute('data-is-collapsed')).toBe('false')

    // 7. Verify collapse/expand never called onSaveRoute or mutated persisted state
    expect(handleSave).not.toHaveBeenCalled()
    expect(handleRemove).not.toHaveBeenCalled()
  })

  it('renders multiple credential routes terminating at provider handle when collapsed, without merging routes', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{
          resume_generation: 'cred_gemini_1',
          cover_letter_generation: 'cred_gemini_2',
        }}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    // Both edges exist initially
    const edge1 = screen.getByTestId('route-edge-resume_generation')
    const edge2 = screen.getByTestId('route-edge-cover_letter_generation')
    expect(edge1.getAttribute('data-target-handle')).toBe('cred-cred_gemini_1')
    expect(edge2.getAttribute('data-target-handle')).toBe('cred-cred_gemini_2')

    // Collapse Gemini
    const toggleBtn = screen.getByTestId('toggle-credentials-gemini')
    fireEvent.click(toggleBtn)

    // Both edges remain visible and both visually anchor to provider-gemini
    expect(screen.getByTestId('route-edge-resume_generation').getAttribute('data-target-handle')).toBe(
      'provider-gemini'
    )
    expect(screen.getByTestId('route-edge-cover_letter_generation').getAttribute('data-target-handle')).toBe(
      'provider-gemini'
    )

    // Expanding returns each to its respective credential
    fireEvent.click(toggleBtn)
    expect(screen.getByTestId('route-edge-resume_generation').getAttribute('data-target-handle')).toBe(
      'cred-cred_gemini_1'
    )
    expect(screen.getByTestId('route-edge-cover_letter_generation').getAttribute('data-target-handle')).toBe(
      'cred-cred_gemini_2'
    )
  })

  it('renders concise task descriptions and capability badges inside each task node card', () => {
    render(
      <TaskRoutingMapEditor
        taskRouting={{}}
        credentials={mockCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    // Check capability badges
    expect(screen.getByText('Truth-Lock')).toBeDefined()
    expect(screen.getByText('Pydantic Schema')).toBeDefined()
    expect(screen.getByText('Fast Inference')).toBeDefined()
    expect(screen.getByText('Deterministic')).toBeDefined()
    expect(screen.getByText('Long Context')).toBeDefined()
    expect(screen.getByText('Fast Extraction')).toBeDefined()

    // Check task card descriptions
    expect(screen.getByText('Generates tailored resume content grounded in verified profile facts.')).toBeDefined()
    expect(screen.getByText('Generates personalized cover-letter content from job requirements.')).toBeDefined()
    expect(screen.getByText('Rewrites resume content and improves alignment with target requirements.')).toBeDefined()
    expect(screen.getByText('Generates grounded answers for application questions.')).toBeDefined()
    expect(screen.getByText('Extracts structured experience, skills, and project information.')).toBeDefined()
    expect(screen.getByText('Extracts standardized job information from captured job sources.')).toBeDefined()
  })

  it('renders realistic multi-credential datasets across all providers without clipping or errors', () => {
    // Case B & C: multiple credentials per provider
    const largeCredentials: CredentialItem[] = [
      // 3 Gemini credentials
      { id: 'g1', credentialId: 'g1', provider: 'gemini', friendlyName: 'Resume Key', maskedApiKey: 'AIza...1111' },
      { id: 'g2', credentialId: 'g2', provider: 'gemini', friendlyName: 'ATS Gemini', maskedApiKey: 'AIza...2222' },
      { id: 'g3', credentialId: 'g3', provider: 'gemini', friendlyName: 'General Gemini', maskedApiKey: 'AIza...3333' },
      // 2 OpenRouter credentials
      { id: 'o1', credentialId: 'o1', provider: 'openrouter', friendlyName: 'OpenRouter Primary', maskedApiKey: 'sk-or...4444' },
      { id: 'o2', credentialId: 'o2', provider: 'openrouter', friendlyName: 'OpenRouter Backup', maskedApiKey: 'sk-or...5555' },
      // 1 Groq credential
      { id: 'gr1', credentialId: 'gr1', provider: 'groq', friendlyName: 'Groq LPU Fast', maskedApiKey: 'gsk_...6666' },
    ]

    render(
      <TaskRoutingMapEditor
        taskRouting={{
          resume_generation: 'g1',
          cover_letter_generation: 'o1',
          ats_bulk_rewrite: 'gr1',
          qa_copilot: 'g3',
        }}
        credentials={largeCredentials}
        costPolicy="FREE_ONLY"
        onSaveRoute={vi.fn()}
        onRemoveRoute={vi.fn()}
      />
    )

    // Verify all credential names are present in the DOM
    expect(screen.getAllByText('Resume Key').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('ATS Gemini').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('General Gemini').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('OpenRouter Primary').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('OpenRouter Backup').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Groq LPU Fast').length).toBeGreaterThanOrEqual(1)

    // Verify 4 active routes count
    expect(screen.getByText(/4 preferred routes/i)).toBeDefined()
  })
})


