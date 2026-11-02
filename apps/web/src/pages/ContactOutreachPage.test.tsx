import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactOutreachPage } from "./ContactOutreachPage";
import { DiscoveredContact } from "../types/opportunityContact";
import { OutreachMessage } from "../types/outreach";
import { fetchWithAuth } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

// Mock ThreadTimeline component to keep tests focused on ContactOutreachPage
vi.mock("../components/outreach/ThreadTimeline", () => ({
  ThreadTimeline: () => <div data-testid="mock-thread-timeline">Thread Timeline Mock</div>,
}));

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

const mockContact: DiscoveredContact = {
  id: "contact-123",
  userId: "user-1",
  opportunityId: "opp-123",
  companyName: "Stripe",
  fullName: "Patrick Collison",
  roleTitle: "CEO",
  email: "patrick@stripe.com",
  emailClassification: "PROVIDER_VERIFIED",
  stakeholderTier: "OTHER",
  isHyderabad: false,
  mxStatus: "VALID_MX",
  sourceUrls: ["https://linkedin.com/in/patrickcollison"],
  evidenceSnippets: [],
  searchProviderUsed: "brave",
  confidenceScore: 0.95,
  rankingScore: 0.95,
  rankingReason: "CEO",
  isDismissed: false,
  isReviewed: true,
  discoveredAt: "2026-10-26T12:00:00Z",
};

const mockDraftOutreach: OutreachMessage = {
  id: "outreach-123",
  userId: "user-1",
  opportunityId: "opp-123",
  contactId: "contact-123",
  recipientEmail: "patrick@stripe.com",
  recipientName: "Patrick Collison",
  recipientTitle: "CEO",
  companyName: "Stripe",
  emailClassification: "PROVIDER_VERIFIED",
  subject: "Connecting regarding Systems Engineering",
  body: "Hi Patrick, I would love to connect about infrastructure roles at Stripe.",
  status: "DRAFT",
  truthLockReport: {
    status: "PASS",
    totalChecks: 1,
    passedChecks: 1,
    findings: [],
    verifiedFactReferences: ["ref-1"],
  },
  correlationId: "corr-mock-1",
  createdAt: "2026-10-26T12:00:00Z",
  updatedAt: "2026-10-26T12:00:00Z",
};

