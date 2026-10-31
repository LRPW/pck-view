cd D:\PerfectWorld\client_source\rust-src\pckview

# Нативный проигрыватель — требует VS2022 и DirectX SDK June 2010
.\native-gfx\build.cmd

# Подготовить готовые бинарники для упаковки
New-Item -ItemType Directory -Force runtimes\native-gfx | Out-Null

$files = @(
    'native-gfx.exe',
    'ImmWrapper.dll',
    'ifc22.dll',
    'zlibwapi.dll',
    'msvcp140.dll',
    'vcruntime140.dll',
    'd3dx9_43.dll'
)
foreach ($file in $files) {
    Copy-Item "native-gfx\out\$file" runtimes\native-gfx -Force
}

# PCK View
yarn install --frozen-lockfile
npm test
npm run tauri build -- --ci --no-bundle

# Проверка и упаковка
.\scripts\check-public-source.ps1
.\scripts\package-release.ps1 -AppExe src-tauri\target\release\pckview.exe