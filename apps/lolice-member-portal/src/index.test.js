import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function createKv(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    delete: vi.fn(async (key) => values.delete(key)),
    get: vi.fn(async (key, type) => {
      const value = values.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key, value) => values.set(key, value)),
  };
}

function createDatabase() {
  const emails = new Set();
  return {
    prepare: vi.fn((query) => ({
      all: async () => ({ results: [...emails].map((email) => ({ email })) }),
      bind: (...values) => ({
        run: async () => {
          if (query.startsWith("INSERT")) emails.add(values[0]);
        },
      }),
      run: async () => {},
    })),
  };
}

function createEnv(pendingRequests = {}) {
  return {
    ADMIN_EMAIL: "admin@example.com",
    APPROVED_EMAILS_DB: createDatabase(),
    CF_ACCOUNT_ID: "account-id",
    CF_API_TOKEN: "cf-token",
    CF_APP_ID: "app-id",
    CF_POLICY_ID: "policy-id",
    PENDING_REQUESTS: createKv(pendingRequests),
    PORTAL_BASE_URL: "https://lolice.b0xp.io",
    RESEND_API_KEY: "resend-key",
  };
}

function policyResponse(emails = []) {
  return new Response(JSON.stringify({
    result: {
      decision: "allow",
      exclude: [],
      include: emails.map((email) => ({ email: { email } })),
      name: "lolice members",
      require: [],
    },
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("lolice member portal Worker", () => {
  it("accepts a request with a valid email address", async () => {
    const env = createEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/request", {
      body: JSON.stringify({ email: " Member@Example.com " }),
      headers: { "CF-Connecting-IP": "192.0.2.1", "Content-Type": "application/json" },
      method: "POST",
    }), env);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: "申請を受け付けました。承認後、メールでご案内します。" });
    expect(env.PENDING_REQUESTS.put).toHaveBeenCalledTimes(2);
    const [, requestValue] = env.PENDING_REQUESTS.put.mock.calls[1];
    expect(JSON.parse(requestValue)).toEqual({ email: "member@example.com" });
  });

  it("shows the approval confirmation for a valid GET approval link", async () => {
    const env = createEnv({ token: JSON.stringify({ email: "member@example.com" }) });

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/approve?token=token"), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("member@example.com");
  });

  it("approves a request after the confirmation form is submitted", async () => {
    const env = createEnv({ token: JSON.stringify({ email: "member@example.com" }) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(policyResponse(["member@example.com"]))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/approve", {
      body: "token=token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), env);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://lolice.b0xp.io/guide.html");
    expect(env.PENDING_REQUESTS.delete).toHaveBeenCalledWith("token");
  });

  it("keeps the token when the Access policy update fails", async () => {
    const env = createEnv({ token: JSON.stringify({ email: "member@example.com" }) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/approve", {
      body: "token=token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), env);

    expect(response.status).toBe(502);
    expect(env.PENDING_REQUESTS.delete).not.toHaveBeenCalled();
    expect(await env.PENDING_REQUESTS.get("token", "json")).toEqual({ email: "member@example.com" });
  });

  it("completes access approval when the notification email fails", async () => {
    const env = createEnv({ token: JSON.stringify({ email: "member@example.com" }) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(policyResponse(["member@example.com"]))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/approve", {
      body: "token=token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Cloudflare Access ポリシーへの追加は");
    expect(env.PENDING_REQUESTS.delete).toHaveBeenCalledWith("token");
    expect(await env.PENDING_REQUESTS.get("token", "json")).toBeNull();
  });

  it("rejects a pending request", async () => {
    const env = createEnv({ token: JSON.stringify({ email: "member@example.com" }) });

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/api/reject", {
      body: "token=token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("参加申請を却下しました");
    expect(env.PENDING_REQUESTS.delete).toHaveBeenCalledWith("token");
  });

  it("serves guide.html with all game server addresses", async () => {
    const env = createEnv();

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/guide.html"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("192.168.10.97:8211");
    expect(body).toContain("192.168.10.108:8211");
    expect(body).toContain("192.168.10.29:7777");
    expect(body).toContain("192.168.10.30:25565");
    expect(body).toContain("PalWorld");
    expect(body).toContain("ARK");
    expect(body).toContain("Minecraft");
  });

  it("Worker GET /guide.html matches public/guide.html exactly", async () => {
    const env = createEnv();
    const publicGuideHtml = readFileSync(join(__dirname, "../public/guide.html"), "utf-8");

    const response = await worker.fetch(new Request("https://lolice.b0xp.io/guide.html"), env);
    const workerGuideHtml = await response.text();

    expect(workerGuideHtml).toBe(publicGuideHtml);
  });
});
