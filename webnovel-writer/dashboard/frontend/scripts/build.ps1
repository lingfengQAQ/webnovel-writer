$ErrorActionPreference = 'Stop'

$frontendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cacheDir = Join-Path $frontendRoot '.npm-cache'
$tmpDir = Join-Path $frontendRoot '.tmp'
$distDir = Join-Path $frontendRoot 'dist'
$assetsDir = Join-Path $distDir 'assets'
$esbuildExe = Join-Path $frontendRoot 'node_modules\@esbuild\win32-x64\esbuild.exe'
$entryFile = Join-Path $frontendRoot 'src\main.jsx'
$outFile = Join-Path $assetsDir 'main.js'

New-Item -ItemType Directory -Force -Path $cacheDir, $tmpDir, $assetsDir | Out-Null
$env:TMP = $tmpDir
$env:TEMP = $tmpDir
$env:npm_config_cache = $cacheDir

$esbuildArgs = @(
    $entryFile,
    '--bundle',
    "--outfile=$outFile",
    '--format=esm',
    '--platform=browser',
    '--target=es2020',
    '--jsx=automatic',
    '--loader:.js=jsx',
    '--loader:.jsx=jsx',
    '--minify'
)

& $esbuildExe @esbuildArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$templatePath = Join-Path $frontendRoot 'index.html'
$distIndexPath = Join-Path $distDir 'index.html'
$indexHtml = Get-Content -Path $templatePath -Raw
$replacement = "<link rel=`"stylesheet`" href=`"/assets/main.css`" />`n    <script type=`"module`" src=`"/assets/main.js`"></script>"
$indexHtml = $indexHtml -replace '<script type="module" src="/src/main.jsx"></script>', $replacement
Set-Content -Path $distIndexPath -Value $indexHtml -Encoding UTF8
