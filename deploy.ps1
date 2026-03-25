# Zeus Terminal - VPS Deployment Script
# Usage: .\deploy.ps1 [-SkipTests] [-DryRun]
# Deploys from local to Hetzner VPS via SCP/SSH
param(
    [switch]$SkipTests,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ── Configuration ──
$VPS_HOST = '178.104.64.124'
$VPS_USER = 'root'
$VPS_PATH = '/root/zeus-terminal'
$SSH = "ssh ${VPS_USER}@${VPS_HOST}"
$LOCAL_PATH = $PSScriptRoot

Write-Host "`n===== Zeus Terminal - VPS Deploy =====" -ForegroundColor Cyan

# ── Step 1: Pre-flight tests ──
if (-not $SkipTests) {
    Write-Host "[1/7] Running pre-flight tests..." -ForegroundColor Yellow
    $testResult = & node "$LOCAL_PATH\test-p6-live.js" 2>&1
    $testExit = $LASTEXITCODE
    if ($testExit -ne 0) {
        Write-Host "TESTS FAILED - aborting deploy" -ForegroundColor Red
        $testResult | Select-Object -Last 10 | ForEach-Object { Write-Host $_ }
        exit 1
    }
    $passLine = ($testResult | Select-String -Pattern 'RESULTS:' | Select-Object -Last 1).Line
    Write-Host "  $passLine" -ForegroundColor Green
} else {
    Write-Host "`n[1/7] Skipping tests (--SkipTests)" -ForegroundColor DarkYellow
}

# ── Step 2: Check VPS connectivity ──
Write-Host "`n[2/7] Checking VPS connectivity..." -ForegroundColor Yellow
try {
    $connectivity = & $SSH.Split(' ')[0] $SSH.Split(' ')[1] "echo ok" 2>&1
    if ($connectivity -notmatch 'ok') { throw "SSH failed" }
    Write-Host "  VPS reachable" -ForegroundColor Green
} catch {
    Write-Host "  Cannot reach VPS at ${VPS_HOST} - check SSH key/connectivity" -ForegroundColor Red
    exit 1
}

# ── Step 3: Backup current VPS version ──
Write-Host "`n[3/7] Backing up current VPS version..." -ForegroundColor Yellow
if (-not $DryRun) {
    & ssh "${VPS_USER}@${VPS_HOST}" 'rm -rf /root/zeus-terminal.bak; cp -r /root/zeus-terminal /root/zeus-terminal.bak 2>/dev/null; true'
    Write-Host "  VPS backup saved to ${VPS_PATH}.bak" -ForegroundColor Green
} else {
    Write-Host "  DRY RUN - would backup ${VPS_PATH} to ${VPS_PATH}.bak" -ForegroundColor DarkGray
}

# ── Step 4: Rsync files ──
Write-Host "`n[4/7] Syncing files to VPS..." -ForegroundColor Yellow
$EXCLUDE = @(
    '--exclude=node_modules',
    '--exclude=.git',
    '--exclude=.env',
    '--exclude=/data/',
    '--exclude=*.log',
    '--exclude=android/',
    '--exclude=ares-results.txt',
    '--exclude=*.pre_ncv*',
    '--exclude=*.pre_neural*'
)

$rsyncCmd = "rsync -avz --delete $($EXCLUDE -join ' ') `"$($LOCAL_PATH.Replace('\','/'))/`" `"${VPS_USER}@${VPS_HOST}:${VPS_PATH}/`""

if ($DryRun) {
    Write-Host "  DRY RUN - would execute:" -ForegroundColor DarkYellow
    Write-Host "  $rsyncCmd" -ForegroundColor DarkGray
} else {
    # Use WSL rsync or scp fallback
    $hasRsync = Get-Command rsync -ErrorAction SilentlyContinue
    if ($hasRsync) {
        Write-Host "  Using rsync..." -ForegroundColor Gray
        Invoke-Expression $rsyncCmd
    } else {
        Write-Host "  rsync not found - using scp (full copy)..." -ForegroundColor DarkYellow
        # Create tar excluding unwanted dirs, scp it, extract on VPS
        $tarFile = "$env:TEMP\zeus-deploy.tar.gz"
        & tar -czf $tarFile --exclude=node_modules --exclude=.git --exclude=.env --exclude='./data' --exclude='*.log' --exclude=android --exclude='*.pre_ncv*' --exclude='*.pre_neural*' -C $LOCAL_PATH .
        & scp $tarFile "${VPS_USER}@${VPS_HOST}:/tmp/zeus-deploy.tar.gz"
        & ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_PATH}; cd ${VPS_PATH}; tar -xzf /tmp/zeus-deploy.tar.gz; rm /tmp/zeus-deploy.tar.gz"
        Remove-Item $tarFile -ErrorAction SilentlyContinue
    }
    Write-Host "  Files synced" -ForegroundColor Green
}

# ── Step 5: Install dependencies on VPS ──
Write-Host "`n[5/7] Installing dependencies on VPS..." -ForegroundColor Yellow
if (-not $DryRun) {
    & ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_PATH}; npm ci --production --no-audit --no-fund 2>&1 | tail -3"
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  DRY RUN - would run: npm ci --production" -ForegroundColor DarkGray
}

# ── Step 6: Reload PM2 ──
Write-Host "`n[6/7] Reloading PM2..." -ForegroundColor Yellow
if (-not $DryRun) {
    & ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_PATH}; pm2 reload ecosystem.config.js --update-env 2>&1 | tail -5"
    Start-Sleep -Seconds 3
    Write-Host "  PM2 reloaded" -ForegroundColor Green
} else {
    Write-Host "  DRY RUN - would run: pm2 reload ecosystem.config.js" -ForegroundColor DarkGray
}

