import { describe, expect, it } from "vitest";
import { daysOverdue } from "./date";

// daysOverdue does DATE-ONLY day math in UTC (Pitfall 3): both the stored
// timestamp and `now` are floored to their UTC calendar day before subtracting,
// so a non-zero local offset on Arthur's UTC+1/+2 machine never shifts the day.
describe("daysOverdue", () => {
  it("returns 0 for a follow-up due today (same UTC calendar day)", () => {
    expect(
      daysOverdue("2026-07-01T00:00:00.000Z", new Date("2026-07-01T10:00:00Z")),
    ).toBe(0);
  });

  it("returns the whole-day difference for an overdue follow-up", () => {
    expect(
      daysOverdue("2026-06-28T12:00:00.000Z", new Date("2026-07-01T10:00:00Z")),
    ).toBe(3);
  });

  it("returns a negative number for a future-dated follow-up", () => {
    expect(
      daysOverdue("2026-07-08T00:00:00.000Z", new Date("2026-07-01T10:00:00Z")),
    ).toBeLessThan(0);
  });

  it("is date-only in UTC: midnight-UTC and noon-UTC same-day both return 0", () => {
    const atMidnight = daysOverdue(
      "2026-07-01T00:00:00.000Z",
      new Date("2026-07-01T00:00:00Z"),
    );
    const atNoon = daysOverdue(
      "2026-07-01T12:00:00.000Z",
      new Date("2026-07-01T12:00:00Z"),
    );
    expect(atMidnight).toBe(0);
    expect(atNoon).toBe(0);
  });
});
