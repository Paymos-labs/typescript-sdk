import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationHeader, buildQuery, stringToSign } from "../src/index.js";

describe("request signing", () => {
  it("matches the Merchant API HMAC contract", () => {
    const body = JSON.stringify({ amount: "10.00" });
    const expectedBodyHash = createHash("sha256").update(body).digest("hex");
    const value = `1700000000\nPOST\n/v1/invoices\n\n${expectedBodyHash}`;
    const signature = createHmac("sha256", "sk_test_secret").update(value).digest("base64");

    expect(stringToSign("1700000000", "post", "/v1/invoices", "", body)).toBe(value);
    expect(authorizationHeader("pk_test_key", "sk_test_secret", "1700000000", "POST", "/v1/invoices", "", body))
      .toBe(`HMAC-SHA256 pk_test_key:${signature}`);
  });

  it("sorts filters, repeats sorted status, and includes the leading question mark", () => {
    expect(buildQuery({ status: ["paid_over", "paid"], limit: 50, project_id: "prj/a" })).toBe(
      "?limit=50&project_id=prj%2Fa&status=paid&status=paid_over",
    );
  });
});
