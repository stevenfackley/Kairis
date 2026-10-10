import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/domain/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines; null becomes empty", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, "line\nbreak"]])).toBe('a,b\n"x,y","say ""hi"""\n,"line\nbreak"');
  });

  it("neutralizes cells a spreadsheet would run as a formula", () => {
    const row = ['=HYPERLINK("http://evil.example","x")', "+1+1", "-2+3", "@SUM(A1)", "\tTAB", "\rCR", "fine"];
    expect(toCsv(["n"], [row]).split("\n")[1]).toBe(
      `"'=HYPERLINK(""http://evil.example"",""x"")",'+1+1,'-2+3,'@SUM(A1),'\tTAB,"'\rCR",fine`
    );
  });

  it("keeps pure numbers unprefixed, negative ones included, whether numbers or numeric text", () => {
    expect(toCsv(["a", "b", "c", "d", "e"], [[-12.5, "-12.5", "+3", 0, "-0.00000012"]]).split("\n")[1]).toBe("-12.5,-12.5,+3,0,-0.00000012");
  });

  it("writes numbers as plain decimals: no exponent, no grouping, no currency", () => {
    expect(toCsv(["a", "b", "c", "d"], [[0.00000012, 61234.5, 1500, -0.0000001]]).split("\n")[1]).toBe("0.00000012,61234.5,1500,-0.0000001");
  });

  it("writes non-finite numbers as empty cells", () => {
    expect(toCsv(["a", "b"], [[Number.NaN, Number.POSITIVE_INFINITY]]).split("\n")[1]).toBe(",");
  });
});
