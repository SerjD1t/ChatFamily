param([switch]$UseWindowsTrustStore)
$ErrorActionPreference = 'Stop'
$mobileProject = Split-Path $PSScriptRoot -Parent
$savedJavaOptions = $env:JAVA_TOOL_OPTIONS
$savedSdkPath = $env:ANDROID_HOME
try {
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User')
    }
    if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath $env:ANDROID_HOME)) {
        throw 'Install Android SDK and set ANDROID_HOME first.'
    }
    if ($UseWindowsTrustStore) {
        $env:JAVA_TOOL_OPTIONS = "$savedJavaOptions -Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE".Trim()
    }
    Push-Location $mobileProject
    try {
        & npm.cmd run sync
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
        Push-Location 'android'
        try {
            & .\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --no-daemon --console=plain
            if ($LASTEXITCODE -ne 0) { throw 'Android build or checks failed.' }
        } finally { Pop-Location }
    } finally { Pop-Location }
} finally {
    $env:JAVA_TOOL_OPTIONS = $savedJavaOptions
    $env:ANDROID_HOME = $savedSdkPath
}
