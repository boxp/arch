const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const REQUEST_TTL_SECONDS = 60 * 60 * 24 * 7;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

const INDEX_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>lolice cluster - メンバー参加申請</title>
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { align-items: center; background: #111827; color: #f9fafb; display: flex; justify-content: center; margin: 0; min-height: 100vh; padding: 1.5rem; }
      main { background: #1f2937; border-radius: 16px; box-shadow: 0 20px 45px #0006; max-width: 480px; padding: 2rem; width: 100%; }
      h1 { font-size: 1.5rem; margin-top: 0; } p { color: #d1d5db; line-height: 1.7; }
      label { display: block; font-weight: 600; margin: 1.5rem 0 .5rem; }
      input, button { border-radius: 8px; box-sizing: border-box; font: inherit; padding: .8rem; width: 100%; }
      input { border: 1px solid #6b7280; } button { background: #2563eb; border: 0; color: white; cursor: pointer; font-weight: 700; margin-top: 1rem; }
      button:disabled { cursor: wait; opacity: .65; } #message { min-height: 1.5rem; margin-bottom: 0; } .success { color: #86efac; } .error { color: #fca5a5; }
    </style>
  </head>
  <body>
    <main>
      <h1>lolice cluster - メンバー参加申請</h1>
      <p>PalWorld ゲームサーバーへの参加を希望する方は、メールアドレスを入力してください。承認後に参加手順をお送りします。</p>
      <form id="request-form">
        <label for="email">メールアドレス</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <button type="submit">参加を申請する</button>
      </form>
      <p id="message" aria-live="polite"></p>
    </main>
    <script>
      const form = document.getElementById("request-form");
      const message = document.getElementById("message");
      const button = form.querySelector("button");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        message.className = "";
        message.textContent = "申請を送信しています…";
        try {
          const response = await fetch("/api/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email.value }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "申請に失敗しました。");
          message.className = "success";
          message.textContent = result.message;
          form.reset();
        } catch (error) {
          message.className = "error";
          message.textContent = error.message || "申請に失敗しました。時間をおいて再度お試しください。";
        } finally { button.disabled = false; }
      });
    </script>
  </body>
</html>`;

const GUIDE_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>lolice cluster - 参加手順</title>
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { background: #111827; color: #f9fafb; line-height: 1.75; margin: 0; padding: 1.5rem; }
      main { background: #1f2937; border-radius: 16px; box-shadow: 0 20px 45px #0006; margin: 2rem auto; max-width: 720px; padding: 2rem; }
      h1 { font-size: 1.7rem; } li { margin: 1rem 0; } a { color: #93c5fd; } code { background: #374151; border-radius: 4px; padding: .15rem .35rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>lolice cluster - 参加手順</h1>
      <p>参加承認後は、Cloudflare WARP を接続してから PalWorld の専用サーバーにアクセスしてください。</p>
      <ol>
        <li><strong>Cloudflare One Client をダウンロードします。</strong><br />Windows と Mac は <a href="https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/">Cloudflare One Client のダウンロードページ</a> を参照してください。iOS / Android は App Store または Google Play から Cloudflare One Client を入手してください。</li>
        <li>インストールが完了したら、Cloudflare One Client を起動します。</li>
        <li>チーム名に <code>boxp</code> と入力し、<strong>OK</strong> を押します。</li>
        <li>承認されたメールアドレスを入力し、届いた OTP（ワンタイムパスワード）で認証します。</li>
        <li>Cloudflare One Client の <strong>WARP 接続</strong>ボタンを押して接続します。</li>
        <li>PalWorld を起動し、<strong>マルチプレイ</strong> → <strong>専用サーバー</strong> を選びます。サーバーアドレスに <code>192.168.10.97:8211</code> を入力して参加してください。</li>
      </ol>
    </main>
  </body>
</html>`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendEmail(env, { to, subject, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "noreply@b0xp.io", to, subject, html }),
  });

  if (!response.ok) {
    throw new Error(`Resend API request failed with status ${response.status}`);
  }
}

