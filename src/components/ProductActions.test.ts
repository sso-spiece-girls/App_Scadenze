import { describe, expect, it } from "vitest";
import { addDays, toDateOnly, todayLocal } from "../utils/date";
import { reactivateDefaultDate } from "./ProductActions";

describe("reactivateDefaultDate", () => {
  it("keeps the original expiration when it is still in the future", () => {
    // Any far-future date must be returned unchanged regardless of "today".
    expect(reactivateDefaultDate("2026-12-31")).toBe("2026-12-31");
  });

  it("suggests today + 7 days when the expiration is past or today", () => {
    const expected = toDateOnly(addDays(todayLocal(), 7));
    expect(reactivateDefaultDate("2020-01-01")).toBe(expected);
    expect(reactivateDefaultDate(toDateOnly(todayLocal()))).toBe(expected);
  });
});