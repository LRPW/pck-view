Set-Location -LiteralPath (Join-Path $PSScriptRoot '..') -ErrorAction Stop

# Tauri's beforeBuildCommand builds the native runtime.
yarn install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run tauri build -- --ci --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Проверка и упаковка
.\scripts\check-public-source.ps1
.\scripts\package-release.ps1 -AppExe src-tauri\target\release\pckview.exe
