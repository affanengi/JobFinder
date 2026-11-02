import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompanyProfilePage } from "./CompanyProfilePage";
import { CompanyDetail } from "../types/company";
import { fetchWithAuth } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

const mockDetail: CompanyDetail = {
  key: "stripe",
  name: "Stripe",
  domain: "stripe.com",
  careersUrl: "https://stripe.com/jobs",
  primaryOpportunityId: "opp-stripe-1",
  opportunities: [
    {
      id: "opp-stripe-1",
      title: "Staff Software Engineer",
      location: "San Francisco, CA",
      workMode: "remote",
      category: "technical",
      sourceUrl: "https://stripe.com/jobs/1",
      status: "recommended",
    },
  ],
  intelligence: {
    id: "intel-stripe",
    userId: "user-1",
    opportunityId: "opp-stripe-1",
    companyName: "Stripe",
    officialDomain: "stripe.com",
    careersUrl: "https://stripe.com/jobs",
    riskTier: "NO_OBVIOUS_RED_FLAGS_FOUND",
    summary: "Leading economic infrastructure company for the internet.",
    evaluatedDimensions: {
      domainConsistency: { status: "PASS", evidence: "Domain matches corporate identity", confidence: 1.0 },
      paymentSolicitations: { status: "PASS", evidence: "No fees requested", confidence: 1.0 },
      communicationChannels: { status: "PASS", evidence: "Corporate email observed", confidence: 1.0 },
      publicScamReports: { status: "PASS", evidence: "Clean public record", confidence: 1.0 },
      requisitionConsistency: { status: "PASS", evidence: "Standard engineering requisition", confidence: 1.0 },
    },
    redFlags: [],
    positiveSignals: ["Verified domain", "Established tech firm"],
    sourceUrls: ["https://stripe.com/jobs"],
    researchedAt: "2026-10-26T12:00:00Z",
    ttlExpiresAt: "2026-11-09T12:00:00Z",
    disclaimer: "Absence of detected red flags does not guarantee authenticity.",
  },
  contacts: [
    {
      id: "contact-1",
      userId: "user-1",
      opportunityId: "opp-stripe-1",
      fullName: "Patrick Collison",
      roleTitle: "CEO",
      companyName: "Stripe",
      email: "patrick@stripe.com",
      emailClassification: "PUBLICLY_LISTED",
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
    },
  ],
};

