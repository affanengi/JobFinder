import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutreachComposerModal } from './OutreachComposerModal';
import * as api from '../../lib/api';
import { DiscoveredContact } from '../../types/opportunityContact';
import { OutreachMessage } from '../../types/outreach';

vi.mock('../../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

const mockContact: DiscoveredContact = {
  id: 'contact-test-1',
  userId: 'user-1',
  opportunityId: 'opp-1',
  companyName: 'Stripe',
  fullName: 'Sarah Recruiter',
  roleTitle: 'Technical Recruiter',
  stakeholderTier: 'RECRUITER',
  email: 'sarah@stripe.com',
  emailClassification: 'PROVIDER_VERIFIED',
  mxStatus: 'VALID_MX',
  sourceUrls: [],
  evidenceSnippets: [],
  searchProviderUsed: 'mock',
  confidenceScore: 0.9,
  rankingScore: 400,
  rankingReason: 'Recruiter Tier',
  isDismissed: false,
  isReviewed: false,
  isHyderabad: false,
  discoveredAt: '2026-10-26T12:00:00Z',
};

describe('OutreachComposerModal (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders contact details and email evidence classification', async () => {
    vi.mocked(api.fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes('/outreach')) {
        return { ok: true, json: async () => null } as any;
      }
      if (url.includes('/resumes')) {
        return { ok: true, json: async () => [] } as any;
      }
      if (url.includes('/status')) {
        return { ok: true, json: async () => ({ isConnected: false }) } as any;
      }
      return { ok: false } as any;
    });

    render(
      <OutreachComposerModal
        isOpen={true}
        onClose={vi.fn()}
        contact={mockContact}
        opportunityId="opp-1"
        companyName="Stripe"
      />
    );

    expect(screen.getByText('Outreach Composer')).toBeInTheDocument();
    expect(screen.getByText('Sarah Recruiter')).toBeInTheDocument();
    expect(screen.getByText('sarah@stripe.com')).toBeInTheDocument();
    expect(screen.getByText('Evidence: PROVIDER_VERIFIED')).toBeInTheDocument();
  });

  it('strict 2-step AI confirmation: clicking Cancel preserves text and DOES NOT call AI', async () => {
    vi.mocked(api.fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes('/outreach')) return { ok: true, json: async () => null } as any;
      if (url.includes('/resumes')) return { ok: true, json: async () => [] } as any;
      if (url.includes('/status')) return { ok: true, json: async () => ({ isConnected: false }) } as any;
      return { ok: false } as any;
    });

    render(
      <OutreachComposerModal
        isOpen={true}
        onClose={vi.fn()}
        contact={mockContact}
        opportunityId="opp-1"
        companyName="Stripe"
      />
    );

    // Wait for initial load to finish
    const writeAiBtn = screen.getByTestId('write-with-ai-btn');
    await waitFor(() => expect(writeAiBtn).not.toBeDisabled());

    // Enter user-typed draft text
    const bodyInput = screen.getByTestId('outreach-body-textarea') as HTMLTextAreaElement;
    fireEvent.change(bodyInput, { target: { value: 'My custom outreach message before clicking AI.' } });
    expect(bodyInput.value).toBe('My custom outreach message before clicking AI.');

    // 1. Click "Write with AI"
    fireEvent.click(writeAiBtn);

    // Confirmation panel appears
    await waitFor(() => {
      expect(screen.getByTestId('ai-confirmation-panel')).toBeInTheDocument();
    });
    expect(screen.getByText('Generate with Truth-Locked AI?')).toBeInTheDocument();

    // 2. Click "Cancel"
    const cancelBtn = screen.getByTestId('cancel-ai-btn');
    fireEvent.click(cancelBtn);

    // Confirmation panel closes
    expect(screen.queryByTestId('ai-confirmation-panel')).not.toBeInTheDocument();

    // Text remains preserved!
    expect(bodyInput.value).toBe('My custom outreach message before clicking AI.');

    // Zero AI generate API calls made
    expect(vi.mocked(api.fetchWithAuth)).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate'),
      expect.anything()
    );
  });

  it('clicking Yes in AI confirmation initiates AI generation and displays Truth-Lock audit report', async () => {
    const mockGenerated: OutreachMessage = {
      id: 'outreach-1',
      userId: 'user-1',
      opportunityId: 'opp-1',
      contactId: 'contact-test-1',
      recipientEmail: 'sarah@stripe.com',
      recipientName: 'Sarah Recruiter',
      companyName: 'Stripe',
      emailClassification: 'PROVIDER_VERIFIED',
      subject: 'Inquiring regarding Stripe Backend Engineering',
      body: 'Hi Sarah, I am excited about Stripe infrastructure given my Python and distributed systems background.',
      status: 'DRAFT',
      truthLockReport: {
        status: 'PASS',
        totalChecks: 4,
        passedChecks: 4,
        findings: [
          {
            status: 'PASS',
            field: 'body',
            claim: '17 words',
            reason: 'Satisfies brevity guideline (< 140 words)',
            isBlocking: false,
          },
        ],
        verifiedFactReferences: ['skill:Python', 'company:Stripe'],
      },
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(api.fetchWithAuth).mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/generate') && opts?.method === 'POST') {
        return { ok: true, json: async () => mockGenerated } as any;
      }
      if (url.includes('/outreach')) return { ok: true, json: async () => null } as any;
      if (url.includes('/resumes')) return { ok: true, json: async () => [] } as any;
      if (url.includes('/status')) return { ok: true, json: async () => ({ isConnected: false }) } as any;
      return { ok: false } as any;
    });

    render(
      <OutreachComposerModal
        isOpen={true}
        onClose={vi.fn()}
        contact={mockContact}
        opportunityId="opp-1"
        companyName="Stripe"
      />
    );

    // Wait for initial load to finish
    const writeAiBtn = screen.getByTestId('write-with-ai-btn');
    await waitFor(() => expect(writeAiBtn).not.toBeDisabled());

    // Open confirmation
    fireEvent.click(writeAiBtn);

    // Confirm AI generation
    await waitFor(() => expect(screen.getByTestId('confirm-ai-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-ai-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('truth-lock-report')).toBeInTheDocument();
    });

    expect(screen.getByText(/Truth-Lock Audit Status: PASS/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Inquiring regarding Stripe Backend Engineering/i)).toBeInTheDocument();
  });
});
