#Requires -Version 7
<#
.SYNOPSIS
  PostToolUse — runs prettier + eslint --fix on edited JS/TS/CSS/MD/JSON files.
  Uses npx --no-install so it only runs when the project already has these deps.
#>
$ErrorActionPreference = 'SilentlyContinue'

try { $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }

$path = $payload.tool_input.file_path
if (-not $path) { exit 0 }
if ($path -notmatch '\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|yml|yaml)$') { exit 0 }
if (-not (Test-Path -LiteralPath $path)) { exit 0 }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { exit 0 }

& npx --no-install prettier --write --log-level error $path 2>&1 | Out-Null

# ESLint only for JS/TS source files, not JSON/CSS/MD
if ($path -match '\.(ts|tsx|js|jsx|mjs|cjs)$') {
  & npx --no-install eslint --fix --quiet $path 2>&1 | Out-Null
}

exit 0
