import {
  ConnectionError,
  RateLimitedError,
  ServerError,
  ValidationError,
} from "@protontech/drive-sdk";
import { describe, expect, it } from "vitest";
import { isAuthFailure, isCursorRejection, isRateLimited, isTransientOutage } from "./errors";

function serverError(statusCode: number) {
  const e = new ServerError("boom");
  (e as { statusCode?: number }).statusCode = statusCode;
  return e;
}

describe("proton error classifiers", () => {
  it("classifies RateLimitedError as rate limited only", () => {
    const e = new RateLimitedError("slow down");
    expect(isRateLimited(e)).toBe(true);
    expect(isAuthFailure(e)).toBe(false);
    expect(isCursorRejection(e)).toBe(false);
  });

  it.each([401, 403])("classifies ServerError %i as an auth failure", (status) => {
    const e = serverError(status);
    expect(isAuthFailure(e)).toBe(true);
    expect(isRateLimited(e)).toBe(false);
    expect(isCursorRejection(e)).toBe(false);
  });

  // C8: only 404 and 422 mean the event cursor was rejected.
  it.each([404, 422])("classifies ServerError %i as a cursor rejection", (status) => {
    const e = serverError(status);
    expect(isCursorRejection(e)).toBe(true);
    expect(isAuthFailure(e)).toBe(false);
  });

  it("does not treat 400 or 500 as a cursor rejection", () => {
    expect(isCursorRejection(serverError(400))).toBe(false);
    expect(isCursorRejection(serverError(500))).toBe(false);
  });

  it("treats a ValidationError as none of the three (no HTTP status)", () => {
    const e = new ValidationError("bad");
    expect(isAuthFailure(e)).toBe(false);
    expect(isRateLimited(e)).toBe(false);
    expect(isCursorRejection(e)).toBe(false);
  });

  it("treats a generic Error and non-errors as none of the three", () => {
    for (const e of [new Error("x"), "str", null, undefined]) {
      expect(isAuthFailure(e)).toBe(false);
      expect(isRateLimited(e)).toBe(false);
      expect(isCursorRejection(e)).toBe(false);
    }
  });

  it("treats offline and 5xx as a transient outage, but not 4xx, 429 or other errors", () => {
    expect(isTransientOutage(new ConnectionError("offline"))).toBe(true);
    expect(isTransientOutage(serverError(502))).toBe(true);
    expect(isTransientOutage(serverError(500))).toBe(true);
    expect(isTransientOutage(serverError(404))).toBe(false);
    expect(isTransientOutage(serverError(401))).toBe(false);
    expect(isTransientOutage(new RateLimitedError("slow"))).toBe(false);
    expect(isTransientOutage(new ServerError("no status"))).toBe(false);
    expect(isTransientOutage(new Error("x"))).toBe(false);
  });
});
