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

// KV-based approximate rate limiting using PENDING_REQUESTS namespace.
// get→put is non-atomic; for this low-traffic personal server the race window
// is negligible, and the purpose (admin notification spam prevention) is met.
async function isRateLimited(env, ip) {
  if (!ip) return false;
  const key = `rate:${ip}`;
  const count = parseInt((await env.PENDING_REQUESTS.get(key)) ?? "0", 10);
  if (count >= RATE_LIMIT_MAX) return true;
  await env.PENDING_REQUESTS.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return false;
}

// Adds an email to the Cloudflare Access policy using APPROVED_EMAILS KV as
// the durable source of truth.
//
// Safety model for concurrent approvals (which will not occur in practice for
// a single-admin personal server):
//  1. The email is written to APPROVED_EMAILS KV before any API call. This
//     makes the approval durable regardless of what happens to the policy PUT.
//  2. All KV-persisted approved emails are fetched and merged into the policy
//     in every PUT, so concurrent requests that overwrite each other converge
//     to a correct state on the next approval cycle.
//  3. A verification step after PUT confirms the email appears in the policy;
//     if it is absent (e.g. overwritten by a concurrent PUT), the function
//     retries up to MAX_POLICY_RETRIES times with a fresh GET so both emails
//     end up in the final policy.
const MAX_POLICY_RETRIES = 3;

async function addEmailToAccessPolicy(env, email) {
  const normalizedEmail = email.trim().toLowerCase();

  // Step 1: persist email to KV before touching the policy.
  await env.APPROVED_EMAILS.put(`email:${normalizedEmail}`, "1");

  const cfHeaders = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/apps/${env.CF_APP_ID}/policies/${env.CF_POLICY_ID}`;

  for (let attempt = 0; attempt < MAX_POLICY_RETRIES; attempt++) {
    // Step 2: load ALL approved emails from KV (includes concurrent additions).
    const kvList = await env.APPROVED_EMAILS.list({ prefix: "email:" });
    const kvEmails = kvList.keys.map((k) => k.name.slice("email:".length));

    // Step 3: GET current policy.
    const getResponse = await fetch(apiUrl, { headers: cfHeaders });
    if (!getResponse.ok) {
      throw new Error(`Cloudflare API GET failed: ${getResponse.status}`);
    }
    const { result: policy } = await getResponse.json();
    if (!policy || !Array.isArray(policy.include)) {
      throw new Error("Invalid policy response from Cloudflare API");
    }

    // Step 4: merge existing non-email rules + deduplicated email list.
    const existingEmails = policy.include
      .filter((r) => r.email?.email)
      .map((r) => r.email.email.toLowerCase());
    const nonEmailRules = policy.include.filter((r) => !r.email?.email);
    const allEmails = [...new Set([...existingEmails, ...kvEmails])];

    const updated = {
      name: policy.name,
      decision: policy.decision,
      include: [
        ...nonEmailRules,
        ...allEmails.map((e) => ({ email: { email: e } })),
      ],
      exclude: policy.exclude ?? [],
      require: policy.require ?? [],
    };

    // Step 5: PUT the merged policy.
    const putResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: cfHeaders,
      body: JSON.stringify(updated),
    });
    if (!putResponse.ok) {
      throw new Error(`Cloudflare API PUT failed: ${putResponse.status}`);
    }

    // Step 6: verify the email appears in the policy returned by PUT.
    const { result: verifiedPolicy } = await putResponse.json();
    const included = Array.isArray(verifiedPolicy?.include) &&
      verifiedPolicy.include.some(
        (r) => r.email?.email?.toLowerCase() === normalizedEmail
      );
    if (included) return;
    // Email absent — another concurrent PUT overwrote ours. Retry with fresh GET.
  }

  throw new Error("Failed to confirm email in Access policy after retries");
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
    await addEmailToAccessPolicy(env, pending.email);

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
