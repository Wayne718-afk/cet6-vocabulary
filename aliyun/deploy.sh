#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: sudo bash deploy.sh example.com"
  exit 1
fi

DOMAIN="$1"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_SOURCE="$PROJECT_ROOT/aliyun"
API_TARGET="/opt/shici/api"
WEB_TARGET="/var/www/shici"
DATA_TARGET="/var/lib/shici"

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run this script with sudo."
  exit 1
fi

id -u shici >/dev/null 2>&1 || useradd --system --home /opt/shici --shell /usr/sbin/nologin shici
install -d -o shici -g shici "$API_TARGET" "$DATA_TARGET"
install -d -o www-data -g www-data "$WEB_TARGET"

cp "$API_SOURCE/package.json" "$API_SOURCE/server.js" "$API_SOURCE/schema.sql" "$API_TARGET/"
cd "$API_TARGET"
npm install --omit=dev
chown -R shici:shici "$API_TARGET" "$DATA_TARGET"

for file in index.html styles.css app.js manifest.webmanifest service-worker.js cloud-config.js site-config.js legal.html legal.js; do
  cp "$PROJECT_ROOT/$file" "$WEB_TARGET/$file"
done
install -d "$WEB_TARGET/vendor"
cp "$PROJECT_ROOT/vendor/jszip.min.js" "$WEB_TARGET/vendor/jszip.min.js"
printf 'window.SHICI_CLOUD_API = "/api";\n' > "$WEB_TARGET/cloud-config.js"
chown -R www-data:www-data "$WEB_TARGET"

sed "s/YOUR_DOMAIN/$DOMAIN/g" "$API_SOURCE/nginx-shici.conf" > /etc/nginx/sites-available/shici
ln -sfn /etc/nginx/sites-available/shici /etc/nginx/sites-enabled/shici
rm -f /etc/nginx/sites-enabled/default

cp "$API_SOURCE/shici-api.service" /etc/systemd/system/shici-api.service
systemctl daemon-reload
systemctl enable shici-api.service

if [[ ! -f "$API_TARGET/.env" ]]; then
  cp "$API_SOURCE/.env.example" "$API_TARGET/.env"
  sed -i "s#https://example.com#https://$DOMAIN#g" "$API_TARGET/.env"
  chown shici:shici "$API_TARGET/.env"
  chmod 600 "$API_TARGET/.env"
  echo
  echo "Created $API_TARGET/.env."
  echo "Fill in WeChat credentials and JWT_SECRET, then run:"
  echo "  sudo systemctl restart shici-api"
fi

nginx -t
systemctl reload nginx

echo "Static site and API files installed for $DOMAIN."
