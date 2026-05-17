<#
.SYNOPSIS
  PR-time snapshot wrapper around `budi backups --export` against the live
  Budibase stack on hpg5. Produces budibase-exports/YYYY-MM-DD-<slug>.tar.gz.

.DESCRIPTION
  Resolves docs/BUDIBASE-CONVENTIONS.md §10 open item #4. Per D-04, snapshots
  are PR-time-only against the live Builder UI on hpg5.

  Empirical findings from W0-05 Task 1 (2026-05-17) — these explain why the
  command chain looks the way it does:

    1. `budi` is NOT inside the budibase/apps:3.38.4 image. The image ships only
       @budibase/server + @budibase/nano. The plan's original "docker compose
       exec budibase-app budi ..." was wrong.
    2. `budi backups --export <filename>` takes the export path POSITIONALLY,
       not via `-o <filename>` (which was also a plan-time assumption error).
    3. The cleanest way to run budi against the stack is via an ephemeral
       `node:22-alpine` container attached to the `shifts-manager_default`
       docker network. From inside that container, `budibase-proxy:10000` is
       the in-network entry point (matches the proxy's internal port).
    4. PsExec gating result: PsExec is NOT required for `docker run --rm`
       against an already-cached node:22-alpine image. The credential helper
       only fires on `docker pull` from a registry. If a contributor runs the
       script before node:22-alpine is cached on hpg5, the *first* run needs a
       one-time PsExec-wrapped `docker pull node:22-alpine` — this script
       detects that case and prints a recovery hint instead of trying to pull
       silently (which would fail with a confusing credential-helper error).

  Atomic-move pattern: the tarball is staged at `.tar.gz.tmp` on the local
  workstation and only moved into place at the final filename after a size +
  contents sanity check. If the run is interrupted or the tarball is empty,
  the working tree never sees a half-written `.tar.gz`. `.gitignore` excludes
  `budibase-exports/*.tmp` for the same reason.

.PARAMETER FeatureSlug
  Human-readable feature name (lowercase kebab-case, e.g. "availability-ui").
  Required. Used as the suffix in the tarball filename.

.PARAMETER Date
  Date prefix for the tarball filename. Defaults to today (YYYY-MM-DD,
  Asia/Jerusalem locale-independent ISO format).

.PARAMETER HpgUser
  SSH username for hpg5. Default: `claude` (the canonical account per
  CLAUDE.md "SSH access").

.PARAMETER HpgPassword
  SSH password for hpg5. Default: $env:HPG_SSH_PASSWORD if set, else the
  canonical fallback from CLAUDE.md. Prefer setting $env:HPG_SSH_PASSWORD
  so the password never appears in shell history or script source.

.PARAMETER HpgHostKey
  Pinned SSH hostkey for hpg5 (CLAUDE.md "SSH access"). Default matches the
  documented hostkey. Pinning prevents MITM (threat T-03W0-05-01).

.PARAMETER HpgHost
  SSH hostname / Tailscale MagicDNS name. Default: hpg5.

.PARAMETER ComposeNetwork
  Docker network name where the Budibase stack lives. Default:
  `shifts-manager_default` (matches `docker network ls` on hpg5 as of W0-05).

.EXAMPLE
  .\tools\snapshot-budibase.ps1 -FeatureSlug "availability-ui"

  Produces budibase-exports/2026-05-17-availability-ui.tar.gz.

.EXAMPLE
  $env:HPG_SSH_PASSWORD = (Read-Host -AsSecureString -Prompt "hpg5 pw" | ConvertFrom-SecureString -AsPlainText)
  .\tools\snapshot-budibase.ps1 -FeatureSlug "w0-bootstrap"

  Same as above but with the password supplied via env var instead of the
  hardcoded fallback.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]*$')]
    [string]$FeatureSlug,

    [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),

    [string]$HpgUser = 'claude',
    [string]$HpgPassword = $(if ($env:HPG_SSH_PASSWORD) { $env:HPG_SSH_PASSWORD } else { 'Onclaude2103' }),
    [string]$HpgHostKey = 'SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ',
    [string]$HpgHost = 'hpg5',
    [string]$ComposeNetwork = 'shifts-manager_default',
    [string]$HpgEnvFile = 'C:\shifts-manager\.env',
    [string]$HpgStageDir = 'C:\shifts-manager\.snapshot-stage',
    [string]$BudiCliVersion = '3.38.4'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ----------------------------------------------------------------------------
# 1. Resolve paths
# ----------------------------------------------------------------------------
$TarballName = "$Date-$FeatureSlug.tar.gz"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ExportsDir = Join-Path $RepoRoot 'budibase-exports'
if (-not (Test-Path $ExportsDir)) {
    New-Item -ItemType Directory -Path $ExportsDir | Out-Null
}
$LocalTmpPath = Join-Path $ExportsDir "$TarballName.tmp"
$LocalFinalPath = Join-Path $ExportsDir $TarballName

