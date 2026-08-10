<#
.SYNOPSIS
  Arrow-key menu for the commands this repo is driven by.

.DESCRIPTION
  Every command lives in ONE table below ($Menu). Nothing is duplicated into a
  profile function, a README or a second launcher -- add a row here and it is in
  the menu, and it is the only place to look for what exists.

  ASCII ONLY, deliberately. Windows PowerShell 5.1 parses a .ps1 that carries no
  byte-order mark as CP1252, so a box-drawing dash or an arrow glyph written by a
  UTF-8 editor renders as mojibake. Colour survives any encoding; glyphs do not.

.PARAMETER List
  Print the menu as flat text and exit. No keyboard, no screen clearing -- this
  is the branch that can be run from a script, a pipe, or a CI check, none of
  which have a console to read a key from.

.EXAMPLE
  .\scripts\menu.ps1
  .\scripts\menu.ps1 -List
#>
[CmdletBinding()]
param([switch]$List)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------- item builders

function New-MenuHeader {
    param([string]$Text)
    [pscustomobject]@{ Kind = 'header'; Label = $Text; Desc = ''; Cmd = $null; Items = $null }
}

function New-MenuCommand {
    param([string]$Label, [string]$Cmd, [string]$Desc = '')
    [pscustomobject]@{ Kind = 'cmd'; Label = $Label; Desc = $Desc; Cmd = $Cmd; Items = $null }
}

function New-MenuSubmenu {
    param([string]$Label, [object[]]$Items, [string]$Desc = '')
    [pscustomobject]@{ Kind = 'sub'; Label = $Label; Desc = $Desc; Cmd = $null; Items = $Items }
}

# ------------------------------------------------------------------- the checks
# Both audit scripts advertise their own check names through --help. They are
# spelled out here rather than parsed at startup: parsing would cost two python
# launches every time the menu opens, and a check that disappears should be a
# visible edit to this file, not a row that silently stops appearing.

$LayoutChecks = @(
    'autofill', 'caps-input', 'created-by-data', 'created-columns', 'dup-check',
    'editor-clone', 'field-track', 'picker-inactive', 'picker-perms',
    'required-hold', 'row-actions', 'screen-grid', 'screen-table',
    'spell-suggest', 'stored-select', 'text-size-noop', 'toolbar-size',
    'truncate-reveal'
)

$KeyboardChecks = @(
    'combobox-tab', 'dialog-escape', 'dup-hold', 'grid-td',
    'listbox-propagation', 'overlay-guard', 'picker-trigger', 'tab-fields',
    'tab-local', 'tab-page-form', 'unsaved-guard'
)

$KeyboardAudit = '.claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py'

$layoutItems = @(New-MenuHeader 'layout (doc/ui/LAYOUT.md)')
$layoutItems += New-MenuCommand 'ALL layout checks' 'python scripts/audit_layout.py . --quiet' 'every check, findings only'
foreach ($c in $LayoutChecks) {
    $layoutItems += New-MenuCommand $c "python scripts/audit_layout.py . --check $c --quiet"
}

$keyboardItems = @(New-MenuHeader 'keyboard contract')
$keyboardItems += New-MenuCommand 'ALL keyboard checks' "python $KeyboardAudit . --quiet" 'every check, findings only'
foreach ($c in $KeyboardChecks) {
    $keyboardItems += New-MenuCommand $c "python $KeyboardAudit . --check $c --quiet"
}

# ----------------------------------------------------------------- the top menu

