// Unit tests for the OS-shell URL openers (CONTACT-02). The opener plugin is
// mocked: we only assert the exact URL string handed to openUrl, proving the
// tel:/mailto:/https builders sanitize+normalize correctly (T-01-INJ mitigation).
// jsdom default environment (NOT the node:sqlite harness — this module imports
// only @tauri-apps/plugin-opener, never drizzle).
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(async () => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));

const { openTel, openMail, openLinkedIn } = await import("./contactActions");

beforeEach(() => {
  openUrl.mockClear();
});

describe("contactActions URL builders", () => {
  it("openTel strips everything but digits and + and emits a tel: URL", async () => {
    await openTel("+43 1 234-567");
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("tel:+431234567");
  });

  it("openMail emits a mailto: URL for the given address", async () => {
    await openMail("eva@himmelhoch.at");
    expect(openUrl).toHaveBeenCalledWith("mailto:eva@himmelhoch.at");
  });

  it("openLinkedIn prefixes https:// when the value has no scheme", async () => {
    await openLinkedIn("linkedin.com/in/eva-mandl");
    expect(openUrl).toHaveBeenCalledWith("https://linkedin.com/in/eva-mandl");
  });

  it("openLinkedIn passes a full https:// URL through unchanged", async () => {
    await openLinkedIn("https://www.linkedin.com/in/eva-mandl");
    expect(openUrl).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/eva-mandl"
    );
  });
});
