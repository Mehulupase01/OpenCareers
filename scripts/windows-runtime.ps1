[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Start', 'Restart', 'Status', 'Stop', 'InstallStartup', 'RemoveStartup')]
    [string]$Mode = 'Status',
    [string]$InstallRoot,
    [string]$ConfigFile,
    [string]$NodePath,
    [switch]$ApproveStartup,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 60
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
$controlSeconds = [Math]::Min($TimeoutSeconds, 15)
$versionText = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Version -ControlTimeoutSeconds $controlSeconds
if (-not $versionText -or $LASTEXITCODE -ne 0) { throw 'The Node executable did not return its version.' }
$version = [Version]($versionText.Trim().TrimStart('v'))
if ($version -lt [Version]'24.14.0' -or $version -ge [Version]'25.0.0') { throw 'Use the pinned Node 24 runtime.' }
$previous = Get-Location
try {
    Set-Location -LiteralPath $root
    $hostArguments = @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', "`"$startupHost`"", '-InstallRoot', "`"$root`"", '-ConfigFile', "`"$config`"", '-NodePath', "`"$node`"")
    $validated = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Validate -ControlTimeoutSeconds $controlSeconds
    if ($LASTEXITCODE -ne 0) { throw 'Private runtime configuration is invalid.' }
    $settings = $validated | ConvertFrom-Json
    if ($settings.profile -ne 'local') { throw 'Windows startup is restricted to the local private profile.' }
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = $hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())) }
    finally { $hash.Dispose() }
    $suffix = ([BitConverter]::ToString($digest)).Replace('-', '').Substring(0, 12)
    $taskName = "OpenCareers-$suffix"
    function Read-RuntimeStatus {
        try {
            $output = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Status -ControlTimeoutSeconds $controlSeconds 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
            $status = $output | ConvertFrom-Json
            if ($status.state -notin @('starting', 'running', 'backoff', 'stopping', 'stopped')) { return $null }
            return $status
        } catch { return $null }
    }
    function Start-ReadyRuntime {
        $existing = Read-RuntimeStatus
        if ($existing) {
            if ($existing.state -eq 'running') { $existing | ConvertTo-Json -Compress; return }
            throw 'A runtime already owns this installation but is not running. Check Status before retrying.'
        }
        $launch = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Launch -ControlTimeoutSeconds $controlSeconds
        if ($LASTEXITCODE -ne 0 -or -not $launch) { throw 'Detached runtime launch failed.' }
        $identity = $launch | ConvertFrom-Json
        if (-not $identity.runtimePid -or $identity.runtimePid -le 0) { throw 'Detached runtime identity is missing.' }
        $launched = Get-Process -Id $identity.runtimePid -ErrorAction Stop
        try {
            $watch = [System.Diagnostics.Stopwatch]::StartNew()
            while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
                if ($launched.HasExited) { throw 'The runtime exited before readiness. Check bounded runtime diagnostics.' }
                $status = Read-RuntimeStatus
                if ($status -and $status.runtimePid -eq $identity.runtimePid -and $status.state -eq 'running') { $status | ConvertTo-Json -Compress; return }
                Start-Sleep -Milliseconds 250
            }
            throw 'Runtime readiness timed out. A process may still be starting; inspect Status before retrying. No process or control record was forcibly removed.'
        } finally { $launched.Dispose() }
    }
    switch ($Mode) {
        'Status' { & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Status -ControlTimeoutSeconds $controlSeconds }
        'Stop' { & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Stop -ControlTimeoutSeconds $controlSeconds }
        'Start' {
            if ($PSCmdlet.ShouldProcess($root, 'Start hidden application runtime')) {
                Start-ReadyRuntime
            }
        }
        'Restart' {
            if ($PSCmdlet.ShouldProcess($root, 'Drain the authenticated runtime and start its replacement')) {
                $status = Read-RuntimeStatus
                if (-not $status -or $status.state -ne 'running' -or -not $status.runtimePid -or $status.runtimePid -le 0) { throw 'Restart requires an authenticated running runtime with a known process identity. Use Status; no replacement was launched.' }
                $owned = Get-Process -Id $status.runtimePid -ErrorAction Stop
                try {
                    $stopped = & $startupHost -InstallRoot $root -ConfigFile $config -NodePath $node -Mode Stop -ControlTimeoutSeconds $controlSeconds
                    if ($LASTEXITCODE -ne 0) { throw 'Authenticated runtime shutdown failed; no replacement was launched.' }
                    $shutdown = $stopped | ConvertFrom-Json
                    if ($shutdown.runtimePid -ne $status.runtimePid) { throw 'Runtime ownership changed during shutdown; no replacement was launched.' }
                    if (-not $owned.WaitForExit($TimeoutSeconds * 1000)) { throw 'Runtime shutdown timed out; no replacement was launched and no process was forcibly killed.' }
                } finally { $owned.Dispose() }
                Start-ReadyRuntime
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
