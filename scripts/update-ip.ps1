# IVR-Lab IP Address Update Script
# This script updates all configuration files when the host IP address changes
# 
# Usage: .\update-ip.ps1
# Or with specific IP: .\update-ip.ps1 -NewIP "192.168.1.100"

param(
    [string]$NewIP = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Auto-detect IP if not provided
if (-not $NewIP) {
    $NewIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notmatch 'Loopback|WSL|Bluetooth|vEthernet' -and 
        $_.IPAddress -notlike '169.*' 
    }).IPAddress | Select-Object -First 1
    
    if (-not $NewIP) {
        Write-Error "Could not auto-detect IP address. Please provide -NewIP parameter."
        exit 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "IVR-Lab IP Address Update Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "New IP Address: $NewIP" -ForegroundColor Green
Write-Host ""

# Get current IP from pjsip.conf
$pjsipConf = Get-Content "$ProjectRoot\asterisk\pjsip.conf" -Raw
if ($pjsipConf -match 'external_media_address=(\d+\.\d+\.\d+\.\d+)') {
    $OldIP = $Matches[1]
    Write-Host "Current IP Address: $OldIP" -ForegroundColor Yellow
} else {
    Write-Host "Could not detect current IP from pjsip.conf" -ForegroundColor Red
    $OldIP = Read-Host "Enter the old IP address to replace"
}

if ($OldIP -eq $NewIP) {
    Write-Host ""
    Write-Host "IP address is already up to date. No changes needed." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Updating configurations from $OldIP to $NewIP..." -ForegroundColor Cyan
Write-Host ""

# Files to update
$filesToUpdate = @(
    @{ Path = "asterisk\pjsip.conf"; Description = "Asterisk PJSIP Configuration" },
    @{ Path = "asterisk\rtp.conf"; Description = "Asterisk RTP Configuration" },
    @{ Path = "docker-compose.yml"; Description = "Docker Compose" },
    @{ Path = "sbc\docker-compose.yml"; Description = "SBC Docker Compose" },
    @{ Path = "sbc\opensips\opensips.cfg"; Description = "OpenSIPS Configuration" },
    @{ Path = "sbc\opensips\kamailio.cfg"; Description = "Kamailio Configuration" }
)

$updatedFiles = @()
$errorFiles = @()

foreach ($file in $filesToUpdate) {
    $fullPath = Join-Path $ProjectRoot $file.Path
    
    if (Test-Path $fullPath) {
        try {
            $content = Get-Content $fullPath -Raw
            if ($content -match [regex]::Escape($OldIP)) {
                $newContent = $content -replace [regex]::Escape($OldIP), $NewIP
                Set-Content $fullPath $newContent -NoNewline
                Write-Host "[OK] $($file.Description)" -ForegroundColor Green
                Write-Host "     $($file.Path)" -ForegroundColor Gray
                $updatedFiles += $file.Path
            } else {
                Write-Host "[--] $($file.Description) (no changes needed)" -ForegroundColor DarkGray
            }
        } catch {
            Write-Host "[ERR] $($file.Description): $_" -ForegroundColor Red
            $errorFiles += $file.Path
        }
    } else {
        Write-Host "[--] $($file.Path) (file not found)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Files updated: $($updatedFiles.Count)" -ForegroundColor Green
if ($errorFiles.Count -gt 0) {
    Write-Host "Errors: $($errorFiles.Count)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Restart Asterisk container to apply changes:" -ForegroundColor White
Write-Host "   docker compose restart asterisk" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Verify PJSIP endpoint status:" -ForegroundColor White
Write-Host "   docker exec asterisk asterisk -rx 'pjsip show endpoints'" -ForegroundColor Cyan
Write-Host ""

# Ask to restart containers
$restart = Read-Host "Restart Asterisk container now? (y/n)"
if ($restart -eq 'y' -or $restart -eq 'Y') {
    Write-Host ""
    Write-Host "Restarting Asterisk container..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    docker compose restart asterisk
    Start-Sleep -Seconds 5
    Write-Host ""
    Write-Host "Checking endpoint status..." -ForegroundColor Cyan
    docker exec asterisk asterisk -rx "pjsip show endpoints"
    Pop-Location
}

Write-Host ""
Write-Host "IP update complete!" -ForegroundColor Green
