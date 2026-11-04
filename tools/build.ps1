param(
    [Parameter(Mandatory = $true)] [string] $JdkBin,
    [Parameter(Mandatory = $true)] [string] $BuildTools,
    [Parameter(Mandatory = $true)] [string] $AndroidJar,
    [string] $OutDir = "build",
    [string] $VersionCode = "6",
    [string] $VersionName = "1.5"
)

$ErrorActionPreference = "Stop"
$app = Join-Path $PSScriptRoot "..\android\app"
New-Item -ItemType Directory -Force -Path $OutDir, "$OutDir\classes", "$OutDir\dex" | Out-Null

& "$BuildTools\aapt2.exe" compile --dir "$app\res" -o "$OutDir\compiled.zip"
& "$BuildTools\aapt2.exe" link -o "$OutDir\base.apk" -I $AndroidJar `
    --manifest "$app\AndroidManifest.xml" -R "$OutDir\compiled.zip" -A "$app\assets" `
    --min-sdk-version 31 --target-sdk-version 31 `
    --version-code $VersionCode --version-name $VersionName --auto-add-overlay

& "$JdkBin\javac.exe" -source 8 -target 8 -encoding UTF-8 -classpath $AndroidJar `
    -d "$OutDir\classes" "$app\src\com\nanxian\metacritic\MainActivity.java"

$env:JAVA_HOME = Split-Path $JdkBin -Parent
$env:PATH = "$JdkBin;$env:PATH"
& "$BuildTools\d8.bat" --lib $AndroidJar --min-api 31 --output "$OutDir\dex" `
    "$OutDir\classes\com\nanxian\metacritic\MainActivity.class" `
    "$OutDir\classes\com\nanxian\metacritic\MainActivity`$1.class" `
    "$OutDir\classes\com\nanxian\metacritic\MainActivity`$Bridge.class"

& python "$PSScriptRoot\fix-apk.py" "$OutDir\base.apk" "$OutDir\fixed.apk" "$OutDir\dex\classes.dex"
& "$BuildTools\zipalign.exe" -f 4 "$OutDir\fixed.apk" "$OutDir\aligned.apk"
Write-Host "Unsigned aligned APK: $OutDir\aligned.apk"
Write-Host "Sign with: apksigner sign --ks <your.jks> --out app.apk $OutDir\aligned.apk"
