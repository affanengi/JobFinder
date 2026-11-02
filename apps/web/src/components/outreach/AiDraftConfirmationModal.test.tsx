import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AiDraftConfirmationModal } from "./AiDraftConfirmationModal";

describe("AiDraftConfirmationModal (Section D Strict Flow)", () => {
  it("renders modal with exact confirmation message and two buttons", () => {
    render(
      <AiDraftConfirmationModal
        isOpen={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isGenerating={false}
      />
    );

    // Exact prompt from Section D requirement 3
    expect(
      screen.getByText("Generate tailored outreach draft with AI?")
    ).toBeInTheDocument();

    // Exactly two action buttons (Requirement 4)
    const confirmBtn = screen.getByRole("button", { name: "Yes, write with AI" });
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });

    expect(confirmBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked without triggering confirm", () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <AiDraftConfirmationModal
        isOpen={true}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isGenerating={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when 'Yes, write with AI' is clicked", () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <AiDraftConfirmationModal
        isOpen={true}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isGenerating={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Yes, write with AI" }));

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(handleCancel).not.toHaveBeenCalled();
  });

  it("displays loading spinner and disables buttons when isGenerating is true", () => {
    render(
      <AiDraftConfirmationModal
        isOpen={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isGenerating={true}
      />
    );

    expect(screen.getByText("Generating Draft...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <AiDraftConfirmationModal
        isOpen={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isGenerating={false}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
