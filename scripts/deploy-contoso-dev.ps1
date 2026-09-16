<#
.SYNOPSIS
    One-command deploy of the Agent Sidecar pane + launcher web resources to Contoso - Dev.

.DESCRIPTION
    Pinned so we never rediscover the deploy path again (see the frustration that motivated this).

    Identity : pac auth profile index 5  ->  admin@M365x61645866.onmicrosoft.com  (Contoso - Dev)
               pac uses its OWN token; do NOT use `az` (your corp identity is not a member of the
               Contoso tenant, so `az account get-access-token` fails / uses the wrong identity).
    Env      : https://org8599b1c0.crm.dynamics.com/  (env id f93f07d8-7d47-ea58-95b8-d71772175b0b)
    Solution : AgentSidecarCore (unmanaged) owns the two web resources.
    Route    : This CLI (pac 2.11.2) has NO `webresource` command, so we:
               export AgentSidecarCore -> unpack -> swap the 2 web-resource files -> pack ->
               import --publish-changes. No schema change, no config change.

    The two web resources carry BOTH shipped features and the later fixes:
      maftagsc_/copilot/agentSidePane.html  = pane runtime (auth refresh + prompt catalog +
                                              per-form nav self-heal / chooseResolvedContext)
      maftagsc_/copilot/agentSidePane.js    = form launcher (SSO loginHint + sessionStorage
                                              config cache / configCacheKey)

.NOTES
    Run from anywhere:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-contoso-dev.ps1
    Rebuild first with -Rebuild if you changed any model-driven/webresources/**/*.ts source.
#>
[CmdletBinding()]
param(
    [string]$SolutionName     = "AgentSidecarCore",
    [string]$ExpectedOrgUrl   = "https://org8599b1c0.crm.dynamics.com/",
    [string]$AuthProfileIndex = "5",
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$srcWr    = Join-Path $repoRoot "solution\WebResources\maftagsc_\copilot"
$files    = @("agentSidePane.html", "agentSidePane.js")

function Write-Step($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }

# 0) Optional: rebuild the deployable artifacts from source.
if ($Rebuild) {
    Write-Step "Rebuilding web resources (node model-driven/build.mjs)"
    Push-Location $repoRoot
    try { node model-driven/build.mjs } finally { Pop-Location }
}

foreach ($f in $files) {
    $p = Join-Path $srcWr $f
    if (-not (Test-Path $p)) { throw "Missing built artifact: $p  (run with -Rebuild)" }
}

# 1) Correct identity + correct org (fail closed).
Write-Step "Selecting pac profile [$AuthProfileIndex] and verifying org"
pac auth select --index $AuthProfileIndex | Out-Host
$who = (pac org who | Out-String)
if ($who -notmatch [regex]::Escape($ExpectedOrgUrl)) {
    throw "Refusing to deploy: `pac org who` did not report $ExpectedOrgUrl.`n$who"
}
Write-Host $who

# 2) Fresh work dir.
$work = Join-Path $repoRoot "_deploy"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null
$zipIn  = Join-Path $work "AgentSidecarCore.zip"
$unpack = Join-Path $work "AgentSidecarCore"
$zipOut = Join-Path $work "AgentSidecarCore-updated.zip"

# 3) Export the current unmanaged solution (source of truth for structure + web-resource metadata).
Write-Step "Exporting $SolutionName (unmanaged)"
pac solution export --name $SolutionName --path $zipIn --managed false --overwrite | Out-Host

# 4) Unpack.
Write-Step "Unpacking"
pac solution unpack --zipfile $zipIn --folder $unpack --packagetype Unmanaged --allowDelete --clobber | Out-Host

# 5) Swap the two web-resource content files. Guard: exactly one match each, or abort before import.
Write-Step "Swapping web-resource content"
foreach ($f in $files) {
    $src = Join-Path $srcWr $f
    $hit = @(Get-ChildItem -Path $unpack -Recurse -File -Filter $f)
    if ($hit.Count -ne 1) {
        throw "Expected exactly 1 '$f' in exported $SolutionName, found $($hit.Count). " +
              "The web resource may live in a different solution."
    }
    Copy-Item $src $hit[0].FullName -Force
    Write-Host ("  {0}  ->  {1}" -f $f, $hit[0].FullName)
}

# 6) Repack.
Write-Step "Packing updated solution"
pac solution pack --zipfile $zipOut --folder $unpack --packagetype Unmanaged | Out-Host

# 7) Import + publish.
Write-Step "Importing + publishing to Contoso - Dev"
pac solution import --path $zipOut --publish-changes --force-overwrite | Out-Host

# 8) Verify the two web resources were just modified.
Write-Step "Verifying (modifiedon should be ~now, UTC)"
$fx = "<fetch><entity name='webresource'><attribute name='name'/><attribute name='modifiedon'/>" +
      "<attribute name='modifiedby'/><order attribute='modifiedon' descending='true'/><filter>" +
      "<condition attribute='name' operator='in'>" +
      "<value>maftagsc_/copilot/agentSidePane.html</value>" +
      "<value>maftagsc_/copilot/agentSidePane.js</value>" +
      "</condition></filter></entity></fetch>"
pac org fetch --xml $fx | Out-Host

Write-Host "`n== Deploy complete. Hard-refresh the model-driven app (Ctrl+F5) to load the new pane. ==" -ForegroundColor Green
