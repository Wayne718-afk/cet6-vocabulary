$nodeDir = Join-Path $env:LOCALAPPDATA "CodexTools\node-v24.14.0-win-x64"
$npm = Join-Path $nodeDir "npm.cmd"
$env:Path = "$nodeDir;$env:Path"

Set-Location -LiteralPath $PSScriptRoot
Write-Host "=== 拾词微信登录密钥配置 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "第 1 步：出现提示后粘贴微信 AppID，然后按回车。"
& $npm exec --yes wrangler@latest -- secret put WECHAT_APP_ID
if ($LASTEXITCODE -ne 0) {
  Write-Host "AppID 写入失败。" -ForegroundColor Red
  Read-Host "按回车关闭窗口"
  exit 1
}

Write-Host ""
Write-Host "第 2 步：出现提示后粘贴微信 AppSecret，然后按回车。"
& $npm exec --yes wrangler@latest -- secret put WECHAT_APP_SECRET
if ($LASTEXITCODE -ne 0) {
  Write-Host "AppSecret 写入失败。" -ForegroundColor Red
  Read-Host "按回车关闭窗口"
  exit 1
}

Write-Host ""
Write-Host "两个密钥均已安全写入 Cloudflare。" -ForegroundColor Green
Read-Host "按回车关闭窗口"
