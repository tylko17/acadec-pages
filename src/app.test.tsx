// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("app flow (demo backend)", () => {
  it("gate -> pick name -> review a card -> score moves -> team shows it", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Wrong code is refused, right code lets us in.
    await user.type(await screen.findByPlaceholderText("Team code"), "nope");
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(await screen.findByText("That's not the team code.")).toBeTruthy();
    await user.clear(screen.getByPlaceholderText("Team code"));
    await user.type(screen.getByPlaceholderText("Team code"), "demo");
    await user.click(screen.getByRole("button", { name: "Enter" }));

    // Pick a name.
    await user.click(await screen.findByRole("button", { name: "Avery Chen" }));
    expect(await screen.findByText(/projected for competition day/)).toBeTruthy();
    const before = document.querySelector(".big")!.textContent;

    // Review: reveal, grade Good, a dozen times.
    await user.click(screen.getAllByText(/^Review/)[1] ?? screen.getByText(/^Review/));
    for (let i = 0; i < 12; i++) {
      await user.click(await screen.findByRole("button", { name: /Show answer/ }));
      await user.click(await screen.findByRole("button", { name: /Good/ }));
    }
    expect(await screen.findByText(/pts/)).toBeTruthy();

    // Home score has risen, and the Team page shows it for this student.
    window.location.hash = "#/";
    await waitFor(() => expect(document.querySelector(".big")!.textContent).not.toBe(before));
    window.location.hash = "#/team";
    const row = await screen.findByText("Avery Chen");
    await waitFor(() => expect(row.closest("tr")!.textContent).toMatch(/counts/));
    cleanup();
  });
});
