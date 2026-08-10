<#
.SYNOPSIS
  Live panel of running Claude Code sessions, like a chat list.

.DESCRIPTION
  Data source: %USERPROFILE%\.claude\sessions\<pid>.json. Every running Claude
  Code process registers itself there and keeps a `status` field up to date.
  The files are removed on exit, so the directory IS the live set -- 109
  transcripts exist for this repo and only the running sessions have a file.

  ASCII only, on purpose: Windows PowerShell 5.1 parses a BOM-less .ps1 as
  CP1252, so box-drawing and arrow glyphs would render as mojibake. Colour
  carries the meaning instead.

.PARAMETER List
  Print once as plain text and exit. No console keys, no screen clearing --
  the branch that survives being piped, scripted, or run without a terminal.

.PARAMETER IntervalMs
  Refresh period for the live panel.

.EXAMPLE
  .\scripts\sessions.ps1
  .\scripts\sessions.ps1 -List
#>
[CmdletBinding()]
param([switch]$List, [int]$IntervalMs = 1000)

$ErrorActionPreference = 'Stop'

$SessionDir = Join-Path $env:USERPROFILE '.claude\sessions'
$StatusLog  = Join-Path $env:LOCALAPPDATA 'raagam-session-panel\status-seen.json'

# =============================================================== LAYER 1: data
# Pure. Returns objects, never writes to the screen. The panel, -List, and any
# later Cursor-sidebar wrapper all read THIS -- which is the whole reason it
# contains no colour and no Write-Host.

function Get-CurrentSessionPid {
    <#
      Which registered session, if any, is the one WE are running inside?
      Walk our own ancestry looking for a pid the registry knows. Computed once
      at startup, never per refresh: each level costs a CIM query.
    #>
    param([int[]]$KnownPids)
    $id = $PID
    for ($hop = 0; $hop -lt 6; $hop++) {
        if ($KnownPids -contains $id) { return $id }
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
        if (-not $proc -or -not $proc.ParentProcessId) { break }
        $id = [int]$proc.ParentProcessId
    }
    return 0
}

function Test-SessionAlive {
    <#
      Liveness is NOT "does this pid exist". Windows recycles pids, so a stale
      file from a crashed session can name a pid now held by something else --
      and the panel would show a dead session as running forever.

      procStart in the file equals Process.StartTime.ToFileTime() exactly
      (verified against both live sessions), so comparing it proves the live
      pid is the SAME process that wrote the file.
    #>
    param([pscustomobject]$Registry)

    $proc = Get-Process -Id $Registry.pid -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }

    if (-not $Registry.procStart) {
        # Older CLI versions wrote no procStart. Fall back to the weaker test
        # rather than declaring every such session stale.
        return ($proc.ProcessName -eq 'claude')
    }

    try {
        return ([string]$proc.StartTime.ToFileTime() -eq [string]$Registry.procStart)
    } catch {
        # StartTime throws Access Denied on processes we cannot open.
        return ($proc.ProcessName -eq 'claude')
    }
}

function ConvertFrom-EpochMs {
    param($Ms)
    if (-not $Ms) { return $null }
    return [datetimeoffset]::FromUnixTimeMilliseconds([long]$Ms).LocalDateTime
}

function Get-ClaudeSession {
    [CmdletBinding()]
    param()

    if (-not (Test-Path $SessionDir)) { return @() }

    $now  = Get-Date
    $rows = @()

    foreach ($file in Get-ChildItem $SessionDir -Filter *.json -File -ErrorAction SilentlyContinue) {
        $reg = $null
        try { $reg = Get-Content $file.FullName -Raw -ErrorAction Stop | ConvertFrom-Json } catch { continue }
        if (-not $reg.pid) { continue }

        $alive     = Test-SessionAlive -Registry $reg
        $startedAt = ConvertFrom-EpochMs $reg.startedAt
        $statusAt  = ConvertFrom-EpochMs $reg.statusUpdatedAt

        $rows += [pscustomobject]@{
            Name       = if ($reg.name) { $reg.name } else { '(unnamed)' }
            Status     = if ($reg.status) { [string]$reg.status } else { 'unknown' }
            SessionId  = [string]$reg.sessionId
            Pid        = [int]$reg.pid
            Cwd        = [string]$reg.cwd
            Project    = if ($reg.cwd) { Split-Path $reg.cwd -Leaf } else { '' }
            Version    = [string]$reg.version
            Kind       = [string]$reg.kind
            StartedAt  = $startedAt
            IsStale    = (-not $alive)
            Age        = if ($startedAt) { $now - $startedAt } else { [timespan]::Zero }
            QuietFor   = if ($statusAt)  { $now - $statusAt }  else { [timespan]::Zero }
        }
    }

    # ORDERING IS DECIDED HERE, ONCE, AND IT IS DELIBERATELY NOT STATUS-BASED.
    # Sorting by "how much this row needs you" reorders the list while you are
    # looking at it -- the row you were about to act on moves as a status flips.
    # startedAt never changes, so a session holds its line for its whole life and
    # a new one appends at the bottom. At N<=6 you scan the whole panel anyway,
    # so stability is worth more than putting the loud row on top.
    return $rows | Sort-Object StartedAt
}