describe("ContactOutreachPage (Sections C & D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Card 1 (Contact Details) and Card 2 (Email Composer)", async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("/contacts") && !url.includes("outreach") && !url.includes("generate-outreach")) {
        return mockResponse([mockContact]);
      }
      if (url.includes("/outreach")) {
        return mockResponse(mockDraftOutreach);
      }
      if (url.includes("/resumes")) {
        return mockResponse([]);
      }
      if (url.includes("/gmail/oauth/status")) {
        return mockResponse({ connected: true, email: "user@gmail.com" });
      }
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-123"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    // Wait for contact and outreach details to load
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Patrick Collison", level: 1 })).toBeInTheDocument();
      expect(screen.getByText(/CEO/i)).toBeInTheDocument();
    });

    // Card 1: Evidence status and contact channels
    expect(screen.getByText("Provider Verified")).toBeInTheDocument();
    expect(screen.getByText("patrick@stripe.com")).toBeInTheDocument();

    // Card 2: Composer fields
    expect(screen.getByDisplayValue("Connecting regarding Systems Engineering")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Hi Patrick, I would love to connect about infrastructure roles at Stripe.")
    ).toBeInTheDocument();

    // Key action buttons
    expect(screen.getByRole("button", { name: /Write with AI/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send via Gmail/i })).toBeInTheDocument();
  });

  it("Section D: Strict AI confirmation flow preserves candidate text on cancel", async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("/contacts") && !url.includes("outreach") && !url.includes("generate-outreach")) return mockResponse([mockContact]);
      if (url.includes("/outreach")) return mockResponse(null, false, 404);
      if (url.includes("/resumes")) return mockResponse([]);
      if (url.includes("/gmail/oauth/status")) return mockResponse({ connected: true });
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-123"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Patrick Collison", level: 1 })).toBeInTheDocument();
    });

    // 1. User writes custom content
    const bodyArea = screen.getByPlaceholderText(/Write your personalized outreach note/i);
    fireEvent.change(bodyArea, { target: { value: "My handwritten message to Patrick." } });
    expect(bodyArea).toHaveValue("My handwritten message to Patrick.");

    // 2. Click Write with AI -> Modal opens
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/i }));
    expect(screen.getByText("Generate tailored outreach draft with AI?")).toBeInTheDocument();

    // 3. User clicks Cancel
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // 4. Modal closes and handwritten text remains 100% intact
    expect(screen.queryByText("Generate tailored outreach draft with AI?")).not.toBeInTheDocument();
    expect(bodyArea).toHaveValue("My handwritten message to Patrick.");
  });

  it("Section D: Confirmed AI generation inserts draft into editable composer without sending", async () => {
    const aiGeneratedDraft = {
      subject: "AI Tailored Subject: Scalable Systems",
      body: "AI Tailored Body: Based on verified candidate profile.",
      truthLockReport: { status: "PASS", passedChecks: 3, totalChecks: 3 },
    };

    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("generate")) return mockResponse(aiGeneratedDraft);
      if (url.includes("/contacts") && !url.includes("outreach")) return mockResponse([mockContact]);
      if (url.includes("/outreach")) return mockResponse(null, false, 404);
      if (url.includes("/resumes")) return mockResponse([]);
      if (url.includes("/gmail/oauth/status")) return mockResponse({ connected: true });
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-123"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Patrick Collison", level: 1 })).toBeInTheDocument();
    });

    // Open confirmation modal
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/i }));

    // Confirm generation
    fireEvent.click(screen.getByRole("button", { name: "Yes, write with AI" }));

    // Verify AI content was inserted into composer
    await waitFor(() => {
      expect(
        screen.getByDisplayValue("AI Tailored Subject: Scalable Systems")
      ).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("AI Tailored Body: Based on verified candidate profile.")
      ).toBeInTheDocument();
    });

    // Content remains editable
    const subjectInput = screen.getByDisplayValue("AI Tailored Subject: Scalable Systems");
    fireEvent.change(subjectInput, { target: { value: "Edited Subject" } });
    expect(subjectInput).toHaveValue("Edited Subject");
  });

  it("disables send action when contact is suppressed", async () => {
    const suppressedContact: DiscoveredContact = {
      ...mockContact,
      suppressionState: "GLOBAL_STAKEHOLDER_SUPPRESSION",
      doNotContact: true,
    };

    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("/contacts") && !url.includes("outreach") && !url.includes("generate-outreach")) return mockResponse([suppressedContact]);
      if (url.includes("/outreach")) return mockResponse(mockDraftOutreach);
      if (url.includes("/resumes")) return mockResponse([]);
      if (url.includes("/gmail/oauth/status")) return mockResponse({ connected: true });
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-123"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Global Opt-Out Active/i)).toBeInTheDocument();
    });

    // Send button must be disabled due to suppression
    const sendButton = screen.getByRole("button", { name: /Send via Gmail/i });
    expect(sendButton).toBeDisabled();
  });

  it("Task 2.4: Safe Outreach guards disable Gmail send and offer Copy Draft / LinkedIn when contact is profile-only", async () => {
    const profileOnlyContact: DiscoveredContact = {
      ...mockContact,
      id: "contact-profile-only",
      fullName: "Jane Engineer",
      roleTitle: "Engineering Manager",
      email: null as unknown as string,
      contactabilityStatus: "PROFILE_ONLY",
      linkedinUrl: "https://www.linkedin.com/in/jane-engineer",
    };

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("/contacts") && !url.includes("outreach") && !url.includes("generate-outreach")) {
        return mockResponse([profileOnlyContact]);
      }
      if (url.includes("/outreach")) {
        return mockResponse({
          ...mockDraftOutreach,
          contactId: "contact-profile-only",
          recipientEmail: "",
        });
      }
      if (url.includes("/resumes")) return mockResponse([]);
      if (url.includes("/gmail/oauth/status")) return mockResponse({ connected: true });
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-profile-only"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Jane Engineer", level: 1 })).toBeInTheDocument();
    });

    // 1. Shows honest profile-only message
    expect(screen.getByText(/Profile-Only • No direct email address discovered/i)).toBeInTheDocument();

    // 2. LinkedIn link is displayed for manual outreach
    const linkedinBtn = screen.getByRole("link", { name: /Open LinkedIn Profile/i });
    expect(linkedinBtn).toBeInTheDocument();
    expect(linkedinBtn).toHaveAttribute("href", "https://www.linkedin.com/in/jane-engineer");

    // 3. Send via Gmail button MUST be strictly disabled
    const sendButton = screen.getByRole("button", { name: /Send via Gmail/i });
    expect(sendButton).toBeDisabled();

    // 4. Copy Draft button is available and copies subject + body to clipboard
    const copyButton = screen.getByRole("button", { name: /Copy Draft/i });
    expect(copyButton).toBeInTheDocument();
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText("Outreach draft copied to clipboard!")).toBeInTheDocument();
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Subject: Connecting regarding Systems Engineering")
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Hi Patrick, I would love to connect about infrastructure roles at Stripe.")
    );
  });

  it("Task 2.4: Displays Organization Channel badge with channelPurpose", async () => {
    const orgChannelContact: DiscoveredContact = {
      ...mockContact,
      id: "contact-org-accommodations",
      fullName: "Accommodations Team",
      roleTitle: "Shared Accommodations Inbox",
      email: "accommodations@stripe.com",
      contactType: "ORGANIZATION_CHANNEL",
      channelPurpose: "ACCOMMODATIONS_ONLY",
      contactabilityStatus: "GENERIC_INBOX_FOUND",
    };

    vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
      if (url.includes("/contacts") && !url.includes("outreach") && !url.includes("generate-outreach")) {
        return mockResponse([orgChannelContact]);
      }
      if (url.includes("/outreach")) {
        return mockResponse({
          ...mockDraftOutreach,
          contactId: "contact-org-accommodations",
          recipientEmail: "accommodations@stripe.com",
        });
      }
      if (url.includes("/resumes")) return mockResponse([]);
      if (url.includes("/gmail/oauth/status")) return mockResponse({ connected: true });
      return mockResponse({});
    });

    render(
      <ContactOutreachPage
        companyKey="stripe"
        contactId="contact-org-accommodations"
        opportunityId="opp-123"
        onBackToCompany={vi.fn()}
        onBackToDirectory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Accommodations Team", level: 1 })).toBeInTheDocument();
    });

    // Verify Organization Channel badge is rendered
    expect(screen.getByText(/Organization Channel \(ACCOMMODATIONS ONLY\)/i)).toBeInTheDocument();
  });
});

