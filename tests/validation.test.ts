import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, profileUpdateSchema, resetSchema } from "@/lib/validation";

describe("loginSchema", () => {
  it("accepts valid credentials shape", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "pw123456" });
    expect(r.success).toBe(true);
  });
  it("rejects invalid email", () => {
    const r = loginSchema.safeParse({ email: "nope", password: "pw" });
    expect(r.success).toBe(false);
  });
  it("rejects empty password", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "" });
    expect(r.success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    ign: "John123",
    email: "john@example.com",
    discord: "johnny",
    password: "abcd1234",
    confirmPassword: "abcd1234",
  };

  it("accepts a valid registration", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects short IGN", () => {
    const r = registerSchema.safeParse({ ...valid, ign: "J" });
    expect(r.success).toBe(false);
  });

  it("rejects IGN with special characters", () => {
    const r = registerSchema.safeParse({ ...valid, ign: "bad<>name!" });
    expect(r.success).toBe(false);
  });

  it("rejects weak password", () => {
    const r = registerSchema.safeParse({ ...valid, password: "abcdefgh", confirmPassword: "abcdefgh" });
    expect(r.success).toBe(false);
  });

  it("rejects mismatched confirmation", () => {
    const r = registerSchema.safeParse({ ...valid, confirmPassword: "different" });
    expect(r.success).toBe(false);
  });
});

describe("profileUpdateSchema", () => {
  it("accepts valid IGN", () => {
    expect(profileUpdateSchema.safeParse({ ign: "Newbie_2", discord: "" }).success).toBe(true);
  });
  it("rejects empty IGN", () => {
    expect(profileUpdateSchema.safeParse({ ign: "", discord: "" }).success).toBe(false);
  });
});

describe("resetSchema", () => {
  it("requires matching passwords", () => {
    const ok = resetSchema.safeParse({ password: "abcd1234", confirmPassword: "abcd1234" });
    const bad = resetSchema.safeParse({ password: "abcd1234", confirmPassword: "nope" });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});
