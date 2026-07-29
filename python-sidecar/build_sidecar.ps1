# Build del sidecar per Windows con PyInstaller.
# --onedir e NON --onefile: i binari onefile hanno molti piu' falsi positivi
# antivirus (Windows Defender) e avvii piu' lenti.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) {
  python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
# --prefer-binary: wheel prebuilt dove esistono; le sdist pure-Python
# (es. blowfish, dipendenza di pyrekordbox) sono ok, niente compilatori C.
python -m pip install --prefer-binary -r requirements.txt

# Build dallo .spec (raccoglie pyrekordbox + numpy + sqlcipher3 + sqlalchemy:
# senza numpy esplicito il binario frozen fallirebbe con
# "No module named 'numpy._core._exceptions'").
# PyInstaller scrive i log INFO su stderr: con ErrorActionPreference=Stop
# PowerShell li tratterebbe come errore fatale, quindi lo allentiamo qui.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
pyinstaller --noconfirm --clean crateforge-sidecar.spec
$pyiExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($pyiExit -ne 0) { throw "PyInstaller fallito (exit $pyiExit)" }

# fpcalc (Chromaprint) incluso nel pacchetto: l'utente non deve installarlo.
$fpcalcVersion = '1.5.1'
$distDir = Join-Path $PSScriptRoot 'dist\crateforge-sidecar'
$fpcalcDest = Join-Path $distDir 'fpcalc.exe'
if (-not (Test-Path $fpcalcDest)) {
  $zipUrl = "https://github.com/acoustid/chromaprint/releases/download/v$fpcalcVersion/chromaprint-fpcalc-$fpcalcVersion-windows-x86_64.zip"
  $tmpZip = Join-Path $env:TEMP "fpcalc-$fpcalcVersion.zip"
  try {
    Write-Host "Scarico fpcalc $fpcalcVersion..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
    $tmpExtract = Join-Path $env:TEMP "fpcalc-extract"
    Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force
    $exe = Get-ChildItem -Path $tmpExtract -Recurse -Filter 'fpcalc.exe' | Select-Object -First 1
    Copy-Item $exe.FullName $fpcalcDest
    Remove-Item $tmpZip, $tmpExtract -Recurse -Force -Confirm:$false
    Write-Host "fpcalc incluso: $fpcalcDest"
  } catch {
    Write-Warning "Download fpcalc fallito ($_). Il fingerprint usera' fpcalc dal PATH se presente."
  }
}

Write-Host ""
Write-Host "Sidecar pronto in: $distDir"
Write-Host "Nota falsi positivi AV: se Defender segnala il binario, e' un falso positivo tipico di PyInstaller. Vedi README."
