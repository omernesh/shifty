# tools/backup/install-task-scheduler.ps1
# Registers Windows Scheduled Tasks for shifty-backup-nightly and shifty-restore-test-daily.
# Run as `claude` from an ELEVATED PowerShell session on hpg5.
# Idempotent: re-running updates the task definitions; doesn't duplicate.
#
# Usage (from hpg5 elevated PowerShell):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   C:\shifts-manager\tools\backup\install-task-scheduler.ps1
#
# Verify after running:
#   Get-ScheduledTask -TaskName 'shifty-*'
#   Get-ScheduledTaskInfo -TaskName 'shifty-backup-nightly'

$ErrorActionPreference = 'Stop'
$ScriptsDir = 'C:\shifts-manager\tools\backup'

# Verify scripts exist before registering
foreach ($s in @('backup-postgres.ps1', 'restore-test.ps1')) {
  $p = Join-Path $ScriptsDir $s
  if (-not (Test-Path $p)) {
    throw "Missing backup script: $p (did you pscp tools/backup/ to hpg5?)"
  }
}

Write-Host "Scripts directory: $ScriptsDir"
Write-Host "Both backup scripts found. Registering scheduled tasks..."
Write-Host ""

# ---------- Task 1: nightly backup at 02:00 Israel time ----------
$TaskName1 = 'shifty-backup-nightly'
$Action1 = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptsDir\backup-postgres.ps1`""

# Israel is UTC+3 standard / UTC+2 winter — Task Scheduler uses local time.
# hpg5 must be configured for Asia/Jerusalem timezone (check via: tzutil /g).
$Trigger1 = New-ScheduledTaskTrigger -Daily -At '02:00'

$Principal1 = New-ScheduledTaskPrincipal -UserId 'claude' -LogonType Interactive -RunLevel Highest

$Settings1 = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

if (Get-ScheduledTask -TaskName $TaskName1 -ErrorAction SilentlyContinue) {
  Write-Host "Removing existing task: $TaskName1"
  Unregister-ScheduledTask -TaskName $TaskName1 -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName1 -Action $Action1 -Trigger $Trigger1 `
  -Principal $Principal1 -Settings $Settings1 `
  -Description 'Nightly Postgres pg_dump backup with off-host rclone copy + self-test (shifty project)' | Out-Null

Write-Host "Registered: $TaskName1 (daily at 02:00 local time, 30-min timeout)"

# ---------- Task 2: daily restore-test at 03:00 (after backup completes) ----------
$TaskName2 = 'shifty-restore-test-daily'
$Action2 = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptsDir\restore-test.ps1`""

$Trigger2 = New-ScheduledTaskTrigger -Daily -At '03:00'

$Principal2 = New-ScheduledTaskPrincipal -UserId 'claude' -LogonType Interactive -RunLevel Highest

$Settings2 = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $TaskName2 -ErrorAction SilentlyContinue) {
  Write-Host "Removing existing task: $TaskName2"
  Unregister-ScheduledTask -TaskName $TaskName2 -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName2 -Action $Action2 -Trigger $Trigger2 `
  -Principal $Principal2 -Settings $Settings2 `
  -Description 'Daily pg_restore --list self-test on latest dump (shifty project)' | Out-Null

Write-Host "Registered: $TaskName2 (daily at 03:00 local time, 10-min timeout)"
Write-Host ""
Write-Host "Setup complete. Verify with:"
Write-Host "  Get-ScheduledTask -TaskName 'shifty-*'"
Write-Host "  Get-ScheduledTaskInfo -TaskName 'shifty-backup-nightly'"
Write-Host ""
Write-Host "To run the backup immediately (for testing):"
Write-Host "  Start-ScheduledTask -TaskName 'shifty-backup-nightly'"
Write-Host "  Start-Sleep -Seconds 10"
Write-Host "  Get-ScheduledTaskInfo -TaskName 'shifty-backup-nightly' | Select-Object LastTaskResult,LastRunTime,NextRunTime"