$Menu = @(
    New-MenuHeader 'sessions'
    New-MenuCommand 'claude sessions'  '.\scripts\sessions.ps1'        'live panel, q to come back'
    New-MenuCommand 'sessions (once)'  '.\scripts\sessions.ps1 -List'  'print and return'

    New-MenuHeader 'run'
    New-MenuCommand 'dev'          'npm run dev'          'next dev'
    New-MenuCommand 'build'        'npm run build'        'next build --webpack'
    New-MenuCommand 'build:check'  'npm run build:check'  'scripts/build-check.mjs'
    New-MenuCommand 'lint'         'npm run lint'         'eslint'

    New-MenuHeader 'checks'
    New-MenuCommand 'check:nav'             'npm run check:nav'             'sidebar groups + hubs'
    New-MenuCommand 'check:names'           'npm run check:names'           'spell-suggest boundary'
    New-MenuCommand 'check:amendment-diff'  'npm run check:amendment-diff'  'order amendment vectors'
    New-MenuCommand 'keyboard holds'        'node --experimental-strip-types scripts/check-keyboard-holds.mts'  'keyFills vectors'
    New-MenuCommand 'tsc --noEmit'          'npx tsc --noEmit'              'type check only'

    New-MenuHeader 'audits'
    New-MenuSubmenu 'layout audit...'    $layoutItems    "$($LayoutChecks.Count) checks"
    New-MenuSubmenu 'keyboard audit...'  $keyboardItems  "$($KeyboardChecks.Count) checks"

    New-MenuHeader 'git'
    New-MenuCommand 'status'    'git status --short --branch'
    New-MenuCommand 'log'       'git log --oneline --decorate -15'
    New-MenuCommand 'diffstat'  'git diff --stat'
)

# ------------------------------------------------------------------- -List mode

function Write-MenuList {
    param([object[]]$Items, [string]$Prefix = '')
    foreach ($it in $Items) {
        switch ($it.Kind) {
            'header' { Write-Output ''; Write-Output "$Prefix[$($it.Label)]" }
            'cmd'    { Write-Output ("{0}  {1,-24} {2}" -f $Prefix, $it.Label, $it.Cmd) }
            'sub'    {
                Write-Output ("{0}  {1,-24} ({2})" -f $Prefix, $it.Label, $it.Desc)
                Write-MenuList -Items $it.Items -Prefix "$Prefix    "
            }
        }
    }
}

if ($List) {
    Write-Output "raagam menu -- $RepoRoot"
    Write-MenuList -Items $Menu
    Write-Output ''
    return
}

# ---------------------------------------------------------------------- running

<#
  POST-RUN POLICY -- this is the decision the menu's feel hangs on.

  TODO(you): decide what happens after a command finishes, and write it here.

  The default below is the dumb one: always pause for a key, always go back to
  the menu. It is wrong in at least two ways and you know your own habits best:

    * `npm run dev` never "finishes" -- you Ctrl+C it. Pausing afterwards puts a
      pointless "press any key" between you and your prompt.
    * A check that passes has nothing to read. Pausing on a clean `check:nav` is
      a keystroke tax on the good case; pausing on a FAILING one is the whole
      point, because the findings scroll away otherwise.

  Things you can read to decide: $LASTEXITCODE (0 = passed), and $Item.Label /
  $Item.Cmd if you want to special-case the long-running ones.

  Trade-off: pausing only on failure is fast but silently returns you to a
  cleared screen on success, so you never see the "0 findings" line that tells
  you it actually ran. Pausing always is slower but never hides an outcome.
#>
function Invoke-MenuItem {
    param([pscustomobject]$Item)

    Clear-Host
    Write-Host "  $($Item.Cmd)" -ForegroundColor Cyan
    Write-Host ''

    Push-Location $RepoRoot
    try {
        $global:LASTEXITCODE = 0
        Invoke-Expression $Item.Cmd
    } catch {
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        Pop-Location
    }

    # POST-RUN POLICY
    # Failure blocks; success does not. A failing check's findings are the whole
    # reason to be here and must not scroll away, so that case waits for a key.
    # A passing one still gets a couple of seconds -- long enough to see the
    # "0 findings" line that proves it RAN rather than crashed, short enough that
    # a clean run costs no keystroke. Any key skips the wait.
    Write-Host ''
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED (exit $LASTEXITCODE) -- press any key" -ForegroundColor Red
        [void][Console]::ReadKey($true)
    } else {
        Write-Host '  ok -- returning (any key to skip the wait)' -ForegroundColor DarkGreen
        $until = (Get-Date).AddMilliseconds(2500)
        while ((Get-Date) -lt $until) {
            if ([Console]::KeyAvailable) { [void][Console]::ReadKey($true); break }
            Start-Sleep -Milliseconds 80
        }
    }
}

