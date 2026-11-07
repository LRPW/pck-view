$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

if (-not (Test-Path -LiteralPath 'node_modules/.bin/tauri.cmd')) {
    yarn install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
& "$PSScriptRoot/check-public-source.ps1"

$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$signingDirectory = Join-Path $PWD '.release-signing'
$privateKey = Join-Path $signingDirectory 'update.key'
$publicKey = $env:PW_FORGE_UPDATE_PUBLIC_KEY
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY

if ($previousKey) {
    if (-not $publicKey) { throw 'Set PW_FORGE_UPDATE_PUBLIC_KEY to the public key paired with TAURI_SIGNING_PRIVATE_KEY.' }
} else {
    New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null
    if (-not (Test-Path -LiteralPath $privateKey)) {
        if (Test-Path -LiteralPath "$privateKey.pub") { throw 'The original update private key is missing. Restore it before signing another release.' }
        npm run tauri -- signer generate --ci -w $privateKey *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate the update signing key' }
    }
    $publicKey = (Get-Content -LiteralPath "$privateKey.pub" -Raw).Trim()
}

$overlay = Join-Path ([IO.Path]::GetTempPath()) ('pwforge-release-' + [guid]::NewGuid() + '.json')
$target = 'x86_64-pc-windows-msvc'
try {
    if (-not $previousKey) { $env:TAURI_SIGNING_PRIVATE_KEY = $privateKey }
    @{
        version = $version
        bundle = @{ createUpdaterArtifacts = $true }
        plugins = @{ updater = @{ pubkey = $publicKey.Trim() } }
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $overlay -Encoding utf8

    npm run tauri -- build --ci --target $target --config $overlay
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed' }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    if (Test-Path -LiteralPath $overlay) { Remove-Item -LiteralPath $overlay -Force }
}

$targetDirectory = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri/target' }
$build = Join-Path $targetDirectory "$target/release"
$installer = Get-ChildItem -LiteralPath (Join-Path $build 'bundle/nsis') -Filter "*_${version}_x64-setup.exe" -File | Select-Object -First 1
if (-not $installer) { throw "NSIS installer for $version is missing" }
$signature = "$($installer.FullName).sig"
if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) { throw 'Updater signature is missing' }

$destination = Join-Path $PWD 'release'
$zip = & "$PSScriptRoot/package-release.ps1" -AppExe (Join-Path $build 'pwforge.exe') -Destination $destination
Copy-Item -LiteralPath @($installer.FullName, $signature) -Destination $destination -Force
$feed = Join-Path $destination 'latest.json'
@{
    version = $version
    platforms = @{
        'windows-x86_64' = @{
            url = "https://github.com/LRPW/pw-forge/releases/download/v$version/$([uri]::EscapeDataString($installer.Name))"
            signature = (Get-Content -LiteralPath $signature -Raw).Trim()
        }
    }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $feed -Encoding utf8
$releaseFiles = @($zip, (Join-Path $destination $installer.Name), (Join-Path $destination "$($installer.Name).sig"), $feed)
$releaseFiles | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_))"
} | Set-Content -LiteralPath (Join-Path $destination 'SHA256SUMS.txt') -Encoding utf8

$releaseFiles | Write-Output
