# 阿里云大陆部署与备案方案

这一版本将网页与登录后端部署在同一个中国大陆域名下：

- `https://你的域名/`：拾词网页
- `https://你的域名/api/`：微信登录和词库同步接口
- `https://你的域名/api/auth/wechat/callback`：微信授权回调地址

## 一、购买前确认

推荐购买阿里云轻量应用服务器：

- 地域：中国内地，例如杭州、上海、深圳或北京
- 系统：Ubuntu 24.04 LTS
- 配置：2 核 2 GB 起步即可
- 计费：包年包月
- 购买时长：累计至少 3 个月，并确认控制台显示该实例可用于 ICP 备案

不要购买中国香港或海外地域，这些地域不能作为中国大陆 ICP 备案的接入资源。

同时需要一个实名认证且归备案主体所有的域名。备案主体、域名实名主体、微信开放平台认证主体应尽量保持一致。

## 二、备案顺序

1. 在阿里云购买中国内地轻量应用服务器。
2. 注册或转入一个自有域名，并完成实名认证。
3. 在阿里云 ICP 备案系统提交备案。
4. 按要求完成资料上传、人脸核验和短信核验。
5. 等待阿里云初审及管局审核。
6. 备案通过后，将备案号填写到 `site-config.js` 并展示在网站底部。
7. 网站上线后，再向微信开放平台提交网站应用审核。

微信审核时，官网应能正常访问，并展示服务详情、用户协议、隐私政策、版权所有者、备案信息和联系方式。

## 三、服务器初始化

登录服务器后安装基础软件和 Node.js 24：

```bash
sudo apt update
sudo apt install -y nginx git curl certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

将本仓库上传或克隆到服务器，然后执行：

```bash
cd /你的项目目录
sudo bash aliyun/deploy.sh example.com
```

首次执行后编辑后端环境变量：

```bash
sudo nano /opt/shici/api/.env
```

填写：

```dotenv
PORT=8787
PUBLIC_ORIGIN=https://example.com
FRONTEND_PATH=/
WECHAT_APP_ID=已审核的网站应用AppID
WECHAT_APP_SECRET=网站应用AppSecret
JWT_SECRET=至少64位随机字符串
DATABASE_PATH=/var/lib/shici/shici.db
```

生成随机登录密钥：

```bash
openssl rand -base64 64
```

启动服务：

```bash
sudo systemctl restart shici-api
sudo systemctl status shici-api
```

## 四、域名和 HTTPS

在阿里云 DNS 中添加 `A` 记录，将域名指向服务器公网 IP。域名解析生效后执行：

```bash
sudo certbot --nginx -d example.com
```

验证：

```bash
curl https://example.com/api/health
```

正常结果应包含：

```json
{"ok":true,"wechatConfigured":true}
```

## 五、微信开放平台

网站应用审核通过后，在微信开放平台配置授权回调域：

```text
example.com
```

代码实际使用的回调地址是：

```text
https://example.com/api/auth/wechat/callback
```

微信开放平台通常填写授权回调**域名**，不要带 `https://` 和路径，具体以平台输入框提示为准。

## 六、官网备案信息

在根目录 `site-config.js` 中填写：

```js
window.SHICI_SITE_INFO = {
  ownerName: "备案主体名称",
  contactEmail: "联系邮箱",
  icpNumber: "某ICP备XXXXXXXX号-1",
  publicSecurityNumber: ""
};
```

备案号必须与工信部备案查询结果一致。

## 官方资料

- [阿里云 ICP 备案基础服务说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/)
- [微信网站应用审核规范](https://developers.weixin.qq.com/doc/oplatform/Website_App/operation.html)
- [微信网站应用登录开发指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)