# Sanity: refuse to overwrite a tarball that's already tracked unless the
# caller explicitly accepts the idempotent overwrite (per must-have "idempotent").
if (Test-Path $LocalFinalPath) {
    Write-Host "Note: $LocalFinalPath already exists. Overwriting (idempotent)." -ForegroundColor Yellow
}
if (Test-Path $LocalTmpPath) {
    Remove-Item -Force $LocalTmpPath
}

# ----------------------------------------------------------------------------
# 2. plink + pscp canonical args (CLAUDE.md "SSH access")
# ----------------------------------------------------------------------------
$PlinkArgs = @(
    '-ssh',
    '-l', $HpgUser,
    '-pw', $HpgPassword,
    '-batch',
    '-hostkey', $HpgHostKey,
    $HpgHost
)

function Invoke-Plink {
    param([Parameter(Mandatory)][string]$RemoteCommand)
    & plink @PlinkArgs $RemoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "plink failed (exit $LASTEXITCODE) running: $RemoteCommand"
    }
}

# ----------------------------------------------------------------------------
# 3. Verify node:22-alpine is cached on hpg5 (the script does NOT pull —
#    that requires PsExec which we explicitly don't want in the happy path).
# ----------------------------------------------------------------------------
Write-Host "[1/6] Verifying node:22-alpine is cached on $HpgHost ..."
$probe = & plink @PlinkArgs "powershell -NoProfile -Command `"docker images node:22-alpine --format '{{.Repository}}:{{.Tag}}'`""
if ($LASTEXITCODE -ne 0) { throw "plink probe for docker images failed (exit $LASTEXITCODE)" }
if (-not ($probe -match 'node:22-alpine')) {
    Write-Host ""
    Write-Host "ERROR: node:22-alpine is not cached on $HpgHost." -ForegroundColor Red
    Write-Host "       This is a ONE-TIME bootstrap — registry pulls need PsExec on hpg5"
    Write-Host "       (CLAUDE.md `"Why PsExec for SSH-side docker commands`")."
    Write-Host ""
    Write-Host "       Recovery: SSH to hpg5 and run, in PsExec-wrapped form:"
    Write-Host '         psexec -accepteula -nobanner -i 1 -u claude -p <pw> cmd /c "docker pull node:22-alpine"'
    Write-Host ""
    Write-Host "       Re-run this script after the pull succeeds."
    throw "node:22-alpine not cached on $HpgHost — bootstrap pull required"
}

# ----------------------------------------------------------------------------
# 4. Generate the budi.env file on hpg5 from the existing .env. This file
#    is regenerated every run and removed in step 8 — credentials never
#    persist on disk longer than the duration of one snapshot.
# ----------------------------------------------------------------------------
Write-Host "[2/6] Generating budi.env on $HpgHost from $HpgEnvFile ..."
$BuildEnvScript = @"
`$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path '$HpgStageDir' -Force | Out-Null
`$kv = @{}
Get-Content '$HpgEnvFile' | ForEach-Object {
    if (`$_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*`$') {
        `$val = `$matches[2]
        if (`$val -match '^"(.*)"`$') { `$val = `$matches[1] }
        `$kv[`$matches[1]] = `$val
    }
}
foreach (`$k in @('COUCH_DB_USER','COUCH_DB_PASSWORD','MINIO_ACCESS_KEY','MINIO_SECRET_KEY')) {
    if (-not `$kv.ContainsKey(`$k)) { throw "Missing `$k in $HpgEnvFile" }
}
`$budiEnv = @'
MAIN_PORT=10000
COUCH_DB_URL=http://__USER__:__PW__@budibase-proxy:10000/db/
MINIO_URL=http://budibase-proxy:10000
MINIO_ACCESS_KEY=__AK__
MINIO_SECRET_KEY=__SK__
'@
`$budiEnv = `$budiEnv.Replace('__USER__', `$kv['COUCH_DB_USER']).Replace('__PW__', `$kv['COUCH_DB_PASSWORD']).Replace('__AK__', `$kv['MINIO_ACCESS_KEY']).Replace('__SK__', `$kv['MINIO_SECRET_KEY'])
Set-Content -Path '$HpgStageDir\budi.env' -Value `$budiEnv -NoNewline -Encoding ASCII
Write-Output 'budi.env generated'
"@
$Bytes = [System.Text.Encoding]::Unicode.GetBytes($BuildEnvScript)
$EncodedScript = [Convert]::ToBase64String($Bytes)
& plink @PlinkArgs "powershell -NoProfile -EncodedCommand $EncodedScript" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Generating budi.env on $HpgHost failed (exit $LASTEXITCODE)" }

# ----------------------------------------------------------------------------
# 5. Run budi inside an ephemeral node:22-alpine container on the shifty network.
#    See header for why this shape is required (budi not inside apps container,
#    proxy is the in-network entry point). The docker run invocation is sent
#    via -EncodedCommand to avoid quote escaping issues between cmd, plink,
#    and PowerShell — the inner `sh -c '...'` has single quotes that confuse
#    -Command parsing.
# ----------------------------------------------------------------------------
$ContainerTarballName = "snapshot-$Date-$FeatureSlug.tar.gz"
Write-Host "[3/6] Running budi backups --export in ephemeral container ..."
$BudiScript = @"
`$ErrorActionPreference = 'Stop'
docker run --rm --network $ComposeNetwork -v '${HpgStageDir}:/work' node:22-alpine sh -c "npm install -g --silent @budibase/cli@$BudiCliVersion && cd /work && budi backups --export $ContainerTarballName --env /work/budi.env"
exit `$LASTEXITCODE
"@
$Bytes3 = [System.Text.Encoding]::Unicode.GetBytes($BudiScript)
$EncodedBudi = [Convert]::ToBase64String($Bytes3)
& plink @PlinkArgs "powershell -NoProfile -EncodedCommand $EncodedBudi" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "budi backups --export failed on $HpgHost (exit $LASTEXITCODE)" }

