import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/domain/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines; null becomes empty", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, "line\nbreak"]])).toBe('a,b\n"x,y","say ""hi"""\n,"line\nbreak"');
  });
});
