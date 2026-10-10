import { describe, expect, it } from "vitest";
import { parseLimitsForm, parsePreferredMode } from "@/lib/domain/limits-form";

type Entries = Array<[string, string]>;

function form(entries: Entries): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const VALID: Entries = [
  ["maxPositionUsd", "1500"],
  ["dailyLossCapUsd", "300"],
  ["maxTradesPerDay", "6"],
  ["cooldownMinutes", "20"],
  ["lossStreakTrigger", "2"]
];

function withField(name: string, value: string): Entries {
  return VALID.map(([key, current]) => [key, key === name ? value : current]);
}

function errorOf(entries: Entries): string {
  const result = parseLimitsForm(form(entries));
  if (result.ok) throw new Error("expected a validation error");
  return result.error;
}

describe("parsePreferredMode", () => {
  it("accepts paper, manual and assisted only", () => {
    for (const mode of ["paper", "manual", "assisted"]) {
      expect(parsePreferredMode(form([["preferredMode", mode]]))).toEqual({ ok: true, mode });
    }
    for (const entries of [[["preferredMode", "auto"]], [["preferredMode", "PAPER"]], []] as Entries[]) {
      expect(parsePreferredMode(form(entries))).toEqual({ ok: false, error: "Choose a preferred mode: paper, manual or assisted." });
    }
  });
});

