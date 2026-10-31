param([string]$ClientRoot, [string]$Effect, [string]$OutputFrame, [switch]$UiMode,
    [ValidateRange(1, 300)][int]$Frames = 30,
    [ValidateRange(1, 100)][int]$StepMs = 33,
    [switch]$RequireVisible, [switch]$RequireAnimation)
$ErrorActionPreference = 'Stop'
$info = [Diagnostics.ProcessStartInfo]::new((Join-Path $PSScriptRoot 'out/native-gfx.exe'))
$info.UseShellExecute = $false
$info.Environment['PATH'] = $ClientRoot + [IO.Path]::PathSeparator + $env:PATH
$info.CreateNoWindow = $true
$info.WorkingDirectory = Join-Path $PSScriptRoot 'out'
$info.RedirectStandardInput = $true
$info.RedirectStandardOutput = $true
$info.ArgumentList.Add($ClientRoot)
$info.ArgumentList.Add([Convert]::ToHexString([Text.Encoding]::GetEncoding(936).GetBytes($Effect)))
$info.ArgumentList.Add($(if ($UiMode) {'1'} else {'0'}))
$process = [Diagnostics.Process]::Start($info)
try {
    $ready = [byte[]]::new(4)
    $read = $process.StandardOutput.BaseStream.ReadAsync($ready, 0, 4)
    if (-not $read.Wait(30000)) {throw 'Native GFX startup timed out'}
    if ($read.Result -ne 4) {$process.WaitForExit(); throw "Native GFX exited: $($process.ExitCode)"}
    if ([BitConverter]::ToUInt32($ready) -ne 0x31584647) {throw 'Invalid frame protocol'}
    $pixels = [byte[]]::new(1048576)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        for ($frame = 0; $frame -lt $Frames; $frame++) {
            $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes([uint32]$StepMs))
            $process.StandardInput.BaseStream.Flush()
            $read = $process.StandardOutput.BaseStream.ReadExactlyAsync($pixels, [Threading.CancellationToken]::None).AsTask()
            if (-not $read.Wait(30000)) {throw 'Native GFX frame timed out'}
            if ($frame -eq 0) {$firstHash = [Convert]::ToBase64String($hasher.ComputeHash($pixels))}
        }
        $lastHash = [Convert]::ToBase64String($hasher.ComputeHash($pixels))
    } finally {$hasher.Dispose()}
    $nonzero = 0
    for ($i = 0; $i -lt $pixels.Length; $i += 4) {if ($pixels[$i] -or $pixels[$i+1] -or $pixels[$i+2]) {$nonzero++}}
    Write-Output "Native frame: 512x512 BGRA, nonblack pixels: $nonzero"
    if ($RequireVisible -and $nonzero -eq 0) {throw 'Effect produced an empty frame'}
    if ($RequireAnimation -and $firstHash -eq $lastHash) {throw 'Effect frames did not change'}
    Write-Output "Frames: $Frames; animation changed: $($firstHash -ne $lastHash)"
    if ($OutputFrame) {
        $writer = [IO.BinaryWriter]::new([IO.File]::Create($OutputFrame))
        try {
            $writer.Write([byte[]](66,77)); $writer.Write([uint32](54 + $pixels.Length)); $writer.Write([uint32]0); $writer.Write([uint32]54)
            $writer.Write([uint32]40); $writer.Write([int32]512); $writer.Write([int32]-512); $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]0); $writer.Write([uint32]$pixels.Length); $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]0)
            $writer.Write($pixels)
        } finally {$writer.Dispose()}
    }
} finally {
    if (-not $process.HasExited) {$process.Kill()}
    $process.WaitForExit()
    $process.Dispose()
}
