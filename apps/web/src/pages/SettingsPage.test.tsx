import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { AuthProvider, mockTestUser } from "../context/AuthContext";

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

  const renderSettings = (user: any = mockTestUser) =>
    render(
      <AuthProvider initialUser={user}>
        <SettingsPage />
      </AuthProvider>
    );

  it("renders Autofill Configuration tab by default with loaded fields", async () => {
    renderSettings();

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
    renderSettings();

    const integrationsTab = screen.getByRole("button", { name: /Discovery & Integrations/i });
    fireEvent.click(integrationsTab);

    expect(screen.getByText("JobFinder Web Clipper (Extension)")).toBeDefined();
    expect(screen.getByText("Ready to Install")).toBeDefined();
    expect(screen.getByText("Desired Job Roles")).toBeDefined();
    expect(screen.getByText("Hard Excluded Roles")).toBeDefined();
  });

  it("enables Save button and shows unsaved changes badge on edit", async () => {
    renderSettings();

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
    renderSettings();

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
    renderSettings();

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

  it("suppresses protected autofill profile request when signed out", async () => {
    renderSettings(null);

    // Verify protected profile/autofill endpoint is NOT called
    expect(fetchWithAuth).not.toHaveBeenCalledWith("/api/v1/profile/autofill");
    expect(fetchWithAuth).not.toHaveBeenCalledWith("/api/v1/profile");
  });

  it("displays guest notice in Autofill tab and opens AuthModal when guest clicks Save", async () => {
    renderSettings(null);

    // Verify guest notice is rendered
    expect(screen.getByText("Sign In Required for Cloud Autofill")).toBeDefined();

    // Fill in a field to enable save
    const streetInput = screen.getByPlaceholderText(/123 Innovation Drive/i);
    fireEvent.change(streetInput, { target: { value: "100 Innovation Way" } });

    const saveButton = screen.getByRole("button", { name: /Save Autofill Configuration/i });
    fireEvent.click(saveButton);

    // Verify AuthModal is opened with contextual copy
    await waitFor(() => {
      expect(screen.getByText("Sign in to Save Autofill Profile")).toBeDefined();
    });

    // Ensure no PUT mutation was fired
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      "/api/v1/profile/autofill",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("never renders hardcoded mock token clp_live_affan_personal in Integrations tab", async () => {
    // Render as guest
    renderSettings(null);

    const integrationsTab = screen.getByRole("button", { name: /Discovery & Integrations/i });
    fireEvent.click(integrationsTab);

    // Mock token must NEVER exist in DOM
    expect(screen.queryByText(/clp_live_affan_personal/)).toBeNull();

    // Guest should see sign in required notice for extension token
    expect(screen.getByText("Sign In to Access Token")).toBeDefined();
  });

  it("allows authenticated user to generate real session token in Integrations tab", async () => {
    renderSettings(mockTestUser);

    const integrationsTab = screen.getByRole("button", { name: /Discovery & Integrations/i });
    fireEvent.click(integrationsTab);

    // Mock token must NEVER exist in DOM
    expect(screen.queryByText(/clp_live_affan_personal/)).toBeNull();

    // Button to generate session token should be visible
    const generateBtn = screen.getByRole("button", { name: /Reveal Session Token/i });
    expect(generateBtn).toBeDefined();

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText("mock-id-token")).toBeDefined();
    });
  });
});
