const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const REQUEST_TTL_SECONDS = 60 * 60 * 24 * 7;

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

function accessPolicyUrl(env) {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/apps/${env.CF_APP_ID}/policies/${env.CF_POLICY_ID}`;
}

async function addEmailToAccessPolicy(env, email) {
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const policyResponse = await fetch(accessPolicyUrl(env), { headers });
  if (!policyResponse.ok) {
    throw new Error(`Cloudflare Access policy fetch failed with status ${policyResponse.status}`);
  }

  const policyPayload = await policyResponse.json();
  const policy = policyPayload.result;
  if (!policy || !Array.isArray(policy.include)) {
    throw new Error("Cloudflare Access policy response did not contain an include rule list");
  }

  const hasEmail = policy.include.some((rule) => rule.email?.email?.toLowerCase() === email.toLowerCase());
  if (hasEmail) {
    return;
  }

  const updatedPolicy = {
    name: policy.name,
    decision: policy.decision,
    include: [...policy.include, { email: { email } }],
    exclude: policy.exclude ?? [],
    require: policy.require ?? [],
  };
  const updateResponse = await fetch(accessPolicyUrl(env), {
    method: "PUT",
    headers,
    body: JSON.stringify(updatedPolicy),
  });
  if (!updateResponse.ok) {
    throw new Error(`Cloudflare Access policy update failed with status ${updateResponse.status}`);
  }
}

async function handleRequest(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
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
      html: `<p><strong>${escapeHtml(email)}</strong> から lolice cluster への参加申請がありました。</p><p><a href="${approveUrl}">承認する</a> / <a href="${rejectUrl}">却下する</a></p>`,
    });
  } catch (error) {
    await env.PENDING_REQUESTS.delete(token);
    console.error("Failed to send approval email", error);
    return jsonResponse({ error: "申請メールの送信に失敗しました。時間をおいて再度お試しください。" }, 502);
  }

  return jsonResponse({ message: "申請を受け付けました。承認後、メールでご案内します。" }, 202);
}

async function getPendingEmail(url, env) {
  const token = url.searchParams.get("token");
  if (!token) {
    return { error: htmlResponse("<h1>無効な申請リンクです。</h1>", 400) };
  }

  const request = await env.PENDING_REQUESTS.get(token, "json");
  if (!request?.email || !isValidEmail(request.email)) {
    return { error: htmlResponse("<h1>この申請リンクは無効か、有効期限が切れています。</h1>", 404) };
  }

  return { token, email: request.email };
}

async function handleApproval(url, env) {
  const pending = await getPendingEmail(url, env);
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

async function handleRejection(url, env) {
  const pending = await getPendingEmail(url, env);
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
    if (request.method === "POST" && url.pathname === "/api/request") {
      return handleRequest(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/approve") {
      return handleApproval(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/reject") {
      return handleRejection(url, env);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  },
};
