# tools/backup/restore-test.ps1
# Daily self-test: runs pg_restore --list on the latest backup file.
# Alerts via Windows Event Log if no recent backup OR if self-test fails.
# Runs from Windows Task Scheduler on hpg5 as user `claude`.
$ErrorActionPreference = 'Stop'
$BackupDir = "C:\shifts-manager\backups\pg"
$EventSource = 'ShiftyBackup'
$StaleThresholdHours = 30   # alert if latest backup > 30h old

if (-not (Test-Path $BackupDir)) {
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1010 -EntryType Error `
      -Message "Restore test: backup dir $BackupDir does not exist"
  } catch { }
  Write-Host "ERROR: backup dir $BackupDir does not exist"
  exit 1
}

$latest = Get-ChildItem $BackupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) {
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1011 -EntryType Error `
      -Message "Restore test: no .dump files in $BackupDir"
  } catch { }
  Write-Host "ERROR: no .dump files in $BackupDir"
  exit 1
}

$age = (Get-Date) - $latest.LastWriteTime
if ($age.TotalHours -gt $StaleThresholdHours) {
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1012 -EntryType Warning `
      -Message "Restore test: latest dump is $([int]$age.TotalHours)h old (>${StaleThresholdHours}h threshold). File: $($latest.Name)"
  } catch { }
  Write-Host "WARN: latest dump is $([int]$age.TotalHours)h old (threshold: ${StaleThresholdHours}h)"
}

# Copy dump to container for pg_restore --list
docker cp $latest.FullName shifts-postgres:/tmp/restore-test.dump
if ($LASTEXITCODE -ne 0) {
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1013 -EntryType Error `
      -Message "Restore test: docker cp to container failed for $($latest.Name)"
  } catch { }
  Write-Host "ERROR: docker cp to container failed"
  exit 1
}

$Result = docker exec shifts-postgres pg_restore --list /tmp/restore-test.dump 2>&1
if ($LASTEXITCODE -ne 0) {
  try {
    Write-EventLog -LogName Application -Source $EventSource -EventId 1014 -EntryType Error `
      -Message "Restore test FAILED for $($latest.Name). Output: $Result"
  } catch { }
  docker exec shifts-postgres rm -f /tmp/restore-test.dump
  Write-Host "ERROR: pg_restore --list FAILED for $($latest.Name)"
  exit 1
}

$tocLines = ($Result | Measure-Object -Line).Lines
docker exec shifts-postgres rm -f /tmp/restore-test.dump

try {
  Write-EventLog -LogName Application -Source $EventSource -EventId 1015 -EntryType Information `
    -Message "Restore test PASSED for $($latest.Name). TOC: $tocLines lines."
} catch { }
Write-Host "Restore test passed: $tocLines lines in TOC; latest = $($latest.Name)"
exit 0
