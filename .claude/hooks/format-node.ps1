#Requires -Version 7
<#
.SYNOPSIS
  PostToolUse — runs prettier + eslint --fix on edited JS/TS/CSS/MD/JSON files.
  Runs the PROJECT'S OWN copies only.

.DESCRIPTION
  `npx --no-install` is NOT "local only". It skips the install prompt but still
  resolves a GLOBAL binary from PATH, so in a repo that ships neither tool the
  machine's own prettier reformatted every edited file to its own defaults --
  80 columns into a codebase written at 100, which turned a three-line edit
  into a whole-file diff and buried the real change (lodge-donation-tracker
  #18). A globally installed eslint of a different major is the same trap.

  So each tool is located before it is run, and a repo that does not ship one
  is left alone -- which is what this hook always claimed to do.
#>
$ErrorActionPreference = 'SilentlyContinue'

try { $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }

$path = $payload.tool_input.file_path
if (-not $path) { exit 0 }
if ($path -notmatch '\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|yml|yaml)$') { exit 0 }
if (-not (Test-Path -LiteralPath $path)) { exit 0 }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { exit 0 }

# Absolute, so the walk below and the tool invocation agree on what is being
# formatted even after Push-Location.
$path = (Resolve-Path -LiteralPath $path).Path

# The nearest directory at or above the edited file that owns node_modules/<Name>.
# Walking up, rather than testing the repo root, is what makes this correct in a
# monorepo: a package's own copy wins over the workspace root's.
function Get-ToolRoot {
    param([string]$StartDir, [string]$Name)
    $dir = $StartDir
    while ($dir) {
        if (Test-Path -LiteralPath (Join-Path $dir "node_modules/$Name")) { return $dir }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { return $null }
        $dir = $parent
    }
    return $null
}

# Run a tool only when the project actually owns one, and run it FROM the
# directory that owns it, so npx resolves that copy and can never fall through
# to the global install.
function Invoke-LocalTool {
    param([string]$Name, [string]$File, [string[]]$ToolArgs)
    $root = Get-ToolRoot -StartDir (Split-Path -Parent $File) -Name $Name
    if (-not $root) { return }
    Push-Location $root
    try { & npx --no-install $Name @ToolArgs $File 2>&1 | Out-Null }
    finally { Pop-Location }
}

Invoke-LocalTool -Name 'prettier' -File $path -ToolArgs @('--write', '--log-level', 'error')

# ESLint only for JS/TS source files, not JSON/CSS/MD
if ($path -match '\.(ts|tsx|js|jsx|mjs|cjs)$') {
  Invoke-LocalTool -Name 'eslint' -File $path -ToolArgs @('--fix', '--quiet')
}

exit 0
