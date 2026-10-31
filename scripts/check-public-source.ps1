$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/.."
try {
    $files = @(git ls-files -- '*.cpp' '*.cxx' '*.cc' '*.h' '*.hpp' '*.lib' '*.pdb' '*.obj' 'runtimes/*')
    if ($LASTEXITCODE -ne 0) {throw 'Cannot inspect tracked files'}
    $files = @($files | Where-Object {$_ -ne 'native-gfx/main.cpp'})
    if ($files.Count) {throw "Private/native files tracked in the public repository:`n$($files -join "`n")"}
    Write-Output 'Public source check passed'
} finally {Pop-Location}
