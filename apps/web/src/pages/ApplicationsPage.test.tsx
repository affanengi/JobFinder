import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApplicationsPage } from "./ApplicationsPage";
import { AuthProvider } from "../context/AuthContext";

// Mock api
vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

// Mock ResumeStudioModal so we don't need LaTeX compiler or canvas in unit tests
vi.mock("../components/resume/ResumeStudioModal", () => ({
  ResumeStudioModal: ({ isOpen, onClose, onApplicationApproved }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-resume-studio-modal">
        <span>Mock Resume Studio</span>
        <button onClick={() => onApplicationApproved && onApplicationApproved("res_new")}>
          Confirm Approval
        </button>
        <button onClick={onClose}>Close Studio</button>
      </div>
    );
  },
}));

import { fetchWithAuth } from "../lib/api";

const mockApplications = [
  {
    id: "app_saved_no_resume",
    userId: "user_default",
    jobId: "job_stripe",
    company: "Stripe",
    jobTitle: "Software Engineer",
    location: "San Francisco, CA",
    status: "saved",
    isExternal: false,
    resumeSnapshot: null,
    tailoredResumeId: null,
    history: [],
    stageTimestamps: { saved: "2026-09-08T00:00:00Z" },
  },
  {
    id: "app_saved_with_resume",
    userId: "user_default",
    jobId: "job_vercel",
    company: "Vercel",
    jobTitle: "Frontend Lead",
    location: "Remote",
    status: "saved",
    isExternal: false,
    resumeSnapshot: {
      resumeId: "res_vercel_1",
      version: 1,
      jobId: "job_vercel",
      targetRole: "Frontend Lead",
      skillsUsed: ["React", "Next.js"],
      bulletCount: 14,
      approvedAt: "2026-09-08T01:00:00Z",
    },
    tailoredResumeId: "res_vercel_1",
    history: [],
    stageTimestamps: { saved: "2026-09-08T01:00:00Z" },
  },
  {
    id: "app_interviewing",
    userId: "user_default",
    jobId: "job_openai",
    company: "OpenAI",
    jobTitle: "Research Engineer",
    location: "San Francisco, CA",
    status: "interviewing",
    isExternal: false,
    resumeSnapshot: {
      resumeId: "res_openai_1",
      version: 1,
      jobId: "job_openai",
      targetRole: "Research Engineer",
      skillsUsed: ["PyTorch"],
      bulletCount: 12,
      approvedAt: "2026-09-07T00:00:00Z",
    },
    tailoredResumeId: "res_openai_1",
    history: [],
    stageTimestamps: {
      saved: new Date(Date.now() - 3 * 86400000).toISOString(),
      interviewing: new Date(Date.now() - 1 * 86400000).toISOString(),
    },
  },
  {
    id: "app_ready_autofill",
    userId: "user_default",
    jobId: "job_anthropic",
    company: "Anthropic",
    jobTitle: "Staff ML Engineer",
    location: "Remote",
    status: "ready",
    isExternal: false,
    portalUrl: "https://jobs.lever.co/anthropic/123",
    resumeSnapshot: {
      resumeId: "res_anthropic_1",
      version: 1,
      jobId: "job_anthropic",
      targetRole: "Staff ML Engineer",
      skillsUsed: ["Claude", "Python"],
      bulletCount: 15,
      approvedAt: "2026-09-08T02:00:00Z",
    },
    tailoredResumeId: "res_anthropic_1",
    history: [],
    stageTimestamps: { saved: "2026-09-08T02:00:00Z", ready: "2026-09-08T02:30:00Z" },
  },
];

