import { describe, expect, it } from "vitest";
import {
  describeMedicine, findDuplicates, hasAnyDuplicate, isActiveMedicine, matchKind, normalizeMedicineName, type ExistingMedicine,
} from "@/lib/medicineMatch";

const med = (over: Partial<ExistingMedicine>): ExistingMedicine => ({
  id: "m1", name: "Dolo 650", dosage: "650 mg", reminder_times: ["08:00", "20:00"], is_active: true, end_date: null, ...over,
});
const TODAY = "2026-10-24";

describe("normalizeMedicineName", () => {
  it("removes form prefixes", () => {
    for (const n of ["Tab Dolo", "tab. Dolo", "TAB Dolo", "Tablet Dolo", "Cap Dolo", "Syp Dolo", "Syr. Dolo", "Inj Dolo", "Drops Dolo"]) {
      expect(normalizeMedicineName(n)).toBe("dolo");
    }
  });
  it("ignores spaces, hyphens and dots", () => {
    expect(normalizeMedicineName("Pan-D")).toBe("pand");
    expect(normalizeMedicineName("pan d")).toBe("pand");
    expect(normalizeMedicineName("PanD")).toBe("pand");
    expect(normalizeMedicineName("Pan.D")).toBe("pand");
  });
  it("removes the strength", () => {
    expect(normalizeMedicineName("Dolo 650")).toBe("dolo");
    expect(normalizeMedicineName("Pan-D 40 mg")).toBe("pand");
    expect(normalizeMedicineName("Amlong 2.5mg")).toBe("amlong");
    expect(normalizeMedicineName("Glycomet GP 1")).toBe("glycometgp");
  });
  it("does not strip letters that only look like a prefix", () => {
    expect(normalizeMedicineName("Tabcin")).toBe("tabcin");
    expect(normalizeMedicineName("Capsicum")).toBe("capsicum");
  });
  it("is empty for empty / numbers-only names", () => {
    expect(normalizeMedicineName("")).toBe("");
    expect(normalizeMedicineName("500 mg")).toBe("");
  });
});

describe("matchKind", () => {
  it("exact for the same medicine written differently", () => {
    expect(matchKind("Dolo 650", "Tab. DOLO")).toBe("exact");
    expect(matchKind("Pan-D 40", "pan d")).toBe("exact");
  });
  it("possible when one contains the other (shorter >= 5 letters)", () => {
    expect(matchKind("Pantop", "Pantop-D")).toBe("possible");
    expect(matchKind("Montek LC", "Montek")).toBe("possible");
  });
  it("no match for short contained names or different medicines", () => {
    expect(matchKind("Dolo", "Dolonex")).toBeNull(); // "dolo" has 4 letters
    expect(matchKind("Dolo 650", "Crocin")).toBeNull();
    expect(matchKind("", "Dolo")).toBeNull();
  });
});

describe("isActiveMedicine", () => {
  it("is active without an end date or ending today or later", () => {
    expect(isActiveMedicine({ is_active: true, end_date: null }, TODAY)).toBe(true);
    expect(isActiveMedicine({ is_active: true, end_date: TODAY }, TODAY)).toBe(true);
    expect(isActiveMedicine({ is_active: true, end_date: "2026-11-01" }, TODAY)).toBe(true);
  });
  it("is not active when switched off or ended", () => {
    expect(isActiveMedicine({ is_active: false, end_date: null }, TODAY)).toBe(false);
    expect(isActiveMedicine({ is_active: true, end_date: "2026-10-23" }, TODAY)).toBe(false);
  });
});

describe("findDuplicates", () => {
  const existing = [
    med({}),
    med({ id: "m2", name: "Pantop-D", dosage: "40 mg", reminder_times: ["07:30"] }),
    med({ id: "m3", name: "Crocin", is_active: false }),
    med({ id: "m4", name: "Telma 40", end_date: "2026-10-01" }),
  ];
  it("finds exact and possible matches with active medicines only", () => {
    const d = findDuplicates([{ name: "Tab Dolo 650" }, { name: "Pantop" }, { name: "Crocin" }, { name: "Telma" }, { name: "Azee" }], existing, TODAY);
    expect(d[0]).toMatchObject({ existingKind: "exact", twiceOf: null });
    expect(d[0].existing?.id).toBe("m1");
    expect(d[1]).toMatchObject({ existingKind: "possible" });
    expect(d[1].existing?.id).toBe("m2");
    expect(d[2].existing).toBeNull(); // inactive
    expect(d[3].existing).toBeNull(); // ended
    expect(d[4].existing).toBeNull();
    expect(hasAnyDuplicate(d)).toBe(true);
  });
  it("prefers an exact match over a possible one", () => {
    const d = findDuplicates([{ name: "Pantop-D" }], [med({ id: "a", name: "Pantop" }), med({ id: "b", name: "Pan-top D" })], TODAY);
    expect(d[0]).toMatchObject({ existingKind: "exact" });
    expect(d[0].existing?.id).toBe("b");
  });
  it("flags the same medicine listed twice", () => {
    const d = findDuplicates([{ name: "Azee 500" }, { name: "Dolo" }, { name: "tab azee" }], [], TODAY);
    expect(d[2].twiceOf).toBe(0);
    expect(d[0].twiceOf).toBeNull();
    expect(d[1].twiceOf).toBeNull();
  });
  it("ignores the medicine being edited", () => {
    const d = findDuplicates([{ name: "Dolo 650" }], existing, TODAY, "m1");
    expect(d[0].existing).toBeNull();
  });
  it("no duplicates for only new medicines", () => {
    expect(hasAnyDuplicate(findDuplicates([{ name: "Azee" }, { name: "Allegra" }], existing, TODAY))).toBe(false);
  });
});

describe("describeMedicine", () => {
  it("name, dosage and times", () => {
    expect(describeMedicine({ name: "Dolo", dosage: "650 mg", reminder_times: ["08:00", "20:00"] }, "en-US")).toBe("Dolo 650 mg · 8:00 AM, 8:00 PM");
    expect(describeMedicine({ name: "Dolo", dosage: "650 mg", reminder_times: [] }, "en-US")).toBe("Dolo 650 mg");
  });
  it("does not repeat a strength that is already in the name", () => {
    expect(describeMedicine({ name: "Dolo 650", dosage: "650 mg", reminder_times: ["08:00"] }, "en-US")).toBe("Dolo 650 · 8:00 AM");
    expect(describeMedicine({ name: "Dolo 650", dosage: "500 mg", reminder_times: [] }, "en-US")).toBe("Dolo 650 500 mg");
    expect(describeMedicine({ name: "Amlong 2.5", dosage: "2.5mg", reminder_times: [] }, "en-US")).toBe("Amlong 2.5");
  });
});