// Durable Object that serializes all Cloudflare Access Policy updates.
// Because a single DO instance processes requests one at a time (JavaScript
// single-threaded event loop), concurrent approvals are automatically queued
// and each GET→PUT sees the result of the previous write.
export class PolicyUpdateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      await this._updatePolicy(email);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  async _updatePolicy(normalizedEmail) {
    const headers = {
      Authorization: `Bearer ${this.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    };
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/access/apps/${this.env.CF_APP_ID}/policies/${this.env.CF_POLICY_ID}`;

    const policyResponse = await fetch(url, { headers });
    if (!policyResponse.ok) {
      throw new Error(`Cloudflare Access policy fetch failed: ${policyResponse.status}`);
    }

    const { result: policy } = await policyResponse.json();
    if (!policy || !Array.isArray(policy.include)) {
      throw new Error("Cloudflare Access policy response did not contain an include rule list");
    }

    if (policy.include.some((r) => r.email?.email?.toLowerCase() === normalizedEmail)) {
      return;
    }

    const updated = {
      name: policy.name,
      decision: policy.decision,
      include: [...policy.include, { email: { email: normalizedEmail } }],
      exclude: policy.exclude ?? [],
      require: policy.require ?? [],
    };

    const putResponse = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(updated),
    });

    if (!putResponse.ok) {
      throw new Error(`Cloudflare Access policy update failed: ${putResponse.status}`);
    }
  }
}

// Max RATE_LIMIT_MAX requests per IP per hour to prevent admin email spam.
async function isRateLimited(env, ip) {
  if (!ip) return false;
  const key = `rate:${ip}`;
  const current = await env.PENDING_REQUESTS.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return true;
  await env.PENDING_REQUESTS.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return false;
}

async function handleRequest(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (await isRateLimited(env, ip)) {
    return jsonResponse({ error: "リクエストが多すぎます。しばらく待ってから再試行してください。" }, 429);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が正しくありません。" }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ error: "リクエスト形式が正しくありません。" }, 400);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return jsonResponse({ error: "有効なメールアドレスを入力してください。" }, 400);
  }

  const token = crypto.randomUUID();
  await env.PENDING_REQUESTS.put(token, JSON.stringify({ email }), {
    expirationTtl: REQUEST_TTL_SECONDS,
  });

  try {
    const approveUrl = `${env.PORTAL_BASE_URL}/api/approve?token=${encodeURIComponent(token)}`;
    const rejectUrl = `${env.PORTAL_BASE_URL}/api/reject?token=${encodeURIComponent(token)}`;
    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: `[lolice] 参加申請: ${email}`,
      html: `<p><strong>${escapeHtml(email)}</strong> から lolice cluster への参加申請がありました。</p><p><a href="${approveUrl}">承認確認画面へ</a> / <a href="${rejectUrl}">却下確認画面へ</a></p>`,
    });
  } catch (error) {
    await env.PENDING_REQUESTS.delete(token);
    console.error("Failed to send approval email", error);
    return jsonResponse({ error: "申請メールの送信に失敗しました。時間をおいて再度お試しください。" }, 502);
  }

  return jsonResponse({ message: "申請を受け付けました。承認後、メールでご案内します。" }, 202);
}

async function getPendingEmail(token, env) {
  if (!token) {
    return { error: htmlResponse("<h1>無効な申請リンクです。</h1>", 400) };
  }

  const pendingRequest = await env.PENDING_REQUESTS.get(token, "json");
  if (!pendingRequest?.email || !isValidEmail(pendingRequest.email)) {
    return { error: htmlResponse("<h1>この申請リンクは無効か、有効期限が切れています。</h1>", 404) };
  }

  return { token, email: pendingRequest.email };
}

