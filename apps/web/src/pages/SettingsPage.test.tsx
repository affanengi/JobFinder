import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsPage } from "./SettingsPage";

// Mock API client
vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../lib/api";

const mockAutofillProfile = {
  firstName: "Affan",
  lastName: "Razvi",
  fullName: "Mohammed Affan Razvi",
  email: "affan@example.com",
  phone: "+91 8978293087",
  streetAddress: "Road 12, Banjara Hills",
  city: "Hyderabad",
  state: "Telangana",
  postalCode: "500034",
  country: "India",
  gender: "Male",
  pronouns: "he/him/his",
  linkedinUrl: "https://linkedin.com/in/affan-razvi",
  githubUrl: "https://github.com/affanengi",
  portfolioUrl: "https://affan.dev",
};

const mockMasterProfile = {
  userId: "user_test_123",
  personal: {
    fullName: "Mohammed Affan Razvi (Master)",
    firstName: "Mohammed",
    lastName: "Razvi",
    email: "master_email@example.com",
    phone: "+91 9999999999",
    city: "Hyderabad",
    country: "India",
    links: {
      linkedin: "https://linkedin.com/in/master-affan",
      github: "https://github.com/master-affan",
      portfolio: "https://master-portfolio.com",
    },
  },
  skills: [],
};

describe("SettingsPage Autofill Configuration & Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWithAuth as any).mockImplementation((url: string, options?: any) => {
      if (url === "/api/v1/profile/autofill") {
        if (options?.method === "PUT") {
          return Promise.resolve({
            ok: true,
            json: async () => JSON.parse(options.body),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockAutofillProfile,
        });
      }
      if (url === "/api/v1/profile") {
        return Promise.resolve({
          ok: true,
          json: async () => mockMasterProfile,
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it("renders Autofill Configuration tab by default with loaded fields", async () => {
    render(<SettingsPage />);

    expect(screen.getByText("Settings & Configuration")).toBeDefined();
    expect(screen.getByText("Autofill Configuration")).toBeDefined();

    // Wait for initial data to load
    await waitFor(() => {
      const emailInput = screen.getByDisplayValue("affan@example.com");
      expect(emailInput).toBeDefined();
    });

    expect(screen.getByDisplayValue("Road 12, Banjara Hills")).toBeDefined();
    expect(screen.getByDisplayValue("Hyderabad")).toBeDefined();
    expect(screen.getByDisplayValue("India")).toBeDefined();
  });

  it("switches to Discovery & Integrations tab and shows Extension Clipper card", async () => {
    render(<SettingsPage />);

    const integrationsTab = screen.getByRole("button", { name: /Discovery & Integrations/i });
    fireEvent.click(integrationsTab);

    expect(screen.getByText("JobFinder Web Clipper (Extension)")).toBeDefined();
    expect(screen.getByText("Ready to Install")).toBeDefined();
    expect(screen.getByText("Desired Job Roles")).toBeDefined();
    expect(screen.getByText("Hard Excluded Roles")).toBeDefined();
  });

  it("enables Save button and shows unsaved changes badge on edit", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Road 12, Banjara Hills")).toBeDefined();
    });

    const streetInput = screen.getByDisplayValue("Road 12, Banjara Hills");
    fireEvent.change(streetInput, { target: { value: "456 Innovation Park" } });

    expect(screen.getByText("Unsaved changes")).toBeDefined();
    const saveButton = screen.getByRole("button", { name: /Save Autofill Configuration/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("prefills from Master Profile on explicit button click without auto-saving", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("affan@example.com")).toBeDefined();
    });

    const prefillBtn = screen.getByRole("button", { name: /Prefill from Master Profile/i });
    fireEvent.click(prefillBtn);

    await waitFor(() => {
      expect(screen.getByText(/Prefilled details from Master Profile/i)).toBeDefined();
    });

    // Verify Master Profile data was loaded into form
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/profile");
    // Ensure PUT was NOT automatically dispatched
    expect(fetchWithAuth).not.toHaveBeenCalledWith("/api/v1/profile/autofill", expect.objectContaining({ method: "PUT" }));
  });

  it("submits updated autofill profile to PUT /api/v1/profile/autofill on save", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Road 12, Banjara Hills")).toBeDefined();
    });

    const streetInput = screen.getByDisplayValue("Road 12, Banjara Hills");
    fireEvent.change(streetInput, { target: { value: "789 Tech Boulevard" } });

    const saveButton = screen.getByRole("button", { name: /Save Autofill Configuration/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/profile/autofill",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Autofill Configuration saved successfully/i)).toBeDefined();
    });
  });
});
