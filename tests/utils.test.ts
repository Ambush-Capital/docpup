import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { interpolateEnvVars, authenticateWithPassword } from "../src/utils.js";

describe("interpolateEnvVars", () => {
  beforeEach(() => {
    vi.stubEnv("TEST_VAR", "hello");
    vi.stubEnv("ANOTHER_VAR", "world");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replaces ${VAR} with env value", () => {
    expect(interpolateEnvVars("${TEST_VAR}")).toBe("hello");
  });

  it("replaces multiple vars in one string", () => {
    expect(interpolateEnvVars("${TEST_VAR} ${ANOTHER_VAR}")).toBe("hello world");
  });

  it("passes through strings without interpolation patterns", () => {
    expect(interpolateEnvVars("plain-text")).toBe("plain-text");
  });

  it("throws for undefined env var", () => {
    expect(() => interpolateEnvVars("${MISSING_VAR}")).toThrow(
      'Environment variable "MISSING_VAR" is not set'
    );
  });

  it("handles mixed literal and interpolation", () => {
    expect(interpolateEnvVars("prefix-${TEST_VAR}-suffix")).toBe(
      "prefix-hello-suffix"
    );
  });
});

describe("authenticateWithPassword", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("POSTs password and returns cookies from Set-Cookie header", async () => {
    const mockHeaders = new Headers();
    // Simulate getSetCookie returning array
    const response = {
      status: 302,
      headers: {
        getSetCookie: () => [
          "session=abc123; Path=/; HttpOnly",
          "token=xyz; Path=/",
        ],
      },
    };
    mockFetch.mockResolvedValue(response);

    const result = await authenticateWithPassword(
      "https://docs.example.com",
      "secret"
    );

    expect(result).toEqual({ Cookie: "session=abc123; token=xyz" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url.toString()).toBe("https://docs.example.com/password");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("password=secret&redirect=%2F");
    expect(opts.redirect).toBe("manual");
  });

  it("throws when no cookies are returned", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      headers: {
        getSetCookie: () => [],
      },
    });

    await expect(
      authenticateWithPassword("https://docs.example.com", "wrong")
    ).rejects.toThrow("Password authentication failed");
  });
});
