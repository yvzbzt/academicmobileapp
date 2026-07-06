param(
  [string]$ProjectId = "academic-mobile-app-7629",
  [string]$Region = "europe-west1",
  [string]$Service = "academic-calendar-api",
  [string]$ApiBaseUrl = "https://academic-calendar-api-qrld4semgq-ew.a.run.app",
  [string]$MobileUrl = "https://academic-mobile-app-7629.web.app",
  [string]$AdminUrl = "https://academic-mobile-app-7629-admin.web.app"
)

$ErrorActionPreference = "Stop"
$runId = Get-Date -Format "yyyyMMddHHmmss"
$adminEmail = "playwright-admin+$runId@academic-mobile-app.local"
$adminPassword = "PwAdmin-" + ([guid]::NewGuid().ToString("N").Substring(0, 18)) + "!Aa1"

Write-Host "Creating a temporary Playwright super-admin on Cloud Run..."
$envVars = "^~^BOOTSTRAP_SEED_ENABLED=true~BOOTSTRAP_ADMIN_EMAIL=$adminEmail~BOOTSTRAP_ADMIN_PASSWORD=$adminPassword~BOOTSTRAP_ADMIN_NAME=Playwright Super Admin"
& gcloud run services update $Service --region $Region --platform managed --project $ProjectId --update-env-vars $envVars | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Run super-admin bootstrap update failed."
}

$env:E2E_RUN_ID = $runId
$env:E2E_API_BASE_URL = $ApiBaseUrl
$env:E2E_MOBILE_URL = $MobileUrl
$env:E2E_ADMIN_URL = $AdminUrl
$env:E2E_ADMIN_EMAIL = $adminEmail
$env:E2E_ADMIN_PASSWORD = $adminPassword

Write-Host "Running Playwright live e2e suite..."
& npx playwright test
exit $LASTEXITCODE
