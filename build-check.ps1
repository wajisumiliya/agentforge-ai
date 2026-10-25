# Run the complete AgentForge build and test suite on Windows.
# Usage: powershell -ExecutionPolicy Bypass -File .\build-check.ps1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Require-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name is not installed or not on PATH."
    }
}
function Run-Step([string]$label, [scriptblock]$action) {
    Write-Host ""
    Write-Host "=== $label ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $action
    if (-not $?) { throw "$label failed to execute" }
    if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE" }
}
Require-Command node
Require-Command npm
Require-Command python

Run-Step 'Frontend dependency installation' { npm install --no-audit --no-fund }
Run-Step 'React TypeScript production build' { npm run build }
Run-Step 'Node API syntax check' { node --check server/index.js }

Push-Location (Join-Path $root 'server')
try {
    Run-Step 'Node API dependency installation' { npm install --no-audit --no-fund }
} finally { Pop-Location }

Run-Step 'Node integration tests' { node --test server/tests/api.integration.test.mjs }

Push-Location (Join-Path $root 'ai')
try {
    Run-Step 'Python AI dependency installation' { python -m pip install -r requirements.txt }
    Run-Step 'Python compile check' { python -m compileall -q . }
    Run-Step 'Python AI unit tests' { python -m unittest discover -p 'test_*.py' -v }
} finally { Pop-Location }

Write-Host ""
Write-Host 'PASS: Frontend build, Node tests, and Python tests completed.' -ForegroundColor Green
Write-Host 'NOTE: This does not verify live Ollama inference.' -ForegroundColor Yellow
