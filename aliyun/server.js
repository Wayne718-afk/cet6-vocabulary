const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;
const MAX_LIBRARY_ENTRIES = 10000;
const MAX_LIBRARY_BYTES = 5 * 1024 * 1024;

const config = {
  port: Number(process.env.PORT) || 8787,
  publicOrigin: String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, ""),
  frontendPath: normalizeFrontendPath(process.env.FRONTEND_PATH || "/"),
  wechatAppId: process.env.WECHAT_APP_ID || "",
  wechatAppSecret: process.env.WECHAT_APP_SECRET || "",
  jwtSecret: process.env.JWT_SECRET || "",
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, "data", "shici.db")
};

validateConfiguration(config);
fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const database = new DatabaseSync(config.databasePath);
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");
database.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

const statements = {
  deleteExpiredStates: database.prepare("DELETE FROM oauth_states WHERE expires_at < ?"),
  insertState: database.prepare(
    "INSERT INTO oauth_states (state, return_to, expires_at) VALUES (?, ?, ?)"
  ),
  getState: database.prepare(
    "SELECT return_to, expires_at FROM oauth_states WHERE state = ?"
  ),
  deleteState: database.prepare("DELETE FROM oauth_states WHERE state = ?"),
  upsertUser: database.prepare(`
    INSERT INTO users (openid, unionid, nickname, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(openid) DO UPDATE SET
      unionid = excluded.unionid,
      nickname = excluded.nickname,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `),
  getUserByOpenId: database.prepare("SELECT id FROM users WHERE openid = ?"),
  getUserById: database.prepare(
    "SELECT id, nickname, avatar_url FROM users WHERE id = ?"
  ),
  getLibrary: database.prepare(
    "SELECT payload, updated_at FROM libraries WHERE user_id = ?"
  ),
  upsertLibrary: database.prepare(`
    INSERT INTO libraries (user_id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `)
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/health", (request, response) => {
  response.json({
    ok: true,
    wechatConfigured: Boolean(
      config.wechatAppId && config.wechatAppSecret && config.jwtSecret
    )
  });
});

app.get("/auth/wechat/start", (request, response, next) => {
  try {
    const returnTo = validateReturnTo(request.query.return_to);
    const state = randomToken(24);
    const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_LIFETIME_SECONDS;
    statements.deleteExpiredStates.run(Math.floor(Date.now() / 1000));
    statements.insertState.run(state, returnTo, expiresAt);

    const callbackUrl = `${config.publicOrigin}/api/auth/wechat/callback`;
    const authorizeUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
    authorizeUrl.searchParams.set("appid", config.wechatAppId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "snsapi_login");
    authorizeUrl.searchParams.set("state", state);
    response.redirect(`${authorizeUrl.toString()}#wechat_redirect`);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/wechat/callback", async (request, response) => {
  const code = request.query.code;
  const state = request.query.state;
  if (!code || !state) {
    response.status(400).send("缺少微信授权参数");
    return;
  }

  const stateRow = statements.getState.get(state);
  statements.deleteState.run(state);
  if (!stateRow || stateRow.expires_at < Math.floor(Date.now() / 1000)) {
    response.status(400).send("登录二维码已过期，请返回重新扫码");
    return;
  }

  try {
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.searchParams.set("appid", config.wechatAppId);
    tokenUrl.searchParams.set("secret", config.wechatAppSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    const tokenPayload = await fetchWechatJson(tokenUrl);

    const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    profileUrl.searchParams.set("access_token", tokenPayload.access_token);
    profileUrl.searchParams.set("openid", tokenPayload.openid);
    profileUrl.searchParams.set("lang", "zh_CN");
    const profile = await fetchWechatJson(profileUrl);

    const now = new Date().toISOString();
    statements.upsertUser.run(
      profile.openid,
      profile.unionid || null,
      profile.nickname || "微信用户",
      profile.headimgurl || "",
      now,
      now
    );
    const user = statements.getUserByOpenId.get(profile.openid);
    const token = createJwt({ sub: user.id }, config.jwtSecret);
    response.redirect(redirectToFrontend(stateRow.return_to, { wechat_token: token }));
  } catch (error) {
    console.error(error);
    response.redirect(redirectToFrontend(stateRow.return_to, {
      wechat_error: error.message || "微信授权失败"
    }));
  }
});

app.get("/me", requireSession, (request, response) => {
  const user = statements.getUserById.get(request.session.sub);
  if (!user) {
    response.status(401).json({ error: "用户不存在" });
    return;
  }
  response.json({
    user: {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatar_url
    }
  });
});

app.get("/library", requireSession, (request, response) => {
  const library = statements.getLibrary.get(request.session.sub);
  response.json({
    entries: library ? JSON.parse(library.payload) : [],
    updatedAt: library?.updated_at || null
  });
});

app.put("/library", requireSession, (request, response) => {
  if (!Array.isArray(request.body.entries)
      || request.body.entries.length > MAX_LIBRARY_ENTRIES) {
    response.status(400).json({ error: "词库数据格式不正确或数量过多" });
    return;
  }

  const payload = JSON.stringify(request.body.entries);
  if (Buffer.byteLength(payload, "utf8") > MAX_LIBRARY_BYTES) {
    response.status(413).json({ error: "词库数据超过 5 MB 限制" });
    return;
  }

  const now = new Date().toISOString();
  statements.upsertLibrary.run(request.session.sub, payload, now);
  response.json({ ok: true, count: request.body.entries.length, updatedAt: now });
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(error.status || 500).json({
    error: error.status ? error.message : "服务器暂时不可用"
  });
});

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`Shici API listening on http://127.0.0.1:${config.port}`);
});

function requireSession(request, response, next) {
  const authorization = request.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    response.status(401).json({ error: "请先登录" });
    return;
  }
  try {
    request.session = verifyJwt(authorization.slice(7), config.jwtSecret);
    next();
  } catch {
    response.status(401).json({ error: "登录已过期" });
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

function createJwt(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS
  }));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token, secret) {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) throw new Error("Invalid token");
  const expected = sign(`${header}.${body}`, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Expired token");
  }
  return payload;
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function randomToken(byteLength) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function validateReturnTo(value) {
  const fallback = `${config.publicOrigin}${config.frontendPath}`;
  if (!value) return fallback;
  const parsed = new URL(value);
  if (parsed.origin !== config.publicOrigin
      || !parsed.pathname.startsWith(config.frontendPath)) {
    const error = new Error("登录返回地址不受信任");
    error.status = 400;
    throw error;
  }
  return `${parsed.origin}${parsed.pathname}`;
}

function redirectToFrontend(returnTo, parameters) {
  return `${returnTo}#${new URLSearchParams(parameters).toString()}`;
}

function normalizeFrontendPath(value) {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function validateConfiguration(values) {
  const missing = Object.entries({
    PUBLIC_ORIGIN: values.publicOrigin,
    WECHAT_APP_ID: values.wechatAppId,
    WECHAT_APP_SECRET: values.wechatAppSecret,
    JWT_SECRET: values.jwtSecret
  }).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!values.publicOrigin.startsWith("https://")) {
    throw new Error("PUBLIC_ORIGIN must use HTTPS");
  }
  if (values.jwtSecret.length < 48) {
    throw new Error("JWT_SECRET must contain at least 48 characters");
  }
}

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
