import { describe, expect, it } from "vitest";
import { fromPicker, REMINDER_TIME_RE, toPicker } from "@/components/ReminderTimePicker";

// reminder-cron compares reminder_times to "HH:MM" exactly: these must never drift.
describe("fromPicker", () => {
  it.each([
    [{ hour12: 12, minute: 0, pm: false }, "00:00"],
    [{ hour12: 12, minute: 15, pm: false }, "00:15"],
    [{ hour12: 12, minute: 5, pm: true }, "12:05"],
    [{ hour12: 1, minute: 0, pm: true }, "13:00"],
    [{ hour12: 11, minute: 59, pm: true }, "23:59"],
    [{ hour12: 8, minute: 0, pm: false }, "08:00"],
    [{ hour12: 8, minute: 30, pm: false }, "08:30"],
    [{ hour12: 8, minute: 30, pm: true }, "20:30"],
    [{ hour12: 11, minute: 4, pm: true }, "23:04"],
  ])("%o -> %s", (input, expected) => {
    expect(fromPicker(input)).toBe(expected);
  });
});

describe("toPicker", () => {
  it.each([
    ["00:15", { hour12: 12, minute: 15, pm: false }],
    ["12:05", { hour12: 12, minute: 5, pm: true }],
    ["13:00", { hour12: 1, minute: 0, pm: true }],
    ["23:59", { hour12: 11, minute: 59, pm: true }],
    ["08:00", { hour12: 8, minute: 0, pm: false }],
    ["20:30:00", { hour12: 8, minute: 30, pm: true }],
  ])("%s", (input, expected) => {
    expect(toPicker(input)).toEqual(expected);
  });

  it.each(["", "abc", "24:00", "12:60", "8:30 AM", "08-30", null, undefined])("rejects %s", (input) => {
    expect(toPicker(input as string)).toBeNull();
  });
});

describe("round trip", () => {
  it("every minute of the day survives toPicker -> fromPicker unchanged", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const out = fromPicker(toPicker(hhmm)!);
      expect(out).toBe(hhmm);
      expect(out).toMatch(REMINDER_TIME_RE);
    }
  });

  it("every picker combination produces a valid, unique HH:MM", () => {
    const seen = new Set<string>();
    for (const pm of [false, true])
      for (let hour12 = 1; hour12 <= 12; hour12++)
        for (let minute = 0; minute < 60; minute++) {
          const out = fromPicker({ hour12, minute, pm });
          expect(out).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
          seen.add(out);
        }
    expect(seen.size).toBe(1440);
  });
});