async function handleApproveConfirmation(url, env) {
  const token = url.searchParams.get("token");
  const pending = await getPendingEmail(token, env);
  if (pending.error) return pending.error;

  const safeEmail = escapeHtml(pending.email);
  const safeToken = encodeURIComponent(token);
  return htmlResponse(`<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>参加申請の承認確認</title></head>
<body>
<h1>参加申請の承認確認</h1>
<p><strong>${safeEmail}</strong> からの lolice cluster 参加申請を承認しますか？</p>
<form method="POST" action="/api/approve">
  <input type="hidden" name="token" value="${safeToken}">
  <button type="submit">承認する</button>
</form>
</body>
</html>`);
}

async function handleApproval(request, env) {
  let token;
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await request.text();
    token = new URLSearchParams(body).get("token");
  } else {
    try {
      const body = await request.json();
      token = body?.token ?? null;
    } catch {
      return htmlResponse("<h1>リクエスト形式が正しくありません。</h1>", 400);
    }
  }

  const pending = await getPendingEmail(token, env);
  if (pending.error) return pending.error;

  try {
    // Route the policy update through the singleton Durable Object so that
    // concurrent approvals are serialized and no email addition is lost.
    const doId = env.POLICY_UPDATE_DO.idFromName("singleton");
    const doStub = env.POLICY_UPDATE_DO.get(doId);
    const doResponse = await doStub.fetch(
      new Request("https://do/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pending.email }),
      })
    );
    if (!doResponse.ok) {
      const { error } = await doResponse.json();
      throw new Error(error ?? "policy update failed");
    }

    await sendEmail(env, {
      to: pending.email,
      subject: "[lolice] 参加が承認されました",
      html: `<p>lolice cluster への参加が承認されました。</p><p><a href="${env.PORTAL_BASE_URL}/guide.html">参加手順ページ</a>をご確認ください。</p>`,
    });
    await env.PENDING_REQUESTS.delete(pending.token);
  } catch (error) {
    console.error("Failed to approve membership request", error);
    return htmlResponse("<h1>承認処理に失敗しました。</h1><p>時間をおいて同じリンクを再度開いてください。</p>", 502);
  }

  return new Response(null, {
    status: 302,
    headers: { ...CORS_HEADERS, Location: `${env.PORTAL_BASE_URL}/guide.html` },
  });
}

async function handleRejectConfirmation(url, env) {
  const token = url.searchParams.get("token");
  const pending = await getPendingEmail(token, env);
  if (pending.error) return pending.error;

  const safeEmail = escapeHtml(pending.email);
  const safeToken = encodeURIComponent(token);
  return htmlResponse(`<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>参加申請の却下確認</title></head>
<body>
<h1>参加申請の却下確認</h1>
<p><strong>${safeEmail}</strong> からの lolice cluster 参加申請を却下しますか？</p>
<form method="POST" action="/api/reject">
  <input type="hidden" name="token" value="${safeToken}">
  <button type="submit">却下する</button>
</form>
</body>
</html>`);
}

async function handleRejection(request, env) {
  let token;
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await request.text();
    token = new URLSearchParams(body).get("token");
  } else {
    try {
      const body = await request.json();
      token = body?.token ?? null;
    } catch {
      return htmlResponse("<h1>リクエスト形式が正しくありません。</h1>", 400);
    }
  }

  const pending = await getPendingEmail(token, env);
  if (pending.error) return pending.error;

  await env.PENDING_REQUESTS.delete(pending.token);
  return htmlResponse("<h1>参加申請を却下しました。</h1><p>この申請は削除されました。</p>");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return htmlResponse(INDEX_HTML);
    }
    if (request.method === "GET" && url.pathname === "/guide.html") {
      return htmlResponse(GUIDE_HTML);
    }

    if (request.method === "POST" && url.pathname === "/api/request") {
      return handleRequest(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/approve") {
      return handleApproveConfirmation(url, env);
    }
    if (request.method === "POST" && url.pathname === "/api/approve") {
      return handleApproval(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/reject") {
      return handleRejectConfirmation(url, env);
    }
    if (request.method === "POST" && url.pathname === "/api/reject") {
      return handleRejection(request, env);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  },
};
