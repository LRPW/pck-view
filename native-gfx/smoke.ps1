param([string]$ClientRoot, [string]$Effect, [string]$OutputFrame, [switch]$UiMode,
    [ValidateRange(1, 300)][int]$Frames = 30,
    [ValidateRange(1, 100)][int]$StepMs = 33,
    [switch]$RequireVisible, [switch]$RequireAnimation, [switch]$TestOrbit, [ValidateRange(1,2560)][int]$Width = 512, [ValidateRange(1,2560)][int]$Height = 512, [int]$AnimationIndex = -1, [string]$OutputGlb, [string]$Worker)
$ErrorActionPreference = 'Stop'
if (-not $Worker) { $Worker = Join-Path $PSScriptRoot 'out/native-gfx.exe' }
$info = [Diagnostics.ProcessStartInfo]::new($Worker)
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
    if ($AnimationIndex -ge 0) {
        $inputStream = $process.StandardInput.BaseStream
        $outputStream = $process.StandardOutput.BaseStream
        $inputStream.Write([BitConverter]::GetBytes([uint32]4294967292)); $inputStream.Flush()
        $word = [byte[]]::new(4); $outputStream.ReadExactly($word)
        $count = [BitConverter]::ToUInt32($word)
        Write-Output "Animations: $count"
        if ($count -gt 10000) { throw 'Invalid animation protocol' }
        for ($index = 0; $index -lt $count; $index++) {
            $fields = @()
            for ($field = 0; $field -lt 2; $field++) {
                $outputStream.ReadExactly($word); $length = [BitConverter]::ToUInt32($word)
                if ($length -gt 65536) { throw 'Invalid animation name' }
                $data = [byte[]]::new($length); $outputStream.ReadExactly($data)
                $fields += [Text.Encoding]::GetEncoding(936).GetString($data)
            }
            Write-Output "$index : $($fields -join ' | ')"
        }
        if ($AnimationIndex -ge $count) { throw 'Animation index out of range' }
        $inputStream.Write([BitConverter]::GetBytes([uint32]4294967291))
        $inputStream.Write([BitConverter]::GetBytes([uint32]$AnimationIndex)); $inputStream.Flush()
        $outputStream.ReadExactly($word)
        if ([BitConverter]::ToUInt32($word) -ne 1) { throw 'STCK playback failed' }
    }
    if ($Width -ne 512 -or $Height -ne 512) {
        foreach ($value in @([uint32]4294967293, [uint32]$Width, [uint32]$Height)) {
            $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes($value))
        }
    }
    $pixels = [byte[]]::new($Width * $Height * 4)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        for ($frame = 0; $frame -lt $Frames; $frame++) {
            if ($TestOrbit) {
                $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes([uint32]4294967294))
                foreach ($value in @([single]($frame * 0.4), [single]0.4, [single]1)) {
                    $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes($value))
                }
            }
            $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes([uint32]$StepMs))
            $process.StandardInput.BaseStream.Flush()
            $read = $process.StandardOutput.BaseStream.ReadExactlyAsync($pixels, [Threading.CancellationToken]::None).AsTask()
            if (-not $read.Wait(30000)) {throw 'Native GFX frame timed out'}
            if ($frame -eq 0) {$firstHash = [Convert]::ToBase64String($hasher.ComputeHash($pixels))}
        }
        $lastHash = [Convert]::ToBase64String($hasher.ComputeHash($pixels))
    } finally {$hasher.Dispose()}
    if ($AnimationIndex -ge 0) {
        function Read-ControlFrame([uint32]$Delta) {
            $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes($Delta))
            $process.StandardInput.BaseStream.Flush()
            $process.StandardOutput.BaseStream.ReadExactly($pixels)
            $sha = [Security.Cryptography.SHA256]::Create()
            try { [Convert]::ToBase64String($sha.ComputeHash($pixels)) } finally { $sha.Dispose() }
        }
        $paused1 = Read-ControlFrame 0; $paused2 = Read-ControlFrame 0
        if ($paused1 -ne $paused2) { throw 'Animation changed while paused' }
        $restart1 = Read-ControlFrame ([uint32]4294967295)
        $restart2 = Read-ControlFrame ([uint32]4294967295)
        if ($restart1 -ne $restart2) { throw 'Animation restart was not repeatable' }
        Write-Output 'Pause and restart: OK'
    }
    if ($OutputGlb) {
        $process.StandardInput.BaseStream.Write([BitConverter]::GetBytes([uint32]4294967290)); $process.StandardInput.BaseStream.Flush()
        $word = [byte[]]::new(4); $stream = $process.StandardOutput.BaseStream
        $stream.ReadExactly($word); $status = [BitConverter]::ToUInt32($word)
        $stream.ReadExactly($word); $length = [BitConverter]::ToUInt32($word)
        if ($length -gt 536870912) { throw 'GLB too large' }
        $glb = [byte[]]::new($length); $stream.ReadExactly($glb)
        if ($status -ne 1) { throw ([Text.Encoding]::UTF8.GetString($glb)) }
        [IO.File]::WriteAllBytes($OutputGlb, $glb); Write-Output "GLB: $length bytes"
    }
    $nonzero = 0
    for ($i = 0; $i -lt $pixels.Length; $i += 4) {if ($pixels[$i] -or $pixels[$i+1] -or $pixels[$i+2]) {$nonzero++}}
    Write-Output "Native frame: ${Width}x${Height} BGRA, nonblack pixels: $nonzero"
    if ($RequireVisible -and $nonzero -eq 0) {throw 'Effect produced an empty frame'}
    if (($RequireAnimation -or $TestOrbit) -and $firstHash -eq $lastHash) {throw 'Effect frames did not change'}
    Write-Output "Frames: $Frames; animation changed: $($firstHash -ne $lastHash)"
    if ($OutputFrame) {
        $writer = [IO.BinaryWriter]::new([IO.File]::Create($OutputFrame))
        try {
            $writer.Write([byte[]](66,77)); $writer.Write([uint32](54 + $pixels.Length)); $writer.Write([uint32]0); $writer.Write([uint32]54)
            $writer.Write([uint32]40); $writer.Write([int32]$Width); $writer.Write([int32](-$Height)); $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]0); $writer.Write([uint32]$pixels.Length); $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]0)
            $writer.Write($pixels)
        } finally {$writer.Dispose()}
    }
} finally {
    if (-not $process.HasExited) {$process.Kill()}
    $process.WaitForExit()
    $process.Dispose()
}
