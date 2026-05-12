# tools/backup/backup-postgres.ps1
# Nightly backup of the shifty Postgres database.
# Runs from Windows Task Scheduler on hpg5 as user `claude`.
# NO PsExec required - docker exec + docker cp work in Task Scheduler context.
# Source: RESEARCH Pattern 13

$ErrorActionPreference = 'Stop'
$Date = Get-Date -Format "yyyy-MM-dd"
$BackupDir = "C:\shifts-manager\backups\pg"
$LogDir = "C:\shifts-manager\backups\logs"
$DumpFile = "$BackupDir\$Date.dump"
$LogFile = "$LogDir\backup-$Date.log"
$RcloneConf = "C:\shifts-manager\.rclone.conf"
$EventSource = 'ShiftyBackup'

# Ensure dirs exist
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Ensure event source exists (idempotent; needs admin on first run)
try {
  if (-not [System.Diagnostics.EventLog]::SourceExists($EventSource)) {
    New-EventLog -LogName Application -Source $EventSource -ErrorAction Stop
  }
} catch {
  # If we can't create the source (non-admin), fall back silently - log to file only
}

function Write-BackupLog($Message, $Level = 'INFO') {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

try {
  Write-BackupLog "Starting backup for $Date"

  # 1. pg_dump inside the postgres container
  docker exec shifts-postgres pg_dump -U shifts -d shifts --format=custom --no-password -f /tmp/backup.dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  Write-BackupLog "pg_dump completed inside container"

  # 2. Copy from container to host
  docker cp shifts-postgres:/tmp/backup.dump $DumpFile
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed with exit code $LASTEXITCODE" }
  $size = (Get-Item $DumpFile).Length
  Write-BackupLog "Dump copied to $DumpFile (size: $size bytes)"

  # 3. Off-host copy via rclone
  if (Test-Path $RcloneConf) {
    rclone copy $DumpFile "neshernas_pg_backup:pg-backups/" --config $RcloneConf 2>&1 | Out-File -Append $LogFile
    if ($LASTEXITCODE -ne 0) { throw "rclone copy failed with exit code $LASTEXITCODE" }
    Write-BackupLog "Off-host copy to neshernas_pg_backup succeeded"
  } else {
    Write-BackupLog "rclone config not found at $RcloneConf - skipping off-host copy" 'WARN'
  }

  # 4. Self-test: pg_restore --list
  $TestResult = docker exec shifts-postgres pg_restore --list /tmp/backup.dump 2>&1
  if ($LASTEXITCODE -ne 0) {
    try {
      Write-EventLog -LogName Application -Source $EventSource -EventId 1001 -EntryType Error `
        -Message "pg_restore --list FAILED for dump $Date. Output: $TestResult"
    } catch { }
    throw "pg_restore --list failed"
  }
  $tocLines = ($TestResult | Measure-Object -Line).Lines
  Write-BackupLog "Self-test: pg_restore --list returned $tocLines lines (PASS)"

  # 5. Retention: keep last 14 daily files. Compare by FullName because two separate
  #    Get-ChildItem calls produce different FileInfo instances even for the same file -
  #    `$kept -notcontains $_` would compare by reference and delete every file.
  $keptPaths = Get-ChildItem $BackupDir -Filter "*.dump" |
                 Sort-Object LastWriteTime -Descending |
                 Select-Object -First 14 -ExpandProperty FullName
  $toDelete = Get-ChildItem $BackupDir -Filter "*.dump" |
                Where-Object { $keptPaths -notcontains $_.FullName }
  foreach ($f in $toDelete) {
    Remove-Item $f.FullName
    Write-BackupLog "Pruned old backup: $($f.Name)"
  }

  # 6. Cleanup container tmp
  docker exec shifts-postgres rm -f /tmp/backup.dump
  Write-BackupLog "Backup $Date completed successfully"
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1000 -EntryType Information `
      -Message "shifty-backup-$Date succeeded. Dump: $DumpFile ($size bytes); Self-test: PASS ($tocLines TOC lines)"
  } catch { }
  exit 0
} catch {
  $errMsg = "$_ | StackTrace: $($_.ScriptStackTrace)"
  Write-BackupLog $errMsg 'ERROR'
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1002 -EntryType Error `
      -Message "shifty-backup-$Date FAILED. Error: $errMsg"
  } catch { }
  exit 1
}