# =============================================================== LAYER 2: view
# Appearance only. Returns no ordering -- see the note above.

function Format-SessionRow {
    param([string]$Status, [bool]$IsStale)

    if ($IsStale) {
        return [pscustomobject]@{ Glyph = 'x'; Color = 'DarkRed'; Label = 'stale' }
    }
    switch ($Status) {
        'busy' { return [pscustomobject]@{ Glyph = '*'; Color = 'Yellow';   Label = 'busy' } }
        'idle' { return [pscustomobject]@{ Glyph = '-'; Color = 'DarkGray'; Label = 'idle' } }
        default {
            # An UNKNOWN status prints its raw text in a colour the known set
            # never uses. `status` is an internal field with no compatibility
            # promise, so a CLI update that renames it must look NEW here, not
            # invisible and not like an error. A closed `switch` with no default
            # would silently drop the very thing worth noticing.
            return [pscustomobject]@{ Glyph = '?'; Color = 'Magenta'; Label = $Status }
        }
    }
}

function Format-Span {
    param([timespan]$Span)
    if ($Span.TotalSeconds -lt 60)  { return ('{0}s'     -f [int]$Span.TotalSeconds) }
    if ($Span.TotalMinutes -lt 60)  { return ('{0}m'     -f [int]$Span.TotalMinutes) }
    if ($Span.TotalHours -lt 24)    { return ('{0}h{1:00}' -f [int]$Span.TotalHours, $Span.Minutes) }
    return ('{0}d' -f [int]$Span.TotalDays)
}

# ==================================================== M3: status value discovery
# `busy` is the only value observed so far, and nothing documents the rest. So
# record every distinct value seen, with first/last sighting and a count. After
# a few days of real use this file answers -- from evidence -- whether a session
# waiting on a permission prompt reports something other than `busy`, which is
# what decides whether transcript parsing is worth building at all.

function Register-StatusValue {
    param([string[]]$Statuses)
    if (-not $Statuses) { return }
    try {
        $dir = Split-Path $StatusLog -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

        $seen = @{}
        if (Test-Path $StatusLog) {
            $raw = Get-Content $StatusLog -Raw | ConvertFrom-Json
            foreach ($p in $raw.PSObject.Properties) { $seen[$p.Name] = $p.Value }
        }
        $stamp = (Get-Date).ToString('s')
        foreach ($s in ($Statuses | Select-Object -Unique)) {
            if ($seen.ContainsKey($s)) {
                $seen[$s].lastSeen = $stamp
                $seen[$s].count    = [int]$seen[$s].count + 1
            } else {
                $seen[$s] = [pscustomobject]@{ firstSeen = $stamp; lastSeen = $stamp; count = 1 }
            }
        }
        $seen | ConvertTo-Json -Depth 4 | Set-Content -Path $StatusLog -Encoding utf8
    } catch {
        # Discovery is a nicety. It must never take the panel down with it.
    }
}

# ============================================================== -List (no TTY)