describe("ApplicationsPage - Drag-and-Drop Lifecycle & Outcome Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWithAuth as any).mockImplementation((url: string, options?: any) => {
      console.error('FETCH MOCK CALLED:', url, options?.method || 'GET');
      if (url === "/api/v1/applications/sync-from-saved") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ createdCount: 0, totalSynced: 3 }),
        });
      }
      if (url === "/api/v1/applications" && (!options || !options.method || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockApplications),
        });
      }
      if (url.includes("/status") && options?.method === "PATCH") {
        const body = JSON.parse(options.body);
        const appId = url.split("/")[4];
        const baseApp = mockApplications.find((a) => a.id === appId) || mockApplications[0];
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...baseApp,
              status: body.newStatus,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  const renderComponent = () =>
    render(
      <AuthProvider>
        <ApplicationsPage />
      </AuthProvider>
    );

  it("renders the 5 active Kanban columns and concluded applications area", async () => {
    renderComponent();

    expect(await screen.findByText("Saved / Draft")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-ready")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-applied")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-interviewing")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-offer")).toBeInTheDocument();
    expect(screen.getByText("Concluded Applications")).toBeInTheDocument();
  });

  it("blocks drag-and-drop to Ready to Apply when resume snapshot is missing and opens MissingResumeModal", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    // Locate the Stripe card and the 'Ready to Apply' column
    const stripeCard = screen.getByText("Stripe").closest("[draggable='true']");
    expect(stripeCard).not.toBeNull();

    const readyColumn = screen.getByTestId("kanban-column-ready");
    expect(readyColumn).not.toBeNull();
    

    // Trigger dragstart on Stripe card with its id in dataTransfer
    const dataTransfer = {
      data: { "text/plain": "app_saved_no_resume" } as Record<string, string>,
      setData: vi.fn((key: string, val: string) => {
        dataTransfer.data[key] = val;
      }),
      getData: vi.fn((key: string) => dataTransfer.data[key] || ""),
    };

    fireEvent.dragStart(stripeCard!, { dataTransfer });
    fireEvent.drop(readyColumn!, { dataTransfer });

    // Missing resume modal should open
    await waitFor(() => {
      expect(screen.getByText("Tailored Resume Required")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Approved resume package needed for Ready to Apply")
    ).toBeInTheDocument();

    // Clicking 'Tailor Resume' in MissingResumeModal opens Resume Studio
    const tailorBtn = screen.getByRole("button", { name: /Tailor Resume/i });
    fireEvent.click(tailorBtn);

    await waitFor(() => {
      expect(screen.getByTestId("mock-resume-studio-modal")).toBeInTheDocument();
    });
  });

  it("allows drag-and-drop to Ready to Apply when approved tailored resume snapshot exists", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Vercel")).toBeInTheDocument();
    });

    const vercelCard = screen.getByText("Vercel").closest("[draggable='true']");
    const readyColumn = screen.getByTestId("kanban-column-ready");

    const dataTransfer = {
      data: { "text/plain": "app_saved_with_resume" },
      setData: vi.fn(),
      getData: vi.fn(() => "app_saved_with_resume"),
    };

    fireEvent.dragStart(vercelCard!, { dataTransfer });
    fireEvent.drop(readyColumn!, { dataTransfer });

    // Should call status update PATCH directly
    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/applications/app_saved_with_resume/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            newStatus: "ready",
            note: "Moved to Ready to Apply via drag-and-drop",
            eventSource: "candidate",
          }),
        })
      );
    });
  });

  it("prompts OutcomeDecisionModal when dragging from Interviewing to Offers", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    const openaiCard = screen.getByText("OpenAI").closest("[draggable='true']");
    const offersColumn = screen.getByTestId("kanban-column-offer");

    const dataTransfer = {
      data: { "text/plain": "app_interviewing" },
      setData: vi.fn(),
      getData: vi.fn(() => "app_interviewing"),
    };

    fireEvent.dragStart(openaiCard!, { dataTransfer });
    fireEvent.drop(offersColumn!, { dataTransfer });

    // Outcome Decision Modal should appear
    await waitFor(() => {
      expect(screen.getByText("Record Application Outcome")).toBeInTheDocument();
    });
    expect(screen.getByTestId("outcome-offer-btn")).toBeInTheDocument();
    expect(screen.getByTestId("outcome-reject-btn")).toBeInTheDocument();

    // Clicking 'Offer Received' moves to offer
    const offerBtn = screen.getByTestId("outcome-offer-btn");
    fireEvent.click(offerBtn);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/applications/app_interviewing/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            newStatus: "offer",
            note: "Received formal job offer",
            eventSource: "candidate",
          }),
        })
      );
    });
  });

  it("transitions to rejected and surfaces in Concluded Applications when Rejected is chosen in outcome dialog", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    const openaiCard = screen.getByText("OpenAI").closest("[draggable='true']");
    const offersColumn = screen.getByTestId("kanban-column-offer");

    const dataTransfer = {
      data: { "text/plain": "app_interviewing" },
      setData: vi.fn(),
      getData: vi.fn(() => "app_interviewing"),
    };

    fireEvent.dragStart(openaiCard!, { dataTransfer });
    fireEvent.drop(offersColumn!, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("Record Application Outcome")).toBeInTheDocument();
    });

    // Choose Rejected option
    const rejectedBtn = screen.getByTestId("outcome-reject-btn");
    fireEvent.click(rejectedBtn);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/applications/app_interviewing/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            newStatus: "rejected",
            note: "Recorded rejection outcome",
            eventSource: "candidate",
          }),
        })
      );
    });
  });

  it("does not mutate state on invalid drop such as Saved directly to Offers", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    const stripeCard = screen.getByText("Stripe").closest("[draggable='true']");
    const offersColumn = screen.getByTestId("kanban-column-offer");

    const dataTransfer = {
      data: { "text/plain": "app_saved_no_resume" },
      setData: vi.fn(),
      getData: vi.fn(() => "app_saved_no_resume"),
    };

    fireEvent.dragStart(stripeCard!, { dataTransfer });
    fireEvent.drop(offersColumn!, { dataTransfer });

    // No status PATCH should be called
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      expect.stringContaining("/status"),
      expect.anything()
    );
  });

  it("allows reverse drag-and-drop from Interviewing back to Applied", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    const openaiCard = screen.getByText("OpenAI").closest("[draggable='true']");
    const appliedColumn = screen.getByTestId("kanban-column-applied");

    const dataTransfer = {
      data: { "text/plain": "app_interviewing" },
      setData: vi.fn(),
      getData: vi.fn(() => "app_interviewing"),
    };

    fireEvent.dragStart(openaiCard!, { dataTransfer });
    fireEvent.drop(appliedColumn!, { dataTransfer });

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/applications/app_interviewing/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            newStatus: "applied",
            note: "Moved to applied via drag-and-drop",
            eventSource: "candidate",
          }),
        })
      );
    });
  });
  it("opens PlaywrightAutofillModal when Autofill button is clicked on Ready application", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Anthropic")).toBeInTheDocument();
    });

    // Find and click the Autofill button on the Anthropic ready card
    const autofillBtn = screen.getByRole("button", { name: /Autofill/i });
    expect(autofillBtn).toBeInTheDocument();
    fireEvent.click(autofillBtn);

    // Verify PlaywrightAutofillModal rendered
    await waitFor(() => {
      expect(screen.getByText("Autofill Application")).toBeInTheDocument();
      expect(screen.getByText("Playwright Local")).toBeInTheDocument();
      expect(screen.getByText("Launch Autofill Session")).toBeInTheDocument();
      expect(screen.getByText("Strict Human-In-The-Loop Safety Policy")).toBeInTheDocument();
    });
  });
});