describe("CompanyProfilePage (Section B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders company header, overview, and Scam Shield dimensions", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockDetail));

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={vi.fn()}
        onSelectContact={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Stripe", level: 1 })).toBeInTheDocument();
      expect(screen.getAllByText("stripe.com")[0]).toBeInTheDocument();
    });

    // Company Overview from Phase 1 intelligence
    expect(
      screen.getByText("Leading economic infrastructure company for the internet.")
    ).toBeInTheDocument();

    // Scam Shield Legitimacy assessment & 5 dimensions
    expect(screen.getByText("Scam Shield Legitimacy Assessment")).toBeInTheDocument();
    expect(screen.getByText(/Low Risk • No Obvious Red Flags/i)).toBeInTheDocument();
    expect(screen.getByText("Domain Consistency")).toBeInTheDocument();
    expect(screen.getByText("Payment Solicitations")).toBeInTheDocument();
    expect(screen.getByText("Communication Channel")).toBeInTheDocument();
    expect(screen.getByText("Public Scam Reports")).toBeInTheDocument();
    expect(screen.getByText("Requisition Consistency")).toBeInTheDocument();

    // Mandatory Disclaimer
    expect(
      screen.getByText(/Absence of detected red flags does not guarantee a company's authenticity/i)
    ).toBeInTheDocument();
  });

  it("renders contacts list and calls onSelectContact when a contact card is clicked", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockDetail));
    const handleSelectContact = vi.fn();

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={vi.fn()}
        onSelectContact={handleSelectContact}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Patrick Collison")).toBeInTheDocument();
      expect(screen.getByText("CEO")).toBeInTheDocument();
    });

    // Evidence badge
    expect(screen.getByText("Publicly Listed")).toBeInTheDocument();

    // Click contact card to open composer
    fireEvent.click(screen.getByText("Patrick Collison"));
    expect(handleSelectContact).toHaveBeenCalledWith("contact-1", "opp-stripe-1");
  });

  it("calls onBackToDirectory when back button or breadcrumb is clicked", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockDetail));
    const handleBack = vi.fn();

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={handleBack}
        onSelectContact={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Back to Directory")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Back to Directory"));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("handles contact discovery with 0 contacts by showing info banner and search links", async () => {
    const detailWithoutContacts = { ...mockDetail, contacts: [] };
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(mockResponse(detailWithoutContacts)) // initial load
      .mockResolvedValueOnce(
        mockResponse({
          contacts: [],
          searchLinks: [
            {
              title: "Recruiters & Talent Acquisition (Stripe • Hyderabad)",
              query: 'site:linkedin.com/in "Stripe" (recruiter) Hyderabad',
              url: "https://www.google.com/search?q=stripe+recruiters",
              platform: "google",
            },
          ],
          message: "No public contacts discovered for Stripe with sufficient evidence. Use the pre-formatted browser search links below.",
        })
      ); // discover call

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={vi.fn()}
        onSelectContact={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No Stakeholders Discovered Yet")).toBeInTheDocument();
    });

    const discoverBtn = screen.getAllByRole("button", { name: /discover contacts/i })[0];
    fireEvent.click(discoverBtn);

    await waitFor(() => {
      // Info feedback banner should appear (not green success text)
      expect(
        screen.getByText(/No public contacts discovered for Stripe with sufficient evidence/i)
      ).toBeInTheDocument();
      // Search shortcut link should be rendered
      expect(
        screen.getByText("Recruiters & Talent Acquisition (Stripe • Hyderabad)")
      ).toBeInTheDocument();
    });
  });

  it("handles contact discovery failure gracefully with error banner", async () => {
    const detailWithoutContacts = { ...mockDetail, contacts: [] };
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(mockResponse(detailWithoutContacts))
      .mockResolvedValueOnce(mockResponse({ detail: "Rate limit exceeded" }, false, 429));

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={vi.fn()}
        onSelectContact={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No Stakeholders Discovered Yet")).toBeInTheDocument();
    });

    const discoverBtn = screen.getAllByRole("button", { name: /discover contacts/i })[0];
    fireEvent.click(discoverBtn);

    await waitFor(() => {
      expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
    });
  });

  it("renders multi-channel contact cards with honest badges, profile links, and no blank email fields", async () => {
    const multiChannelDetail: CompanyDetail = {
      ...mockDetail,
      contacts: [
        {
          id: "contact-profile-only",
          userId: "user-1",
          opportunityId: "opp-stripe-1",
          fullName: "Val Z.",
          roleTitle: "Engineering Manager",
          companyName: "Stripe",
          email: null,
          emailClassification: "UNVERIFIED",
          stakeholderTier: "HIRING_MANAGER",
          contactType: "INDIVIDUAL",
          contactabilityStatus: "PROFILE_ONLY",
          roleEvidenceStatus: "CURRENT_CONFIRMED",
          linkedinUrl: "https://linkedin.com/in/valz",
          githubUrl: "https://github.com/valz",
          portfolioUrl: "https://valz.dev",
          isHyderabad: false,
          mxStatus: "UNCHECKED",
          sourceUrls: [],
          evidenceSnippets: [],
          searchProviderUsed: "agent_reach",
          confidenceScore: 0.8,
          rankingScore: 320,
          rankingReason: "Confirmed current",
          isDismissed: false,
          isReviewed: false,
          discoveredAt: "2026-10-28T12:00:00Z",
        },
        {
          id: "contact-org-channel",
          userId: "user-1",
          opportunityId: "opp-stripe-1",
          fullName: "Accommodations & Accessibility Inbox",
          roleTitle: "Candidate Accommodations Channel",
          companyName: "Stripe",
          email: "accommodations@stripe.com",
          emailClassification: "PUBLICLY_LISTED",
          stakeholderTier: "OTHER",
          contactType: "ORGANIZATION_CHANNEL",
          channelPurpose: "ACCOMMODATIONS_ONLY",
          contactabilityStatus: "GENERIC_INBOX_FOUND",
          roleEvidenceStatus: "CURRENT_CONFIRMED",
          isHyderabad: false,
          mxStatus: "VALID_MX",
          sourceUrls: [],
          evidenceSnippets: [],
          searchProviderUsed: "company_page",
          confidenceScore: 0.9,
          rankingScore: 50,
          rankingReason: "Accommodations mailbox",
          isDismissed: false,
          isReviewed: false,
          discoveredAt: "2026-10-28T12:00:00Z",
        },
      ],
    };

    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(multiChannelDetail));

    render(
      <CompanyProfilePage
        companyKey="stripe"
        onBackToDirectory={vi.fn()}
        onSelectContact={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Val Z.")).toBeInTheDocument();
      expect(screen.getByText("Accommodations & Accessibility Inbox")).toBeInTheDocument();
    });

    // 1. Profile-only contact shows Profile-Discovered Candidate and Profile Only badge
    expect(screen.getByText("Profile-Discovered Candidate")).toBeInTheDocument();
    expect(screen.getByText("Profile Only")).toBeInTheDocument();

    // 2. Multi-channel profile links exist
    const linkedinLink = screen.getByRole("link", { name: /LinkedIn/i });
    expect(linkedinLink).toHaveAttribute("href", "https://linkedin.com/in/valz");
    expect(linkedinLink).toHaveAttribute("target", "_blank");

    const githubLink = screen.getByRole("link", { name: /GitHub/i });
    expect(githubLink).toHaveAttribute("href", "https://github.com/valz");

    const portfolioLink = screen.getByRole("link", { name: /Portfolio/i });
    expect(portfolioLink).toHaveAttribute("href", "https://valz.dev");

    // 3. Organizational channel has Org Channel badge
    expect(screen.getByText("Org Channel")).toBeInTheDocument();
    expect(screen.getByText("accommodations@stripe.com")).toBeInTheDocument();
  });

  describe("Fix 2: Real Company Overview Content", () => {
    it("renders rich overview, products & services, industry, size, and headquarters when available", async () => {
      const richDetail: CompanyDetail = {
        ...mockDetail,
        intelligence: {
          ...mockDetail.intelligence!,
          overview: "Cloudflare provides global cloud networking, cybersecurity, and DDoS mitigation platforms for internet applications.",
          summary: "Verified legitimate global enterprise infrastructure provider.",
          industry: "Cloud Infrastructure & Cybersecurity",
          productsAndServices: ["Cloudflare Workers", "Zero Trust", "Magic Transit", "Cloudflare Pages"],
          headquarters: "San Francisco, CA, USA",
          companySize: "3,000+ employees",
        },
      };

      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(richDetail));

      render(
        <CompanyProfilePage
          companyKey="cloudflare"
          onBackToDirectory={vi.fn()}
          onSelectContact={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText("Cloudflare provides global cloud networking, cybersecurity, and DDoS mitigation platforms for internet applications.")
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Industry: Cloud Infrastructure & Cybersecurity")).toBeInTheDocument();
      expect(screen.getByText("Cloudflare Workers")).toBeInTheDocument();
      expect(screen.getByText("Zero Trust")).toBeInTheDocument();
      expect(screen.getByText("Magic Transit")).toBeInTheDocument();
      expect(screen.getByText("Cloudflare Pages")).toBeInTheDocument();
      expect(screen.getByText("San Francisco, CA, USA")).toBeInTheDocument();
      expect(screen.getByText("3,000+ employees")).toBeInTheDocument();
    });

    it("displays clean unavailable state with retry action when evidence could not be retrieved", async () => {
      const unavailableDetail: CompanyDetail = {
        ...mockDetail,
        intelligence: {
          ...mockDetail.intelligence!,
          riskTier: "INSUFFICIENT_EVIDENCE",
          overview: null,
          summary: "Public web content for Canonical could not be retrieved.",
          evaluatedDimensions: {
            domainConsistency: { status: "INSUFFICIENT_EVIDENCE", evidence: "No text", confidence: 0.0 },
            paymentSolicitations: { status: "INSUFFICIENT_EVIDENCE", evidence: "No text", confidence: 0.0 },
            communicationChannels: { status: "INSUFFICIENT_EVIDENCE", evidence: "No text", confidence: 0.0 },
            publicScamReports: { status: "INSUFFICIENT_EVIDENCE", evidence: "No text", confidence: 0.0 },
            requisitionConsistency: { status: "INSUFFICIENT_EVIDENCE", evidence: "No text", confidence: 0.0 },
          },
          redFlags: [],
        },
      };

      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(unavailableDetail));

      render(
        <CompanyProfilePage
          companyKey="canonical"
          onBackToDirectory={vi.fn()}
          onSelectContact={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Company information could not be retrieved")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Retry Company Research/i })).toBeInTheDocument();
      });
    });
  });

  describe("Fix 3: Scam Shield Evidence Distinction", () => {
    it("renders INSUFFICIENT_EVIDENCE risk tier without flagged risks box when redFlags is empty", async () => {
      const insufficientDetail: CompanyDetail = {
        ...mockDetail,
        intelligence: {
          ...mockDetail.intelligence!,
          riskTier: "INSUFFICIENT_EVIDENCE",
          overview: null,
          summary: "Evidence unavailable.",
          redFlags: [],
        },
      };

      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(insufficientDetail));

      render(
        <CompanyProfilePage
          companyKey="canonical"
          onBackToDirectory={vi.fn()}
          onSelectContact={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Research Incomplete • Insufficient Evidence/i)).toBeInTheDocument();
      });

      // Crucial: FLAGGED RISKS box must NOT be rendered!
      expect(screen.queryByText(/Flagged Risks/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Automated evidence extraction was inconclusive/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry Audit/i })).toBeInTheDocument();
    });

    it("displays genuine FLAGGED RISKS when credible risk evidence is present", async () => {
      const riskDetail: CompanyDetail = {
        ...mockDetail,
        intelligence: {
          ...mockDetail.intelligence!,
          riskTier: "SIGNIFICANT_RED_FLAGS",
          redFlags: [
            "Upfront equipment fee of $250 demanded via wire transfer",
            "Recruiter conducts interview exclusively on Telegram channel @fake_recruiter",
          ],
        },
      };

      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(riskDetail));

      render(
        <CompanyProfilePage
          companyKey="fakecorp"
          onBackToDirectory={vi.fn()}
          onSelectContact={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/High Risk • Red Flags Detected/i)).toBeInTheDocument();
        expect(screen.getByText("Flagged Risks")).toBeInTheDocument();
        expect(screen.getByText(/Upfront equipment fee of \$250 demanded/i)).toBeInTheDocument();
        expect(screen.getByText(/Recruiter conducts interview exclusively on Telegram/i)).toBeInTheDocument();
      });
    });
  });

  describe("Fix 4: Contact Card Badge Formatting", () => {
    it("ensures role status badges have whitespace-nowrap and do not break with long names or titles", async () => {
      const longTitleDetail: CompanyDetail = {
        ...mockDetail,
        contacts: [
          {
            ...mockDetail.contacts[0],
            id: "contact-long-title",
            fullName: "Ferran San Millan Rodriguez de la Fuente",
            roleTitle: "Senior Talent Acquisition Partner | Engineering, Architecture & Distributed Systems Design",
            roleEvidenceStatus: "CURRENT_CONFIRMED",
          },
        ],
      };

      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(longTitleDetail));

      render(
        <CompanyProfilePage
          companyKey="elastic"
          onBackToDirectory={vi.fn()}
          onSelectContact={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Ferran San Millan Rodriguez de la Fuente")).toBeInTheDocument();
      });

      const badge = screen.getByText("Confirmed Current");
      expect(badge).toBeInTheDocument();
      // Verify badge styling prevents wrapping and shrinking
      expect(badge.className).toContain("whitespace-nowrap");
      expect(badge.className).toContain("shrink-0");
    });
  });
});

