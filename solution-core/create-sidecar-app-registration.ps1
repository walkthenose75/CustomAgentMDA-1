<#
.SYNOPSIS
  Creates the Entra ID (Azure AD) app registration the Agent Sidecar pane uses for
  delegated, per-user authentication to a Copilot Studio agent.

.DESCRIPTION
  The sidecar pane runs MSAL.js (SPA / auth-code + PKCE) inside a Dynamics 365 model-driven
  app. It signs the user in silently against the same Entra session they already have from
  signing in to Dynamics, and acquires a delegated token for the Power Platform API scope
  'CopilotStudio.Copilots.Invoke'. That requires an app registration with:
    * a SPA redirect URI pointing at the sidecar's authRedirect.html web resource, and
    * the delegated Power Platform API permission 'CopilotStudio.Copilots.Invoke' (admin-consented).

  This script is idempotent-ish: re-running creates a NEW app registration each time unless you
  pass -ExistingAppId to update one in place.

.PREREQUISITES
  * Azure CLI signed in to the TARGET tenant:
        az login --tenant <tenant>.onmicrosoft.com --use-device-code --allow-no-subscriptions
  * The signed-in account must be able to create app registrations and grant admin consent
    (Application Administrator / Cloud Application Administrator / Global Administrator).

.EXAMPLE
  ./create-sidecar-app-registration.ps1 -OrgUrl "https://org8599b1c0.crm.dynamics.com" `
      -DisplayName "Agent Sidecar - Delegated Auth (Contoso-Dev)"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $OrgUrl,

    [string] $DisplayName = "Agent Sidecar - Delegated Auth",

    # Power Platform API (first-party). Exposes CopilotStudio.Copilots.Invoke.
    [string] $PowerPlatformApiAppId = "8578e004-a5c6-46e7-913e-12f58912df43",

    [string] $ScopeName = "CopilotStudio.Copilots.Invoke",

    # Set to update an existing registration in place instead of creating a new one.
    [string] $ExistingAppId
)

$ErrorActionPreference = "Stop"
function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }

# --- 0. Confirm CLI context -------------------------------------------------
$acct = az account show 2>$null | ConvertFrom-Json
if (-not $acct) { throw "Azure CLI is not signed in. Run: az login --tenant <tenant> --use-device-code --allow-no-subscriptions" }
$tenantId = $acct.tenantId
Info "Tenant : $tenantId"
Info "Signed in as: $($acct.user.name)"

$redirectUri = "$($OrgUrl.TrimEnd('/'))/WebResources/maftagsc_/copilot/authRedirect.html"
Info "SPA redirect URI: $redirectUri"

# --- 1. Ensure the Power Platform API service principal exists (needed to resolve the scope + consent) ---
$ppSp = az ad sp show --id $PowerPlatformApiAppId 2>$null | ConvertFrom-Json
if (-not $ppSp) {
    Info "Power Platform API service principal not present in tenant; creating it..."
    az ad sp create --id $PowerPlatformApiAppId | Out-Null
    $ppSp = az ad sp show --id $PowerPlatformApiAppId | ConvertFrom-Json
}
$scope = $ppSp.oauth2PermissionScopes | Where-Object { $_.value -eq $ScopeName }
if (-not $scope) { throw "Scope '$ScopeName' not found on Power Platform API ($PowerPlatformApiAppId)." }
$scopeId = $scope.id
Ok "Resolved delegated scope '$ScopeName' -> $scopeId"

# --- 2. Build the requiredResourceAccess payload ----------------------------
$rra = @(
    @{
        resourceAppId  = $PowerPlatformApiAppId
        resourceAccess = @(@{ id = $scopeId; type = "Scope" })
    }
) | ConvertTo-Json -Depth 8 -Compress
$rraFile = New-TemporaryFile
Set-Content -Path $rraFile -Value $rra -Encoding utf8

# --- 3. Create (or reuse) the app registration ------------------------------
if ($ExistingAppId) {
    $appId = $ExistingAppId
    Info "Updating existing app registration $appId ..."
    az ad app update --id $appId --display-name $DisplayName --sign-in-audience AzureADMyOrg --required-resource-accesses "@$rraFile" | Out-Null
} else {
    Info "Creating app registration '$DisplayName' ..."
    $app = az ad app create --display-name $DisplayName --sign-in-audience AzureADMyOrg --required-resource-accesses "@$rraFile" | ConvertFrom-Json
    $appId = $app.appId
}
$objectId = (az ad app show --id $appId | ConvertFrom-Json).id
Ok "App (client) id: $appId"

# --- 4. Register the SPA redirect URI (Graph PATCH; az has no --spa flag) ----
$spaBody = @{ spa = @{ redirectUris = @($redirectUri) } } | ConvertTo-Json -Depth 5 -Compress
$spaFile = New-TemporaryFile
Set-Content -Path $spaFile -Value $spaBody -Encoding utf8
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objectId" --headers "Content-Type=application/json" --body "@$spaFile" | Out-Null
Ok "SPA redirect URI registered."

# --- 5. Ensure the service principal exists, then grant admin consent --------
if (-not (az ad sp show --id $appId 2>$null)) {
    az ad sp create --id $appId | Out-Null
}
Info "Granting admin consent for '$ScopeName' ..."
az ad app permission admin-consent --id $appId
Ok "Admin consent granted."

# --- 6. Emit the values for the sidecar configuration record ----------------
Remove-Item $rraFile, $spaFile -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "=================== SIDECAR CONFIG VALUES ===================" -ForegroundColor Yellow
Write-Host "clientId    : $appId"
Write-Host "tenantId    : $tenantId"
Write-Host "scope       : https://api.powerplatform.com/$ScopeName"
Write-Host "redirectPath: /WebResources/maftagsc_/copilot/authRedirect.html"
Write-Host "redirectUri : $redirectUri"
Write-Host "============================================================" -ForegroundColor Yellow
