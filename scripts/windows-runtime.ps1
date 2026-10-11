[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Start', 'Status', 'Stop', 'InstallStartup', 'RemoveStartup')]
    [string]$Mode = 'Status',
    [string]$InstallRoot,
    [string]$ConfigFile,
    [string]$NodePath,
    [switch]$ApproveStartup
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This launcher requires Windows.' }
if ($Mode -eq 'InstallStartup' -and -not $ApproveStartup) { throw 'Startup installation requires the explicit -ApproveStartup switch.' }
if ($Mode -eq 'RemoveStartup' -and -not $ApproveStartup) { throw 'Startup removal requires the explicit -ApproveStartup switch.' }
if (-not $InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
$root = (Resolve-Path -LiteralPath $InstallRoot).Path
$runtime = Join-Path $root 'dist\scripts\runtime.js'
$startupHost = Join-Path $root 'scripts\windows-startup-host.ps1'
if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw 'Build the application before launching it.' }
if (-not (Test-Path -LiteralPath $startupHost -PathType Leaf)) { throw 'The Windows startup host is missing.' }
$powershell = (Get-Command powershell.exe -CommandType Application).Source
if (-not $NodePath) { $NodePath = (Get-Command node -CommandType Application).Source }
$node = (Resolve-Path -LiteralPath $NodePath).Path
if (-not $ConfigFile) { $ConfigFile = Join-Path $root '.env' }
$config = (Resolve-Path -LiteralPath $ConfigFile).Path
if ($root.Contains('"') -or $config.Contains('"') -or $runtime.Contains('"') -or $node.Contains('"') -or $startupHost.Contains('"')) { throw 'Paths must not contain quote characters.' }
$versionText = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Version
if (-not $versionText -or $LASTEXITCODE -ne 0) { throw 'The Node executable did not return its version.' }
$version = [Version]($versionText.Trim().TrimStart('v'))
if ($version -lt [Version]'24.14.0' -or $version -ge [Version]'25.0.0') { throw 'Use the pinned Node 24 runtime.' }
$previous = Get-Location
try {
    Set-Location -LiteralPath $root
    $hostArguments = @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', "`"$startupHost`"", '-InstallRoot', "`"$root`"", '-ConfigFile', "`"$config`"", '-NodePath', "`"$node`"")
    $validated = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Validate
    if ($LASTEXITCODE -ne 0) { throw 'Private runtime configuration is invalid.' }
    $settings = $validated | ConvertFrom-Json
    if ($settings.profile -ne 'local') { throw 'Windows startup is restricted to the local private profile.' }
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = $hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())) }
    finally { $hash.Dispose() }
    $suffix = ([BitConverter]::ToString($digest)).Replace('-', '').Substring(0, 12)
    $taskName = "OpenCareers-$suffix"
    switch ($Mode) {
        'Status' { & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Status }
        'Stop' { & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Stop }
        'Start' {
            if ($PSCmdlet.ShouldProcess($root, 'Start hidden application runtime')) {
                Start-Process -FilePath $powershell -ArgumentList $hostArguments -WorkingDirectory $root -WindowStyle Hidden
            }
        }
        'InstallStartup' {
            if ($PSCmdlet.ShouldProcess($taskName, 'Install current-user logon startup')) {
                $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
                $action = New-ScheduledTaskAction -Execute $powershell -Argument ($hostArguments -join ' ') -WorkingDirectory $root
                $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
                $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
                $taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit ([TimeSpan]::Zero)
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description 'OpenCareers owner-approved runtime; submission remains governed by standing policy.' -Force | Select-Object TaskName, State
            }
        }
        'RemoveStartup' {
            if ($PSCmdlet.ShouldProcess($taskName, 'Remove startup without stopping the current runtime')) {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
            }
        }
    }
    if (($Mode -eq 'Status' -or $Mode -eq 'Stop') -and $LASTEXITCODE -ne 0) { throw 'Runtime control failed.' }
} finally { Set-Location -LiteralPath $previous.Path }
