import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadTimeline } from "./ThreadTimeline";
import { OutreachMessage, OutreachReply, ThreadTimelineResponse } from "../../types/outreach";
import { fetchWithAuth } from "../../lib/api";

// Mock API client
vi.mock("../../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

const mockOutreach: OutreachMessage = {
  id: "outreach-123",
  userId: "user-456",
  opportunityId: "opp-456",
  contactId: "contact-789",
  recipientEmail: "recruiter@example.com",
  recipientName: "Jane Doe",
  recipientTitle: "Lead Recruiter",
  companyName: "Acme Corp",
  emailClassification: "PROVIDER_VERIFIED",
  subject: "Regarding Senior Frontend Role",
  body: "Hi Jane, I saw the open role at Acme Corp and would love to connect.",
  status: "SENT",
  truthLockReport: {
    status: "PASS",
    totalChecks: 3,
    passedChecks: 3,
    findings: [],
    verifiedFactReferences: ["Resume line 12"],
  },
  gmailMessageId: "msg-sent-001",
  gmailThreadId: "thread-xyz-001",
  sentAt: "2026-10-26T10:00:00Z",
  correlationId: "corr-123",
  replyCount: 1,
  createdAt: "2026-10-26T09:00:00Z",
  updatedAt: "2026-10-26T10:00:00Z",
};

const mockReply: OutreachReply = {
  id: "reply-1",
  outreachId: "outreach-123",
  userId: "user-456",
  opportunityId: "opp-456",
  contactId: "contact-789",
  gmailMessageId: "msg-reply-001",
  gmailThreadId: "thread-xyz-001",
  senderEmail: "recruiter@example.com",
  senderName: "Jane Doe",
  recipientEmail: "candidate@example.com",
  subject: "Re: Regarding Senior Frontend Role",
  snippet: "Thanks for reaching out! Let's schedule a call this week.",
  bodyText: "Thanks for reaching out! Let's schedule a call this week.",
  receivedAt: "2026-10-26T14:30:00Z",
  intent: "POSITIVE_INTEREST",
  intentRationale: "Candidate explicitly invited to schedule an interview call.",
  intentConfidence: 0.95,
  evidenceSnippet: "Let's schedule a call this week.",
  processingStatus: "CLASSIFIED",
  suppressionState: "NONE",
  isManuallyReviewed: false,
  createdAt: "2026-10-26T14:31:00Z",
  updatedAt: "2026-10-26T14:31:00Z",
};

const mockTimelineResponse: ThreadTimelineResponse = {
  outreach: mockOutreach,
  replies: [mockReply],
  totalReplies: 1,
  hasReadPermission: true,
};

describe("ThreadTimeline Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton while timeline is fetching", () => {
    vi.mocked(fetchWithAuth).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading state
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    expect(screen.getByText("Loading thread timeline...")).toBeInTheDocument();
  });

  it("renders error state with retry button when initial fetch fails", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse({ detail: "Database connection failed" }, false, 500)
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load thread timeline/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("renders empty state when no replies exist yet", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse({
        outreach: mockOutreach,
        replies: [],
        totalReplies: 0,
        hasReadPermission: true,
      })
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No replies detected yet.")).toBeInTheDocument();
    });

    expect(screen.getByText("Check for Replies")).toBeInTheDocument();
    expect(screen.getByText("Regarding Senior Frontend Role")).toBeInTheDocument();
  });

  it("renders replies with intent badge and AI rationale", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse(mockTimelineResponse)
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Positive Interest")).toBeInTheDocument();
    });

    expect(screen.getByText("Thanks for reaching out! Let's schedule a call this week.")).toBeInTheDocument();
    expect(screen.getByText("Candidate explicitly invited to schedule an interview call.")).toBeInTheDocument();
    expect(screen.getByText("AI Classified")).toBeInTheDocument();
  });

  it("allows overriding intent via manual review controls", async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(
        mockResponse({
          ...mockTimelineResponse,
          replies: [{ ...mockReply, intent: "NEEDS_MANUAL_REVIEW" }],
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          ...mockReply,
          intent: "JOB_REJECTION",
          suppressionState: "JOB_SPECIFIC_SUPPRESSION",
          isManuallyReviewed: true,
          manualNotes: "Role filled by another candidate",
        })
      );

    const onReplyUpdated = vi.fn();

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
        onReplyUpdated={onReplyUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Manual Review / Reclassify")).toBeInTheDocument();
    });

    // Click "Manual Review / Reclassify"
    fireEvent.click(screen.getByText("Manual Review / Reclassify"));

    // Form inputs should be visible
    expect(screen.getByText("Manual Intent Override")).toBeInTheDocument();

    // Select "JOB_REJECTION" button
    const rejectionBtn = screen.getByText("JOB_REJECTION");
    fireEvent.click(rejectionBtn);

    // Enter notes
    const input = screen.getByPlaceholderText("Optional notes or context...");
    fireEvent.change(input, { target: { value: "Role filled by another candidate" } });

    // Submit review
    const saveBtn = screen.getByText("Save Override");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    });

    expect(onReplyUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "JOB_REJECTION",
        isManuallyReviewed: true,
      })
    );
  });

  it("displays missing read permission warning banner when hasReadPermission is false", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse({
        outreach: mockOutreach,
        replies: [],
        totalReplies: 0,
        hasReadPermission: false,
      })
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText("Gmail Read Permission Needed for Automatic Reply Tracking")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Grant Read Access")).toBeInTheDocument();
  });

  it("displays suppression notice when reply has GLOBAL_STAKEHOLDER_SUPPRESSION", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse({
        outreach: mockOutreach,
        replies: [
          {
            ...mockReply,
            intent: "DO_NOT_CONTACT",
            suppressionState: "GLOBAL_STAKEHOLDER_SUPPRESSION",
            intentRationale: "Explicit unsubscribe request.",
          },
        ],
        totalReplies: 1,
        hasReadPermission: true,
      })
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Global Opt-Out Active:")).toBeInTheDocument();
    });
    expect(screen.getByText(/All future sending is blocked/i)).toBeInTheDocument();
  });

  it("displays job-specific suppression notice when reply has JOB_SPECIFIC_SUPPRESSION", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      mockResponse({
        outreach: mockOutreach,
        replies: [
          {
            ...mockReply,
            intent: "JOB_REJECTION",
            suppressionState: "JOB_SPECIFIC_SUPPRESSION",
            intentRationale: "Candidate not selected for this position.",
          },
        ],
        totalReplies: 1,
        hasReadPermission: true,
      })
    );

    render(
      <ThreadTimeline
        opportunityId="opp-456"
        outreachId="outreach-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Role Rejection (Job-Specific):")).toBeInTheDocument();
    });
    expect(screen.getByText(/Contact remains eligible for other job opportunities/i)).toBeInTheDocument();
  });
});
