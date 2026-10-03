import { describe, it, expect, afterEach } from "vitest";
import { requireDatabaseUrl } from "../../src/db/connection-url.js";

const LOCAL = "postgres://chu:local@127.0.0.1:5432/chu_grades";

describe("requireDatabaseUrl", () => {
  const before = process.env.DATABASE_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  });

  it("prefers an explicit argument over the environment", () => {
    process.env.DATABASE_URL = LOCAL;
    expect(requireDatabaseUrl("postgres://explicit/db")).toBe("postgres://explicit/db");
  });

  it("falls back to the environment", () => {
    process.env.DATABASE_URL = LOCAL;
    expect(requireDatabaseUrl()).toBe(LOCAL);
  });

  it("tells you to create .env when nothing is set", () => {
    delete process.env.DATABASE_URL;
    expect(() => requireDatabaseUrl()).toThrow(/Copy \.env\.example/);
  });

  // The case this module exists for: `DATABASE_URL="$NEON_DATABASE_URL" npm run …`
  // with that variable only in .env expands to "", which is set-but-empty, and
  // an empty value hides the good URL in .env instead of falling back to it.
  it("names the shell expansion when the value is empty", () => {
    process.env.DATABASE_URL = "";
    expect(() => requireDatabaseUrl()).toThrow(/set but empty/);
    expect(() => requireDatabaseUrl()).toThrow(/set -a/);
  });

  it("does not mistake an empty explicit argument for an absent one", () => {
    delete process.env.DATABASE_URL;
    expect(() => requireDatabaseUrl("")).toThrow(/set but empty/);
  });
});
