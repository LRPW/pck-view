param(
    [Parameter(Mandatory)][string]$AppExe,
    [string]$NativeRuntime,
    [string]$Destination
)
$ErrorActionPreference = 'Stop'
if (-not $NativeRuntime) {$NativeRuntime = Join-Path $PSScriptRoot '..\runtimes\native-gfx'}
if (-not $Destination) {$Destination = Join-Path $PSScriptRoot '..\release'}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$version = (Get-Content "$PSScriptRoot/../package.json" -Raw | ConvertFrom-Json).version
$names = @('native-gfx.exe', 'ImmWrapper.dll', 'ifc22.dll', 'zlibwapi.dll', 'msvcp140.dll', 'vcruntime140.dll', 'd3dx9_43.dll')
foreach ($name in $names) {
    if (-not (Test-Path -LiteralPath (Join-Path $NativeRuntime $name) -PathType Leaf)) {throw "Missing native runtime: $name"}
}
if (-not (Test-Path -LiteralPath $AppExe -PathType Leaf)) {throw 'pwforge.exe is missing'}
# Build the archive in an isolated staging folder. Never zip source directories.
$staging = Join-Path ([IO.Path]::GetTempPath()) ('pckview-package-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    Copy-Item -LiteralPath $AppExe -Destination (Join-Path $staging 'pwforge.exe')
    foreach ($name in $names) {Copy-Item -LiteralPath (Join-Path $NativeRuntime $name) -Destination (Join-Path $staging $name)}
    New-Item -ItemType File -Path (Join-Path $staging 'pwforge-portable.marker') | Out-Null
    $lines = Get-ChildItem -LiteralPath $staging -File | Sort-Object Name | ForEach-Object {"$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"}
    [IO.File]::WriteAllLines((Join-Path $staging 'SHA256SUMS.txt'), [string[]]@($lines), $utf8)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $Destination = (Resolve-Path -LiteralPath $Destination).Path
    $zip = Join-Path $Destination "PW-Forge-$version-windows-x64-portable.zip"
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
    $zipChecksum = "$((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($zip))"
    [IO.File]::WriteAllLines((Join-Path $Destination 'SHA256SUMS.txt'), [string[]]@($zipChecksum), $utf8)
    Write-Output $zip
} finally {
    $resolved = [IO.Path]::GetFullPath($staging)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('pckview-package-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