describe("ApplicationsPage - Activity Date Filter Scoping & Behavior", () => {
  const renderComponent = () =>
    render(
      <AuthProvider>
        <ApplicationsPage />
      </AuthProvider>
    );

  it("renders Activity: Last 7 Days as default and preserves Saved & Ready queues", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("Stripe")).toBeInTheDocument(); // saved
      expect(screen.getByText("Anthropic")).toBeInTheDocument(); // ready
      expect(screen.getByText("OpenAI")).toBeInTheDocument(); // interviewing (within 7d)
    });
    expect(screen.getByText("Activity:")).toBeInTheDocument();
    expect(screen.getByText("Last 7 Days")).toBeInTheDocument();
  });

  it("filters historical stages when 'Today' is selected while keeping Saved & Ready unaffected", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    // Open date filter dropdown
    const filterBtn = screen.getByTestId("activity-date-filter-button");
    fireEvent.click(filterBtn);

    // Click 'Today'
    const todayOption = screen.getByTestId("activity-option-today");
    fireEvent.click(todayOption);

    await waitFor(() => {
      // Saved & Ready MUST remain unaffected
      expect(screen.getByText("Stripe")).toBeInTheDocument();
      expect(screen.getByText("Anthropic")).toBeInTheDocument();
      // OpenAI was updated yesterday (-1 day), so it must be filtered out under 'Today'
      expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    });
  });

  it("resets filter back to All Time via empty state button", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    // Switch to Today
    fireEvent.click(screen.getByTestId("activity-date-filter-button"));
    fireEvent.click(screen.getByTestId("activity-option-today"));

    await waitFor(() => {
      expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    });

    // Find reset button in empty column
    const resetButtons = screen.getAllByRole("button", { name: /View All Time/i });
    expect(resetButtons.length).toBeGreaterThan(0);
    fireEvent.click(resetButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
      expect(screen.getByText("All Time")).toBeInTheDocument();
    });
  });
});
