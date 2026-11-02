import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompanyDirectoryPage } from "./CompanyDirectoryPage";
import { CompanySummary } from "../types/company";
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

const mockCompanies: CompanySummary[] = [
  {
    key: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    primaryOpportunityId: "opp-1",
    opportunities: [],
    opportunityCount: 3,
    hasIntelligence: true,
    intelligenceStatus: "NO_OBVIOUS_RED_FLAGS_FOUND",
    contactsCount: 2,
  },
  {
    key: "figma",
    name: "Figma",
    domain: "figma.com",
    primaryOpportunityId: "opp-2",
    opportunities: [],
    opportunityCount: 1,
    hasIntelligence: false,
    intelligenceStatus: "NOT_RESEARCHED",
    contactsCount: 0,
  },
];

describe("CompanyDirectoryPage (Section A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders directory heading, search input, and company grid", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));

    render(<CompanyDirectoryPage onSelectCompany={vi.fn()} />);

    // Heading and stats
    expect(screen.getByText("Companies & Contacts")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
      expect(screen.getByText("Figma")).toBeInTheDocument();
    });

    // Company domain and openings displayed
    expect(screen.getByText("stripe.com")).toBeInTheDocument();
    expect(screen.getByText("3 Openings")).toBeInTheDocument();
    expect(screen.getByText("1 Opening")).toBeInTheDocument();
    expect(screen.getByText("2 Contacts")).toBeInTheDocument();
  });

  it("filters companies when searching via the search bar", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));

    render(<CompanyDirectoryPage onSelectCompany={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search companies by name or domain/i);
    fireEvent.change(searchInput, { target: { value: "stripe" } });

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
      expect(screen.queryByText("Figma")).not.toBeInTheDocument();
    });
  });

  it("calls onSelectCompany when clicking a company card", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
    const handleSelectCompany = vi.fn();

    render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Stripe"));
    expect(handleSelectCompany).toHaveBeenCalledWith("stripe");
  });

  it("displays empty state when no companies are available", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse([]));

    render(<CompanyDirectoryPage onSelectCompany={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No Companies in Directory Yet")).toBeInTheDocument();
    });
  });

  it("handles multi-selection, isolates checkbox click from card click, and shows BulkActionBar", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
    const handleSelectCompany = vi.fn();

    render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    // Checkbox selection
    const stripeCheckbox = screen.getByLabelText("Select Stripe for bulk research");
    expect(stripeCheckbox).not.toBeChecked();

    fireEvent.click(stripeCheckbox);
    expect(stripeCheckbox).toBeChecked();
    // Card navigation must NOT have been called
    expect(handleSelectCompany).not.toHaveBeenCalled();

    // Floating action bar must appear with count 1
    expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 1 of 5 companies");
    expect(screen.getByRole("button", { name: /Research 1 selected companies/i })).toBeInTheDocument();

    // Select second company
    const figmaCheckbox = screen.getByLabelText("Select Figma for bulk research");
    fireEvent.click(figmaCheckbox);
    expect(figmaCheckbox).toBeChecked();
    expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 2 of 5 companies");

    // Clear selection
    const clearBtn = screen.getByRole("button", { name: /Clear company selection/i });
    fireEvent.click(clearBtn);
    expect(stripeCheckbox).not.toBeChecked();
    expect(figmaCheckbox).not.toBeChecked();
    expect(screen.queryByTestId("selected-count-label")).not.toBeInTheDocument();
  });

  it("enforces maximum 5 companies limit and displays warning banner", async () => {
    const sixCompanies: CompanySummary[] = [
      { key: "c1", name: "Company 1", domain: "c1.com", primaryOpportunityId: "1", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      { key: "c2", name: "Company 2", domain: "c2.com", primaryOpportunityId: "2", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      { key: "c3", name: "Company 3", domain: "c3.com", primaryOpportunityId: "3", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      { key: "c4", name: "Company 4", domain: "c4.com", primaryOpportunityId: "4", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      { key: "c5", name: "Company 5", domain: "c5.com", primaryOpportunityId: "5", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      { key: "c6", name: "Company 6", domain: "c6.com", primaryOpportunityId: "6", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
    ];
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(sixCompanies));

    render(<CompanyDirectoryPage onSelectCompany={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Company 1")).toBeInTheDocument();
    });

    // Select 5 companies
    for (let i = 1; i <= 5; i++) {
      fireEvent.click(screen.getByLabelText(`Select Company ${i} for bulk research`));
    }

    expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 5 of 5 companies");
    expect(screen.getByText(/Maximum 5 companies per batch/i)).toBeInTheDocument();

    // 6th company checkbox should be disabled
    const c6Checkbox = screen.getByLabelText("Select Company 6 for bulk research");
    expect(c6Checkbox).toBeDisabled();

    // Attempting to select 6th
    fireEvent.click(c6Checkbox);
    expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 5 of 5 companies");
  });

  it("submits bulk research request and renders progress modal and results", async () => {
    const handleSelectCompany = vi.fn();

    // Mock persistent bulk research endpoints
    const mockJobCreateResp = {
      jobId: "bulk-test-job-1",
      status: "QUEUED",
      message: "Bulk company research job queued successfully",
    };

    const mockJobDoc = {
      jobId: "bulk-test-job-1",
      userId: "user-1",
      companyKeys: ["stripe"],
      status: "COMPLETED",
      progressStage: "completed",
      progressPct: 100,
      currentStageDescription: "Bulk research completed",
      metrics: {
        totalRequested: 1,
        cachedCount: 0,
        liveHarvestedCount: 1,
        geminiRequestsIssued: 1,
        totalContactsDiscovered: 2,
        contactsWithDirectEmail: 1,
        contactsWithProfileOnly: 1,
        durationSeconds: 4.2,
      },
      results: [
        {
          companyKey: "stripe",
          companyName: "Stripe",
          status: "SUCCESS",
          intelligence: {
            id: "intel-1",
            userId: "user-1",
            opportunityId: "opp-1",
            companyName: "Stripe",
            officialDomain: "stripe.com",
            riskTier: "NO_OBVIOUS_RED_FLAGS_FOUND",
            overview: "Stripe develops financial infrastructure and payment processing for the internet.",
            summary: "Verified legitimate enterprise payment processor.",
            evaluatedDimensions: {},
            redFlags: [],
            positiveSignals: ["Verified domain", "Global payment infrastructure"],
          },
          contacts: [
            {
              id: "c-1",
              fullName: "Patrick Collison",
              roleTitle: "CEO",
              contactabilityStatus: "DIRECT_EMAIL",
            },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(fetchWithAuth).mockImplementation(async (url: string, options?: any) => {
      if (url === "/api/v1/companies") {
        return mockResponse(mockCompanies);
      }
      if (url === "/api/v1/companies/bulk-research/jobs/active") {
        return mockResponse(null, false, 404);
      }
      if (url === "/api/v1/companies/bulk-research/jobs" && options?.method === "POST") {
        return mockResponse(mockJobCreateResp, true, 202);
      }
      if (url === "/api/v1/companies/bulk-research/jobs/bulk-test-job-1") {
        return mockResponse(mockJobDoc, true, 200);
      }
      return mockResponse({}, false, 404);
    });

    render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select Stripe for bulk research"));

    const researchBtn = screen.getByRole("button", { name: /Research 1 selected companies/i });
    fireEvent.click(researchBtn);

    // Modal should be open
    expect(screen.getByText("Bulk Corporate Intelligence & Discovery")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Stripe develops financial infrastructure and payment processing for the internet.")).toBeInTheDocument();
      expect(screen.getByText("$0.00 spend (Free)")).toBeInTheDocument();
      expect(screen.getByText("4.2s")).toBeInTheDocument();
    });

    const doneBtn = screen.getByRole("button", { name: "Done & Refresh" });
    fireEvent.click(doneBtn);

    await waitFor(() => {
      expect(screen.queryByText("Bulk Corporate Intelligence & Discovery")).not.toBeInTheDocument();
    });
  });

  describe("Google Photos-Style Company Selection UX", () => {
    it("hides checkboxes by default in browsing mode and reveals them in selection mode", async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
      render(<CompanyDirectoryPage onSelectCompany={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Stripe")).toBeInTheDocument();
      });

      const stripeWrapper = screen.getByTestId("company-checkbox-wrapper-stripe");
      const figmaWrapper = screen.getByTestId("company-checkbox-wrapper-figma");

      // In initial browsing mode (0 selected), wrapper has opacity-0
      expect(stripeWrapper.className).toContain("opacity-0");
      expect(figmaWrapper.className).toContain("opacity-0");

      // Selecting Stripe activates selection mode
      const stripeCheckbox = screen.getByLabelText("Select Stripe for bulk research");
      fireEvent.click(stripeCheckbox);

      // Now selection mode is active: all checkboxes have opacity-100
      expect(stripeWrapper.className).toContain("opacity-100");
      expect(stripeWrapper.className).not.toContain("opacity-0");
      expect(figmaWrapper.className).toContain("opacity-100");
      expect(figmaWrapper.className).not.toContain("opacity-0");
    });

    it("in selection mode, clicking anywhere on an unselected card selects it without navigating", async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
      const handleSelectCompany = vi.fn();
      render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

      await waitFor(() => {
        expect(screen.getByText("Stripe")).toBeInTheDocument();
      });

      // Activate selection mode by checking Stripe
      fireEvent.click(screen.getByLabelText("Select Stripe for bulk research"));
      expect(handleSelectCompany).not.toHaveBeenCalled();

      // Now click on the Figma card (not the checkbox)
      const figmaName = screen.getByText("Figma");
      fireEvent.click(figmaName);

      // Figma should now be selected and handleSelectCompany still NOT called
      expect(handleSelectCompany).not.toHaveBeenCalled();
      const figmaCheckbox = screen.getByLabelText("Select Figma for bulk research");
      expect(figmaCheckbox).toBeChecked();
      expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 2 of 5 companies");
    });

    it("in selection mode, clicking anywhere on a selected card deselects it without navigating", async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
      const handleSelectCompany = vi.fn();
      render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

      await waitFor(() => {
        expect(screen.getByText("Stripe")).toBeInTheDocument();
      });

      // Activate selection mode by checking Stripe
      fireEvent.click(screen.getByLabelText("Select Stripe for bulk research"));
      const stripeCheckbox = screen.getByLabelText("Select Stripe for bulk research");
      expect(stripeCheckbox).toBeChecked();

      // Click on the Stripe card title to deselect
      fireEvent.click(screen.getByText("Stripe"));

      // Stripe should now be deselected and handleSelectCompany was NOT called
      expect(stripeCheckbox).not.toBeChecked();
      expect(handleSelectCompany).not.toHaveBeenCalled();

      // Since all companies are deselected, selection mode has ended (checkboxes return to opacity-0)
      const stripeWrapper = screen.getByTestId("company-checkbox-wrapper-stripe");
      expect(stripeWrapper.className).toContain("opacity-0");
    });

    it("explicitly clicking 'View Profile & Contacts' navigates even during selection mode", async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(mockCompanies));
      const handleSelectCompany = vi.fn();
      render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

      await waitFor(() => {
        expect(screen.getByText("Stripe")).toBeInTheDocument();
      });

      // Activate selection mode
      fireEvent.click(screen.getByLabelText("Select Stripe for bulk research"));

      // Click explicit 'View Profile & Contacts' for Figma
      const figmaViewProfile = screen.getByLabelText("View Profile & Contacts for Figma");
      fireEvent.click(figmaViewProfile);

      // Explicit navigation must work!
      expect(handleSelectCompany).toHaveBeenCalledWith("figma");
    });

    it("clicking card when 5 companies are already selected triggers max warning and does not select 6th", async () => {
      const sixCompanies: CompanySummary[] = [
        { key: "c1", name: "Company 1", domain: "c1.com", primaryOpportunityId: "1", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
        { key: "c2", name: "Company 2", domain: "c2.com", primaryOpportunityId: "2", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
        { key: "c3", name: "Company 3", domain: "c3.com", primaryOpportunityId: "3", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
        { key: "c4", name: "Company 4", domain: "c4.com", primaryOpportunityId: "4", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
        { key: "c5", name: "Company 5", domain: "c5.com", primaryOpportunityId: "5", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
        { key: "c6", name: "Company 6", domain: "c6.com", primaryOpportunityId: "6", opportunities: [], opportunityCount: 1, hasIntelligence: false, intelligenceStatus: "NOT_RESEARCHED", contactsCount: 0 },
      ];
      vi.mocked(fetchWithAuth).mockResolvedValueOnce(mockResponse(sixCompanies));
      const handleSelectCompany = vi.fn();
      render(<CompanyDirectoryPage onSelectCompany={handleSelectCompany} />);

      await waitFor(() => {
        expect(screen.getByText("Company 1")).toBeInTheDocument();
      });

      // Select first 5 companies
      for (let i = 1; i <= 5; i++) {
        fireEvent.click(screen.getByLabelText(`Select Company ${i} for bulk research`));
      }

      // Now in selection mode with 5 selected. Clicking the 6th company card should warn and not select
      fireEvent.click(screen.getByText("Company 6"));
      expect(screen.getByText(/Maximum 5 companies can be researched per batch/i)).toBeInTheDocument();
      expect(screen.getByTestId("selected-count-label")).toHaveTextContent("Selected 5 of 5 companies");
      expect(handleSelectCompany).not.toHaveBeenCalled();
    });
  });
});