# ── Step 7: Health check + rollback ──
Write-Host "`n[7/7] Health check..." -ForegroundColor Yellow
if (-not $DryRun) {
    Start-Sleep -Seconds 2
    try {
        $health = & ssh "${VPS_USER}@${VPS_HOST}" "curl -s http://localhost:3000/health" 2>&1
        $healthObj = $health | ConvertFrom-Json
        Write-Host "  Status: $($healthObj.status)" -ForegroundColor $(if ($healthObj.status -eq 'ok') { 'Green' } else { 'Yellow' })
        Write-Host "  Uptime: $($healthObj.uptime)s" -ForegroundColor Gray
        Write-Host "  Memory: $($healthObj.memory.rss)MB RSS" -ForegroundColor Gray
        Write-Host "  DB: $($healthObj.db)" -ForegroundColor Gray

        # Check migration flags
        $flags = & ssh "${VPS_USER}@${VPS_HOST}" "curl -s -H 'Cookie: zeus_token=ADMIN' http://localhost:3000/api/migration/flags" 2>&1
        Write-Host "  Flags: $flags" -ForegroundColor Gray

        if ($healthObj.status -ne 'ok') {
            Write-Host "`n  ⚠️ HEALTH CHECK FAILED - rolling back..." -ForegroundColor Red
            & ssh "${VPS_USER}@${VPS_HOST}" "rm -rf ${VPS_PATH}; mv ${VPS_PATH}.bak ${VPS_PATH}; cd ${VPS_PATH}; pm2 reload ecosystem.config.js --update-env 2>&1 | tail -3"
            Start-Sleep -Seconds 3
            $rollbackHealth = & ssh "${VPS_USER}@${VPS_HOST}" "curl -s http://localhost:3000/health" 2>&1 | ConvertFrom-Json
            Write-Host "  Rollback status: $($rollbackHealth.status)" -ForegroundColor $(if ($rollbackHealth.status -eq 'ok') { 'Green' } else { 'Red' })
            exit 1
        }
    } catch {
        Write-Host "  Health check failed - server may still be starting" -ForegroundColor Yellow
    }
} else {
    Write-Host "  DRY RUN - would check /health" -ForegroundColor DarkGray
}

Write-Host "`n===== Deploy Complete =====" -ForegroundColor Cyan
Write-Host "  VPS: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}" -ForegroundColor Gray
Write-Host "  URL: https://zeus-terminal.com" -ForegroundColor Gray
Write-Host ""
