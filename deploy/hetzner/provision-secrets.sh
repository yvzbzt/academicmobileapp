#!/usr/bin/env bash
set -euo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"

if [[ -e "${deployment_root}/.env" ]]; then
  echo "Refusing to overwrite existing environment file: ${deployment_root}/.env" >&2
  exit 1
fi

umask 077
install -d -m 700 "${deployment_root}"
install -d -m 700 "${deployment_root}/source"

mongo_root_password="$(openssl rand -hex 32)"
mongo_app_password="$(openssl rand -hex 32)"
jwt_access_secret="$(openssl rand -hex 48)"
jwt_refresh_secret="$(openssl rand -hex 48)"
email_verification_token_pepper="$(openssl rand -hex 48)"
password_recovery_token_pepper="$(openssl rand -hex 48)"
data_encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
data_lookup_hmac_secret="$(openssl rand -base64 32 | tr -d '\n')"
calendar_feed_secret="$(openssl rand -hex 48)"

cat > "${deployment_root}/.env" <<EOF
MONGO_ROOT_USERNAME=anssoft_root
MONGO_ROOT_PASSWORD=${mongo_root_password}
MONGO_APP_DATABASE=academic_calendar
MONGO_APP_USERNAME=anssoft_app
MONGO_APP_PASSWORD=${mongo_app_password}
JWT_ACCESS_SECRET=${jwt_access_secret}
JWT_REFRESH_SECRET=${jwt_refresh_secret}
EMAIL_VERIFICATION_TOKEN_PEPPER=${email_verification_token_pepper}
PASSWORD_RECOVERY_TOKEN_PEPPER=${password_recovery_token_pepper}
DATA_ENCRYPTION_KEY_ID=prod-v1
DATA_ENCRYPTION_KEY=${data_encryption_key}
DATA_LOOKUP_HMAC_SECRET=${data_lookup_hmac_secret}
DATA_ENCRYPTION_PREVIOUS_KEYS=
CALENDAR_FEED_SECRET=${calendar_feed_secret}
CORS_ORIGIN=https://academic-api.anssoft.com.tr,https://academic-mobile-app-7629.web.app,https://academic-mobile-app-7629.firebaseapp.com
GOOGLE_OAUTH_CLIENT_IDS=315186329318-mbbpc4rjd1ipirfnsl3vdetjfi8ir2ff.apps.googleusercontent.com,315186329318-785gu93pgok7un5rgtpup812rn00irfn.apps.googleusercontent.com
API_PUBLIC_BASE_URL=https://academic-api.anssoft.com.tr
EMAIL_VERIFICATION_URL=https://academic-api.anssoft.com.tr/auth/verify-email
MAIL_FROM=noreply@anssoft.com.tr
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
EOF

chmod 600 "${deployment_root}/.env"
unset mongo_root_password mongo_app_password jwt_access_secret jwt_refresh_secret
unset email_verification_token_pepper password_recovery_token_pepper
unset data_encryption_key data_lookup_hmac_secret calendar_feed_secret

echo "Created isolated deployment root and restricted environment file."
