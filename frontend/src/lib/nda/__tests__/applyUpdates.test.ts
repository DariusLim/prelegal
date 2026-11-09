import { describe, expect, it } from "vitest";

import { applyUpdates } from "../applyUpdates";
import { createDefaultFormData } from "../buildDocument";

describe("applyUpdates", () => {
  it("merges top-level fields and party details without dropping existing values", () => {
    const data = {
      ...createDefaultFormData(),
      governingLaw: "Delaware",
      party1: { name: "Ada Lovelace", title: "CEO", company: "Acme", noticeAddress: "" },
    };

    const next = applyUpdates(data, {
      mndaTermType: "untilTerminated",
      party1: { noticeAddress: "ada@acme.test" },
      party2: { company: "Globex" },
    });

    expect(next).toEqual({
      ...data,
      mndaTermType: "untilTerminated",
      party1: { ...data.party1, noticeAddress: "ada@acme.test" },
      party2: { ...data.party2, company: "Globex" },
    });
    expect(data.party1.noticeAddress).toBe(""); // input not mutated
  });

  it("returns equal data for empty updates", () => {
    const data = createDefaultFormData();
    expect(applyUpdates(data, {})).toEqual(data);
  });
});