if ($List) {
    $sessions = Get-ClaudeSession
    Register-StatusValue -Statuses ($sessions | ForEach-Object { $_.Status })

    Write-Output "claude sessions -- $($sessions.Count) registered"
    Write-Output ''
    if (-not $sessions) { Write-Output '  (none running)'; return }
    foreach ($s in $sessions) {
        $v = Format-SessionRow -Status $s.Status -IsStale $s.IsStale
        Write-Output ("  {0} {1,-30} {2,-9} {3,-5} {4,-18} pid {5}" -f `
            $v.Glyph, $s.Name, $v.Label, (Format-Span $s.Age), $s.Project, $s.Pid)
        Write-Output ("      {0}" -f $s.Cwd)
        Write-Output ("      claude --resume {0}" -f $s.SessionId)
    }
    Write-Output ''
    Write-Output "status values seen so far: $StatusLog"
    return
}

# ============================================================= LAYER 3: the panel

function Show-SessionPanel {
    param([int]$IntervalMs)

    $sessions   = @()
    $selectedId = $null
    $notice     = ''
    $currentPid = 0
    $primed     = $false
    $nextPoll   = [datetime]::MinValue

    while ($true) {
        if ((Get-Date) -ge $nextPoll) {
            $sessions = @(Get-ClaudeSession)
            $nextPoll = (Get-Date).AddMilliseconds($IntervalMs)
            Register-StatusValue -Statuses ($sessions | ForEach-Object { $_.Status })

            if (-not $primed) {
                $currentPid = Get-CurrentSessionPid -KnownPids ($sessions | ForEach-Object { $_.Pid })
                $primed = $true
            }

            # Selection is kept BY SESSION ID, not by index. A row appearing or
            # disappearing on refresh would otherwise slide the highlight onto a
            # different session between a glance and a keypress.
            if ($sessions.Count -gt 0) {
                $stillThere = $sessions | Where-Object { $_.SessionId -eq $selectedId }
                if (-not $stillThere) { $selectedId = $sessions[0].SessionId }
            } else {
                $selectedId = $null
            }

            Write-SessionScreen -Sessions $sessions -SelectedId $selectedId -CurrentPid $currentPid -Notice $notice
        }

        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            $idx = 0
            for ($i = 0; $i -lt $sessions.Count; $i++) {
                if ($sessions[$i].SessionId -eq $selectedId) { $idx = $i }
            }

            $handled = $true
            switch ($key.Key) {
                'UpArrow'   { if ($sessions.Count) { $selectedId = $sessions[(($idx - 1 + $sessions.Count) % $sessions.Count)].SessionId } }
                'DownArrow' { if ($sessions.Count) { $selectedId = $sessions[(($idx + 1) % $sessions.Count)].SessionId } }
                'Escape'    { Clear-Host; return }
                'Enter' {
                    if ($sessions.Count) {
                        $cmd = "claude --resume $($sessions[$idx].SessionId)"
                        try {
                            Set-Clipboard -Value $cmd
                            $notice = "copied: $cmd"
                        } catch {
                            $notice = $cmd
                        }
                    }
                }
                default { $handled = $false }
            }

            if (-not $handled) {
                if ($key.KeyChar -eq 'q') { Clear-Host; return }
                if ($key.KeyChar -eq 'r') { $nextPoll = [datetime]::MinValue; $notice = '' }
                if ($key.KeyChar -eq 'd' -and $sessions.Count) {
                    try {
                        Set-Clipboard -Value $sessions[$idx].Cwd
                        $notice = "copied: $($sessions[$idx].Cwd)"
                    } catch { $notice = $sessions[$idx].Cwd }
                }
            }

            $nextPoll = [datetime]::MinValue
        }

        Start-Sleep -Milliseconds 120
    }
}

function Write-SessionScreen {
    param([object[]]$Sessions, [string]$SelectedId, [int]$CurrentPid, [string]$Notice)

    Clear-Host
    Write-Host ''
    Write-Host '  CLAUDE SESSIONS' -ForegroundColor White -NoNewline
    Write-Host ("    {0}   {1} running" -f (Get-Date).ToString('HH:mm:ss'), $Sessions.Count) -ForegroundColor DarkGray
    Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray

    if (-not $Sessions -or $Sessions.Count -eq 0) {
        Write-Host ''
        Write-Host '   no sessions running' -ForegroundColor DarkGray
        Write-Host '   (a session registers itself on start and removes itself on exit)' -ForegroundColor DarkGray
    }

    foreach ($s in $Sessions) {
        $v   = Format-SessionRow -Status $s.Status -IsStale $s.IsStale
        $sel = ($s.SessionId -eq $SelectedId)
        $me  = ($s.Pid -eq $CurrentPid -and $CurrentPid -ne 0)

        $marker = if ($sel) { '>' } else { ' ' }
        $name   = $s.Name
        if ($name.Length -gt 28) { $name = $name.Substring(0, 27) + '.' }

        Write-Host ''
        Write-Host ("  {0} {1} " -f $marker, $v.Glyph) -ForegroundColor $v.Color -NoNewline
        if ($sel) {
            Write-Host (' ' + $name.PadRight(29)) -ForegroundColor Black -BackgroundColor Gray -NoNewline
        } else {
            Write-Host (' ' + $name.PadRight(29)) -ForegroundColor White -NoNewline
        }
        Write-Host ("{0,-9}" -f $v.Label) -ForegroundColor $v.Color -NoNewline
        Write-Host ("{0,-6}" -f (Format-Span $s.Age)) -ForegroundColor DarkGray -NoNewline
        if ($me) { Write-Host '(this one)' -ForegroundColor DarkCyan } else { Write-Host '' }

        Write-Host ("        {0}" -f $s.Cwd) -ForegroundColor DarkGray -NoNewline
        Write-Host ("   quiet {0}" -f (Format-Span $s.QuietFor)) -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray
    if ($Notice) { Write-Host "  $Notice" -ForegroundColor Green }
    Write-Host '  Up/Down select   Enter copy resume cmd   d copy cwd   r refresh   q quit' -ForegroundColor DarkGray
}

Show-SessionPanel -IntervalMs $IntervalMs
