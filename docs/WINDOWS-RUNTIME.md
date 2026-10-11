# Windows Runtime

The local runtime uses the compiled application, not VS Code or a development
server. P13 installation/soak acceptance and P17 release packaging remain open.
Use Node 24 and the repository's pinned dependencies, then `corepack pnpm build`.

Keep a reviewed local-profile config in an owner-protected, non-synced location.
It must select `AUTOPILOT_PROFILE=local`, a private data directory outside the
repository, and a valid owner token. Keys and vault material stay in that file,
never in command arguments or Git. The launcher does not create authorization.
External submission still requires its existing explicit switch, standing policy,
valid documents, supported adapter and deterministic final-dispatch checks.

```powershell
.\scripts\windows-runtime.ps1 -Mode Start -ConfigFile C:\Private\OpenCareers\runtime.env
.\scripts\windows-runtime.ps1 -Mode Status -ConfigFile C:\Private\OpenCareers\runtime.env
.\scripts\windows-runtime.ps1 -Mode Stop -ConfigFile C:\Private\OpenCareers\runtime.env
```

Start is hidden. Stop drains outstanding work; an action already sent cannot
be recalled. Unknown outcomes reconcile read-only, never by replaying final clicks.
Startup registration must be explicitly reviewed and approved:

```powershell
.\scripts\windows-runtime.ps1 -Mode InstallStartup -ConfigFile C:\Private\OpenCareers\runtime.env -ApproveStartup -WhatIf
.\scripts\windows-runtime.ps1 -Mode InstallStartup -ConfigFile C:\Private\OpenCareers\runtime.env -ApproveStartup
.\scripts\windows-runtime.ps1 -Mode RemoveStartup -ConfigFile C:\Private\OpenCareers\runtime.env -ApproveStartup
```

The task uses the current interactive user at logon, limited privileges and
bounded retry. Removal does not stop an already-running application. Protect
the installation and config directory with owner/SYSTEM filesystem permissions;
the launcher does not assert that P15 filesystem/security verification is closed.
Private installs are not automatically updated when development code changes.

For foreground diagnosis or local control without PowerShell:

```powershell
node dist/scripts/runtime.js start --config C:\Private\OpenCareers\runtime.env
node dist/scripts/runtime.js status --config C:\Private\OpenCareers\runtime.env
node dist/scripts/runtime.js stop --config C:\Private\OpenCareers\runtime.env
```

Runtime metadata is in the configured data directory's `.runtime` folder. Logs
retain lifecycle metadata/error codes only and rotate at a bounded size. A stale
dead-process record can recover; live ownership, port collisions, future/corrupt
metadata and redirected data paths fail closed. Do not delete metadata to bypass
an active owner. Server/hybrid deployment remains a separate installation path.
