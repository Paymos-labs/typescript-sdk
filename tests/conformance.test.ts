import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiErrorFromResponse, authorizationHeader, buildQuery, WebhookVerifier } from "../src/index.js";

const contract = JSON.parse(
  readFileSync(new URL("../conformance/contract.json", import.meta.url), "utf8"),
) as {
  resources: Record<string, unknown[]>;
  vectors: {
    post_signing: SigningVector & { authorization: string };
    post_empty_body_signing: SigningVector & { authorization: string };
    get_query_signing: SigningVector & { signature: string };
    webhook: { secret: string; header: string; raw_body: string; now: number; tolerance_seconds: number };
    problem_details: {
      flat: Record<string, unknown>;
      multi: Record<string, unknown> & { errors: Array<Record<string, unknown>> };
    };
  };
};

interface SigningVector {
  api_key: string;
  api_secret: string;
  timestamp: string;
  method: string;
  path: string;
  query: string;
  body: string;
}

describe("shared SDK conformance", () => {
  it("matches request signing vectors", () => {
    const post = contract.vectors.post_signing;
    expect(authorizationHeader(post.api_key, post.api_secret, post.timestamp, post.method, post.path, post.query, post.body))
      .toBe(post.authorization);

    const get = contract.vectors.get_query_signing;
    expect(authorizationHeader(get.api_key, get.api_secret, get.timestamp, get.method, get.path, get.query, get.body))
      .toBe(`HMAC-SHA256 ${get.api_key}:${get.signature}`);
    expect(buildQuery({ status: ["paid_over", "paid"], project_id: "prj/a", limit: 50 })).toBe(get.query);

    // An absent body signs an EMPTY last segment, never sha256(""). This vector is a POST, so an
    // SDK that shortcuts on the method ("only GET is empty") fails here.
    const empty = contract.vectors.post_empty_body_signing;
    expect(authorizationHeader(empty.api_key, empty.api_secret, empty.timestamp, empty.method, empty.path, empty.query, empty.body))
      .toBe(empty.authorization);
  });

  it("accepts rotated webhook signatures", () => {
    const vector = contract.vectors.webhook;
    const verifier = new WebhookVerifier(vector.secret, vector.tolerance_seconds);
    expect(verifier.verify(vector.header, vector.raw_body, vector.now)).toBe(true);
  });

  it("pins the complete operation count", () => {
    expect(Object.values(contract.resources).flat()).toHaveLength(21);
  });

  it("keeps top-level problem code authoritative", () => {
    const vector = contract.vectors.problem_details.multi;
    const error = apiErrorFromResponse(400, JSON.stringify(vector), new Headers());

    expect(error.problem).toMatchObject({
      type: "about:blank", title: "Bad Request", status: 400,
      detail: "Validation failed.", code: "validation_failed",
    });
    expect(error.code).toBe("validation_failed");
    expect(error.field).toBeNull();
    expect(error.errors[0]?.code).toBe("field_required");
  });
});
