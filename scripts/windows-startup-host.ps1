[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$ConfigFile,
    [Parameter(Mandatory)][string]$NodePath,
    [ValidateSet('Run', 'Launch', 'Validate', 'Status', 'Stop', 'Version')][string]$Mode = 'Run',
    [ValidateRange(1, 60)][int]$ControlTimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows is required.' }
    $root = (Resolve-Path -LiteralPath $InstallRoot).Path
    $config = (Resolve-Path -LiteralPath $ConfigFile).Path
    $node = (Resolve-Path -LiteralPath $NodePath).Path
    $runtime = Join-Path $root 'dist\scripts\runtime.js'
    if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw 'Compiled runtime missing.' }
    foreach ($path in @($root, $config, $runtime, $node)) {
        if ($path.Contains('"')) { throw 'Quote characters are not allowed in paths.' }
    }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $node
    $info.WorkingDirectory = $root
    $command = if ($Mode -eq 'Run') { 'start' } else { $Mode.ToLowerInvariant() }
    $info.Arguments = if ($Mode -eq 'Version') { '--version' } else { "`"$runtime`" $command --config `"$config`"" }
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.EnvironmentVariables.Clear()
    foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
        if ($entry.Key -match '^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$') {
            $info.EnvironmentVariables[$entry.Key] = [string]$entry.Value
        }
    }
    $info.EnvironmentVariables['AUTOPILOT_SKIP_ENV_FILE'] = '1'
    $info.RedirectStandardOutput = $Mode -ne 'Run'
    $process = [System.Diagnostics.Process]::Start($info)
    try {
        if ($Mode -eq 'Run') { $process.WaitForExit() }
        else {
            # Control replies are one line; EOF may remain held by a descendant.
            $reply = $process.StandardOutput.ReadLineAsync()
            if (-not $process.WaitForExit($ControlTimeoutSeconds * 1000)) {
                # Only this owned control client is stopped, never its runtime child.
                $process.Kill()
                [void]$process.WaitForExit(5000)
                throw 'Runtime control client exceeded its deadline.'
            }
            if (-not $reply.Wait(1000)) { throw 'Runtime control reply exceeded its deadline.' }
            $output = $reply.Result
        }
        $code = $process.ExitCode
        if ($Mode -ne 'Run' -and $code -eq 0) {
            if (-not $output) { throw 'Runtime control reply is missing.' }
            Write-Output $output.TrimEnd()
        }
    } finally { $process.Dispose() }
    exit $code
} catch {
    Write-Error 'Windows runtime host failed; check the compiled installation and explicit private configuration.'
    exit 1
}
