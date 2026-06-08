const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;
const MAX_LIBRARY_ENTRIES = 10000;

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error(error);
      const status = error instanceof HttpError ? error.status : 500;
      return jsonResponse(request, env, {
        error: error instanceof HttpError ? error.message : "服务器暂时不可用"
      }, status);
    }
  }
};

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return jsonResponse(request, env, {
      ok: true,
      wechatConfigured: Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && env.JWT_SECRET)
    });
  }

  if (url.pathname === "/auth/wechat/start" && request.method === "GET") {
    return startWechatLogin(request, env);
  }

  if (url.pathname === "/auth/wechat/callback" && request.method === "GET") {
    return finishWechatLogin(request, env);
  }

  if (url.pathname === "/me" && request.method === "GET") {
    const session = await requireSession(request, env);
    const user = await env.DB.prepare(
      "SELECT id, nickname, avatar_url FROM users WHERE id = ?"
    ).bind(session.sub).first();
    if (!user) return jsonResponse(request, env, { error: "用户不存在" }, 401);
    return jsonResponse(request, env, {
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url
      }
    });
  }

  if (url.pathname === "/library" && request.method === "GET") {
    const session = await requireSession(request, env);
    const library = await env.DB.prepare(
      "SELECT payload, updated_at FROM libraries WHERE user_id = ?"
    ).bind(session.sub).first();
    return jsonResponse(request, env, {
      entries: library ? JSON.parse(library.payload) : [],
      updatedAt: library?.updated_at || null
    });
  }

  if (url.pathname === "/library" && request.method === "PUT") {
    const session = await requireSession(request, env);
    const body = await request.json();
    if (!Array.isArray(body.entries) || body.entries.length > MAX_LIBRARY_ENTRIES) {
      return jsonResponse(request, env, { error: "词库数据格式不正确或数量过多" }, 400);
    }

    const payload = JSON.stringify(body.entries);
    if (new TextEncoder().encode(payload).length > 5 * 1024 * 1024) {
      return jsonResponse(request, env, { error: "词库数据超过 5 MB 限制" }, 413);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO libraries (user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).bind(session.sub, payload, now).run();

    return jsonResponse(request, env, { ok: true, count: body.entries.length, updatedAt: now });
  }

  return jsonResponse(request, env, { error: "接口不存在" }, 404);
}

async function startWechatLogin(request, env) {
  ensureWechatConfiguration(env);
  const url = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to"), env);
  const state = randomToken(24);
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_LIFETIME_SECONDS;

  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?")
    .bind(Math.floor(Date.now() / 1000))
    .run();
  await env.DB.prepare(
    "INSERT INTO oauth_states (state, return_to, expires_at) VALUES (?, ?, ?)"
  ).bind(state, returnTo, expiresAt).run();

  const callbackUrl = `${url.origin}/auth/wechat/callback`;
  const authorizeUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
  authorizeUrl.searchParams.set("appid", env.WECHAT_APP_ID);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "snsapi_login");
  authorizeUrl.searchParams.set("state", state);

  return Response.redirect(`${authorizeUrl.toString()}#wechat_redirect`, 302);
}

async function finishWechatLogin(request, env) {
  ensureWechatConfiguration(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("缺少微信授权参数", { status: 400 });

  const stateRow = await env.DB.prepare(
    "SELECT return_to, expires_at FROM oauth_states WHERE state = ?"
  ).bind(state).first();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!stateRow || stateRow.expires_at < Math.floor(Date.now() / 1000)) {
    return new Response("登录二维码已过期，请返回重新扫码", { status: 400 });
  }

  try {
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.searchParams.set("appid", env.WECHAT_APP_ID);
    tokenUrl.searchParams.set("secret", env.WECHAT_APP_SECRET);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    const tokenPayload = await fetchWechatJson(tokenUrl);

    const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    profileUrl.searchParams.set("access_token", tokenPayload.access_token);
    profileUrl.searchParams.set("openid", tokenPayload.openid);
    profileUrl.searchParams.set("lang", "zh_CN");
    const profile = await fetchWechatJson(profileUrl);

    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO users (openid, unionid, nickname, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(openid) DO UPDATE SET
        unionid = excluded.unionid,
        nickname = excluded.nickname,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at
    `).bind(
      profile.openid,
      profile.unionid || null,
      profile.nickname || "微信用户",
      profile.headimgurl || "",
      now,
      now
    ).run();

    const user = await env.DB.prepare("SELECT id FROM users WHERE openid = ?")
      .bind(profile.openid)
      .first();
    const token = await createJwt({ sub: user.id }, env.JWT_SECRET);
    return redirectToFrontend(stateRow.return_to, { wechat_token: token });
  } catch (error) {
    console.error(error);
    return redirectToFrontend(stateRow.return_to, {
      wechat_error: error.message || "微信授权失败"
    });
  }
}

async function fetchWechatJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    throw new Error(payload.errmsg || "微信接口请求失败");
  }
  return payload;
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "请先登录");
  }
  try {
    return await verifyJwt(authorization.slice(7), env.JWT_SECRET);
  } catch {
    throw new HttpError(401, "登录已过期");
  }
}

async function createJwt(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS
  }));
  const signature = await signHmac(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

async function verifyJwt(token, secret) {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) throw new Error("Invalid token");
  const expected = await signHmac(`${header}.${body}`, secret);
  if (!timingSafeEqual(signature, expected)) throw new Error("Invalid signature");
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Expired token");
  }
  return payload;
}

async function signHmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64UrlEncode(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(Array.from(atob(padded))
    .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join(""));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function validateReturnTo(value, env) {
  const defaultUrl = `${env.FRONTEND_ORIGIN}${env.FRONTEND_PATH || "/"}`;
  if (!value) return defaultUrl;
  const parsed = new URL(value);
  if (parsed.origin !== env.FRONTEND_ORIGIN || !parsed.pathname.startsWith(env.FRONTEND_PATH || "/")) {
    throw new HttpError(400, "登录返回地址不受信任");
  }
  return `${parsed.origin}${parsed.pathname}`;
}

function redirectToFrontend(returnTo, parameters) {
  const hash = new URLSearchParams(parameters).toString();
  return Response.redirect(`${returnTo}#${hash}`, 302);
}

function ensureWechatConfiguration(env) {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET || !env.JWT_SECRET) {
    throw new HttpError(503, "微信登录尚未配置");
  }
}

function randomToken(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin === env.FRONTEND_ORIGIN ? origin : env.FRONTEND_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Vary": "Origin"
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
