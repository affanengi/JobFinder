import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResumesPage } from "./ResumesPage";
import { AuthProvider } from "../context/AuthContext";

// Mock api
vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../lib/api";

const mockResumes = [
  {
    id: "res_abc_1",
    userId: "user_default",
    jobId: "job_123",
    jobTitle: "Senior Backend Engineer",
    jobCompany: "Google",
    structuredContent: {
      summary: "Experienced backend engineer...",
      job_alignment: {
        matched_skills: ["Python", "FastAPI"],
        transferable_strengths: ["Docker"],
      },
      projects: [{ name: "Project 1" }],
    },
    validationResult: { truth_score: 95, is_valid: true, issues: [] },
    latexCode: "% LaTeX Source",
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
  },
];

const mockCoverLetters = [
  {
    id: "cov_xyz_1",
    userId: "user_default",
    jobId: "job_123",
    jobTitle: "Senior Backend Engineer",
    jobCompany: "Google",
    tone: "enthusiastic",
    content: {
      recipientName: "Hiring Team",
      companyName: "Google",
      jobTitle: "Senior Backend Engineer",
      paragraph1_hook: "I am writing with great enthusiasm for the Senior Backend Engineer position.",
      paragraph2_evidence: "With deep experience in Python and distributed systems...",
      paragraph3_alignment: "My focus on high reliability directly matches Google's standards.",
      paragraph4_closing: "Thank you for your consideration."
    },
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z"
  }
];

describe("ResumesPage Hub with Resumes, Cover Letters, and ATS Scanner Link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWithAuth as any).mockImplementation((url: string) => {
      if (url === "/api/v1/resumes") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResumes),
        });
      }
      if (url === "/api/v1/cover-letters") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCoverLetters),
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  it("renders resumes tab by default with saved resume card and Run ATS Scan button", async () => {
    const handleScan = vi.fn();

    render(
      <AuthProvider>
        <ResumesPage onNavigateToScanner={handleScan} />
      </AuthProvider>
    );

    expect(await screen.findByText("Application Artifacts Hub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resumes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cover Letters/i })).toBeInTheDocument();

    // Verify resume card content
    expect(await screen.findByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Score: 95%")).toBeInTheDocument();

    // Verify ATS Scan button triggers callback
    const scanBtn = screen.getByRole("button", { name: /Run ATS Scan/i });
    expect(scanBtn).toBeInTheDocument();
    fireEvent.click(scanBtn);
    expect(handleScan).toHaveBeenCalledWith("res_abc_1", "job_123");
  });

  it("switches to cover letters tab and displays tailored cover letter card", async () => {
    render(
      <AuthProvider>
        <ResumesPage />
      </AuthProvider>
    );

    expect(await screen.findByText("Application Artifacts Hub")).toBeInTheDocument();

    const coverLettersTab = screen.getByRole("button", { name: /Cover Letters/i });
    fireEvent.click(coverLettersTab);

    // Verify cover letter card content
    expect(await screen.findByText("enthusiastic Tone")).toBeInTheDocument();
    expect(screen.getByText("I am writing with great enthusiasm for the Senior Backend Engineer position.")).toBeInTheDocument();
  });
});