describe("parseLimitsForm", () => {
  it("parses every limit, trimmed, with no caps and the pause left as stored", () => {
    expect(parseLimitsForm(form([...withField("maxPositionUsd", " 1500.25 ")]))).toEqual({
      ok: true,
      limits: {
        maxPositionUsd: 1500.25,
        dailyLossCapUsd: 300,
        maxTradesPerDay: 6,
        cooldownMinutes: 20,
        lossStreakTrigger: 2,
        perSymbolMaxUsd: {},
        tradingPaused: undefined
      }
    });
  });

  it("reads the pause checkbox as on for on/true/yes", () => {
    for (const value of ["on", "true", "YES"]) {
      expect(parseLimitsForm(form([...VALID, ["tradingPaused", value]]))).toMatchObject({ ok: true, limits: { tradingPaused: true } });
    }
  });

  it("changes the pause only when the checkbox differs from what the form was rendered with", () => {
    const paused = (entries: Entries) => {
      const result = parseLimitsForm(form([...VALID, ...entries]));
      if (!result.ok) throw new Error(result.error);
      return result.limits.tradingPaused;
    };
    // Rendered paused, box still ticked: keep whatever is stored now (a resume elsewhere wins).
    expect(paused([["pausedWas", "true"], ["tradingPaused", "on"]])).toBeUndefined();
    // Rendered active, box still clear: a pause set elsewhere since then must survive the save.
    expect(paused([["pausedWas", "false"]])).toBeUndefined();
    // Deliberate toggles apply.
    expect(paused([["pausedWas", "true"]])).toBe(false);
    expect(paused([["pausedWas", "false"], ["tradingPaused", "on"]])).toBe(true);
    // Without the rendered state, never resume; pausing is always safe.
    expect(paused([["tradingPaused", "false"]])).toBeUndefined();
    expect(paused([])).toBeUndefined();
  });

  it("lets the daily loss cap exceed the max position (they are independent)", () => {
    expect(parseLimitsForm(form(withField("dailyLossCapUsd", "5000")))).toMatchObject({ ok: true, limits: { dailyLossCapUsd: 5000 } });
  });

  it("parses per-symbol caps: upper-cases products, ignores blank rows, allows a cap equal to the max position", () => {
    const result = parseLimitsForm(
      form([
        ...VALID,
        ["capProduct", " sol-usd "],
        ["capUsd", "200.45"],
        ["capProduct", ""],
        ["capUsd", "  "],
        ["capProduct", "BTC-USD"],
        ["capUsd", "1500"]
      ])
    );
    expect(result).toMatchObject({ ok: true, limits: { perSymbolMaxUsd: { "SOL-USD": 200.45, "BTC-USD": 1500 } } });
  });

  it("pairs caps by position even when the lists differ in length", () => {
    expect(errorOf([...VALID, ["capProduct", "ETH-USD"]])).toBe("The ETH-USD cap is required.");
    expect(errorOf([...VALID, ["capUsd", "100"]])).toBe(
      "A per-symbol cap has no product. Enter a product such as SOL-USD or clear the row."
    );
  });

  it.each([
    ["maxPositionUsd", "", "Max position is required."],
    ["maxPositionUsd", "abc", "Max position must be a number."],
    ["maxPositionUsd", "Infinity", "Max position must be a number."],
    ["maxPositionUsd", "0", "Max position must be greater than 0."],
    ["maxPositionUsd", "10000000.01", "Max position must be at most $10,000,000."],
    ["dailyLossCapUsd", "-5", "Daily loss cap must be greater than 0."],
    ["dailyLossCapUsd", "NaN", "Daily loss cap must be a number."],
    ["maxTradesPerDay", "1.5", "Max trades per day must be a whole number."],
    ["maxTradesPerDay", "1001", "Max trades per day must be at most 1,000."],
    ["cooldownMinutes", "0", "Cooldown minutes must be greater than 0."],
    ["cooldownMinutes", "10081", "Cooldown minutes must be at most 10,080."],
    ["lossStreakTrigger", "0", "Loss streak trigger must be greater than 0."],
    ["lossStreakTrigger", "2.5", "Loss streak trigger must be a whole number."],
    ["lossStreakTrigger", "101", "Loss streak trigger must be at most 100."],
    ["maxPositionUsd", "1500.004", "Max position can have at most two decimal places (whole cents)."],
    ["dailyLossCapUsd", "1e3", "Daily loss cap must be a plain number, such as 300 or 250.50."],
    ["maxPositionUsd", "0x10", "Max position must be a plain number, such as 300 or 250.50."],
    ["maxTradesPerDay", "1e1", "Max trades per day must be a plain number, such as 300 or 250.50."]
  ])("rejects %s = %j", (name, value, message) => {
    expect(errorOf(withField(name, value))).toBe(message);
  });

  it("reports a missing field as required", () => {
    expect(errorOf(VALID.filter(([key]) => key !== "cooldownMinutes"))).toBe("Cooldown minutes is required.");
  });

  it.each([
    [[["capProduct", "bitcoin"], ["capUsd", "10"]], '"bitcoin" is not a product such as SOL-USD.'],
    [[["capProduct", "BTC-EUR"], ["capUsd", "10"]], '"BTC-EUR" is not a product such as SOL-USD.'],
    [[["capProduct", "SOL-USD"], ["capUsd", "0"]], "The SOL-USD cap must be greater than 0."],
    [[["capProduct", "SOL-USD"], ["capUsd", "lots"]], "The SOL-USD cap must be a number."],
    [[["capProduct", "SOL-USD"], ["capUsd", "1500.01"]], "The SOL-USD cap cannot be larger than the max position."],
    [[["capProduct", "SOL-USD"], ["capUsd", "200.456"]], "The SOL-USD cap can have at most two decimal places (whole cents)."],
    [
      [["capProduct", "ETH-USD"], ["capUsd", "100"], ["capProduct", "eth-usd"], ["capUsd", "50"]],
      "ETH-USD has more than one cap. Keep one row per product."
    ]
  ] as Array<[Entries, string]>)("rejects a bad cap row %#", (rows, message) => {
    expect(errorOf([...VALID, ...rows])).toBe(message);
  });

  it("rejects more than 20 cap rows", () => {
    const rows: Entries = [];
    for (let i = 0; i < 21; i += 1) {
      rows.push(["capProduct", `C${String(i).padStart(2, "0")}-USD`], ["capUsd", "10"]);
    }
    expect(errorOf([...VALID, ...rows])).toBe("At most 20 per-symbol caps can be set.");
  });

  it("ignores non-string entries such as files", () => {
    const data = form(VALID);
    data.append("capProduct", new Blob(["x"]));
    data.append("capUsd", new Blob(["1"]));
    expect(parseLimitsForm(data)).toMatchObject({ ok: true, limits: { perSymbolMaxUsd: {} } });
  });
});