# --------------------------------------------------------------------- the menu

function Get-MenuBranch {
    try { (git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null) } catch { $null }
}

function Show-MenuScreen {
    param([object[]]$Items, [int]$Selected, [string]$Title, [string]$Branch)

    Clear-Host
    Write-Host ''
    Write-Host "  $Title" -ForegroundColor White -NoNewline
    if ($Branch) { Write-Host "  ($Branch)" -ForegroundColor DarkGray } else { Write-Host '' }
    Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray

    for ($i = 0; $i -lt $Items.Count; $i++) {
        $it = $Items[$i]
        if ($it.Kind -eq 'header') {
            Write-Host ''
            Write-Host "   $($it.Label)" -ForegroundColor DarkYellow
            continue
        }
        $label = $it.Label
        if ($it.Kind -eq 'sub') { $label = "$label" }

        if ($i -eq $Selected) {
            Write-Host ('  > ' + $label.PadRight(26)) -ForegroundColor Black -BackgroundColor Gray -NoNewline
            Write-Host "  $($it.Desc)" -ForegroundColor DarkGray
        } else {
            Write-Host ('    ' + $label.PadRight(26)) -ForegroundColor Gray -NoNewline
            Write-Host "  $($it.Desc)" -ForegroundColor DarkGray
        }
    }

    Write-Host ''
    Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray
    Write-Host '  Up/Down move   Enter run   Esc/q back   / filter' -ForegroundColor DarkGray
}

function Move-MenuSelection {
    param([object[]]$Items, [int]$From, [int]$Step)
    $i = $From
    for ($n = 0; $n -lt $Items.Count; $n++) {
        $i = ($i + $Step + $Items.Count) % $Items.Count
        if ($Items[$i].Kind -ne 'header') { return $i }
    }
    return $From
}

function Show-Menu {
    param([object[]]$Items, [string]$Title)

    $branch = Get-MenuBranch
    $sel = Move-MenuSelection -Items $Items -From -1 -Step 1

    while ($true) {
        Show-MenuScreen -Items $Items -Selected $sel -Title $Title -Branch $branch
        $key = [Console]::ReadKey($true)

        switch ($key.Key) {
            'UpArrow'   { $sel = Move-MenuSelection -Items $Items -From $sel -Step -1 }
            'DownArrow' { $sel = Move-MenuSelection -Items $Items -From $sel -Step 1 }
            'Home'      { $sel = Move-MenuSelection -Items $Items -From -1 -Step 1 }
            'End'       { $sel = Move-MenuSelection -Items $Items -From 0 -Step -1 }
            'Escape'    { return }
            'Enter' {
                $it = $Items[$sel]
                if ($it.Kind -eq 'sub') {
                    Show-Menu -Items $it.Items -Title "$Title / $($it.Label)"
                } else {
                    Invoke-MenuItem -Item $it
                }
            }
            default {
                if ($key.KeyChar -eq 'q') { return }
                # Type a letter to jump to the next item starting with it -- the
                # poor relation of fuzzy filtering, but it costs nothing and it
                # is how every native Windows list box already behaves.
                if ($key.KeyChar -match '[a-z0-9:]') {
                    $ch = [string]$key.KeyChar
                    for ($n = 1; $n -le $Items.Count; $n++) {
                        $i = ($sel + $n) % $Items.Count
                        if ($Items[$i].Kind -ne 'header' -and $Items[$i].Label.StartsWith($ch, 'InvariantCultureIgnoreCase')) {
                            $sel = $i
                            break
                        }
                    }
                }
            }
        }
    }
}

Show-Menu -Items $Menu -Title 'RAAGAM'
