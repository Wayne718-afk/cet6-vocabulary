# 微信登录与云词库后端

后端使用 Cloudflare Workers + D1，负责安全保存微信密钥、完成 OAuth 回调、识别用户并同步词库。

微信官方参考：

- [网站应用微信登录开发指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)
- [微信开放平台](https://open.weixin.qq.com/)

## 前置条件

1. 在微信开放平台完成开发者资质认证。
2. 创建并审核“网站应用”，开通微信登录能力。
3. 获得网站应用的 `AppID` 与 `AppSecret`。
4. 准备 Cloudflare 账号。

## 部署

```powershell
npx wrangler login
npx wrangler d1 create shici-cloud
```

把返回的数据库 ID 填入 `wrangler.toml`，然后执行：

```powershell
npx wrangler d1 execute shici-cloud --remote --file schema.sql
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

将 Worker 地址填入网页根目录的 `cloud-config.js`：

```js
window.SHICI_CLOUD_API = "https://你的-worker.workers.dev";
```

最后在微信开放平台将授权回调域设置为 Worker 的域名。回调路径为：

```text
/auth/wechat/callback
```

`AppSecret` 和 `JWT_SECRET` 只能通过 Worker Secret 配置，不能写入 GitHub 仓库或前端文件。
