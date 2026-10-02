import { describe, it, expect, vi } from "vitest";
import { parseGoogleSecret, readConnectionSecret, saveConnectionSecretAsService } from "./vault";

describe("parseGoogleSecret", () => {
  it("reads the refresh token, and the cached access token when there is one", () => {
    expect(parseGoogleSecret('{"refresh_token":"r","access_token":"a","access_token_expires_at":"2026-10-02T12:00:00Z"}')).toEqual({
      refresh_token: "r",
      access_token: "a",
      access_token_expires_at: "2026-10-02T12:00:00Z",
    });
    expect(parseGoogleSecret('{"refresh_token":"r","access_token":null,"access_token_expires_at":null}')).toEqual({
      refresh_token: "r",
      access_token: null,
      access_token_expires_at: null,
    });
  });

  it("is null for no connection, no refresh token, or not JSON", () => {
    expect(parseGoogleSecret(null)).toBeNull();
    expect(parseGoogleSecret('{"access_token":"a"}')).toBeNull();
    expect(parseGoogleSecret("not json")).toBeNull();
  });
});

describe("the vault calls", () => {
  it("reads through connection_secret, and says which connector failed without the secret", async () => {
    const rpc = vi.fn(async () => ({ data: "the-secret", error: null }));
    expect(await readConnectionSecret({ rpc } as never, "co1", "google")).toBe("the-secret");
    expect(rpc).toHaveBeenCalledWith("connection_secret", { p_company_id: "co1", p_connector: "google" });
    const failing = vi.fn(async () => ({ data: null, error: { message: "permission denied" } }));
    await expect(readConnectionSecret({ rpc: failing } as never, "co1", "google")).rejects.toThrow(
      "Couldn't read the google connection: permission denied"
    );
  });

  it("saves through connection_put_service and throws the database's reason", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "a connection needs a secret" } }));
    await expect(
      saveConnectionSecretAsService({ rpc } as never, {
        companyId: "co1",
        connector: "google",
        secret: "",
        hint: null,
        accountLabel: "ops@example.com",
        scopes: [],
        actorProfileId: null,
      })
    ).rejects.toThrow("Couldn't store the google credential: a connection needs a secret");
  });
});