# ----------------------------------------------------------------------------
# 6. pscp the staged tarball back to the local workstation (.tmp first).
#    pscp parses `host:path`; on Windows remote sources the drive-letter colon
#    confuses the parser if backslashes are used. Convert to forward slashes
#    so pscp sees `user@host:C:/path/to/file.tar.gz` as a Windows drive path.
# ----------------------------------------------------------------------------
$RemoteTarballFwd = "$HpgStageDir\$ContainerTarballName".Replace('\', '/')
Write-Host "[4/6] Copying tarball back via pscp -> $LocalTmpPath ..."
& pscp -pw $HpgPassword -hostkey $HpgHostKey -batch "${HpgUser}@${HpgHost}:$RemoteTarballFwd" $LocalTmpPath
if ($LASTEXITCODE -ne 0) { throw "pscp failed (exit $LASTEXITCODE)" }

# ----------------------------------------------------------------------------
# 7. Sanity-check size + contents BEFORE the atomic move.
# ----------------------------------------------------------------------------
$size = (Get-Item $LocalTmpPath).Length
if ($size -lt 1024) {
    Remove-Item -Force $LocalTmpPath
    throw "Tarball suspiciously small ($size bytes) — aborting before move"
}
Write-Host "[5/6] Tarball size: $([math]::Round($size/1KB, 1)) KB — verifying contents ..."
# --force-local: tar would otherwise interpret "C:\foo" as host:path (rsh-style).
$contents = @(& tar --force-local -tzf $LocalTmpPath 2>$null | Select-Object -First 5)
if ($contents.Count -lt 1) {
    Remove-Item -Force $LocalTmpPath
    throw "Tarball appears empty or unreadable"
}
$hasCouch = ($contents | Where-Object { $_ -match '^couchdb/' }).Count -gt 0
if (-not $hasCouch) {
    Remove-Item -Force $LocalTmpPath
    throw "Tarball does not contain a couchdb/ directory — refusing to commit a malformed snapshot"
}

# Atomic move into place
Move-Item -Force $LocalTmpPath $LocalFinalPath

# ----------------------------------------------------------------------------
# 8. Clean up the hpg5 staging area (env file + remote tarball).
# ----------------------------------------------------------------------------
Write-Host "[6/6] Cleaning up remote staging area ..."
$CleanupScript = @"
Remove-Item -Force '$HpgStageDir\$ContainerTarballName' -ErrorAction SilentlyContinue
Remove-Item -Force '$HpgStageDir\budi.env' -ErrorAction SilentlyContinue
"@
$Bytes2 = [System.Text.Encoding]::Unicode.GetBytes($CleanupScript)
$EncodedCleanup = [Convert]::ToBase64String($Bytes2)
& plink @PlinkArgs "powershell -NoProfile -EncodedCommand $EncodedCleanup" | Out-Null

# ----------------------------------------------------------------------------
# 9. Emit summary + suggested commit message (NO auto-commit — per safety).
#    .NET SHA256 used directly because Get-FileHash is sometimes missing on
#    PS 5.1 installations where Microsoft.PowerShell.Utility didn't fully
#    register (observed on the W0-05 author's workstation 2026-05-17).
# ----------------------------------------------------------------------------
$sha256 = (& {
    $stream = [System.IO.File]::OpenRead($LocalFinalPath)
    try {
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $hasher.ComputeHash($stream)
            ([System.BitConverter]::ToString($hashBytes) -replace '-', '').ToUpperInvariant()
        } finally { $hasher.Dispose() }
    } finally { $stream.Dispose() }
})
$shaShort = $sha256.Substring(0, 16)
$sizeKB = [math]::Round((Get-Item $LocalFinalPath).Length / 1KB, 1)

Write-Host ""
Write-Host "Snapshot saved:" -ForegroundColor Green
Write-Host "  File:    $LocalFinalPath"
Write-Host "  Size:    $sizeKB KB ($size bytes)"
Write-Host "  SHA256:  $sha256"
Write-Host ""
Write-Host "Suggested commit message:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    chore(budibase): snapshot $Date-$FeatureSlug"
Write-Host ""
Write-Host "Stage with:" -ForegroundColor Cyan
Write-Host "    git add `"$LocalFinalPath`""
Write-Host "    git commit -m `"chore(budibase): snapshot $Date-$FeatureSlug`""
Write-Host ""
