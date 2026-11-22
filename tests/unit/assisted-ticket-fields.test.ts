import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/trade/actions", () => ({ previewAssistedAction: vi.fn(), submitAssistedAction: vi.fn() }));

import { AssistedTicket } from "@/components/assisted-ticket";

function render(defaultProduct: string): string {
  return renderToStaticMarkup(
    createElement(AssistedTicket, {
      provider: "mock",
      liveSubmitEnabled: false,
      defaultProduct,
      defaultSide: "BUY",
      defaultQuote: "25.00",
      signalId: null,
      recentOrders: []
    })
  );
}

function fieldNames(html: string): string[] {
  return [...new Set([...html.matchAll(/\sname="([^"]+)"/g)].map((match) => match[1]!))].sort();
}

// The field names the preview form posts are the contract with parseAssistedForm.
describe("AssistedTicket preview form", () => {
  it("posts the product select, side, size, signal and the sell-entire-position button", () => {
    const html = render("BTC-USD");
    expect(fieldNames(html)).toEqual(["intent", "product", "quoteUsd", "side", "signalId"]);
    expect(html).toMatch(/<button(?=[^>]*name="intent")(?=[^>]*value="sell-all")[^>]*>Sell entire position</);
  });

  it("adds the custom product field when the preset product is not on the watchlist", () => {
    const html = render("AVAX-USD");
    expect(fieldNames(html)).toEqual(["customProduct", "intent", "product", "quoteUsd", "side", "signalId"]);
    expect(html).toMatch(/<option value="custom" selected="">/);
  });
});
