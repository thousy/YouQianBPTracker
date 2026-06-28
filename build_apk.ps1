# YouQian Blood Pressure Tracker - Local APK Build Script
# This script configures JDK, downloads Gradle and Android SDK locally, then builds the APK.

$ErrorActionPreference = "Stop"
$originalPath = $env:PATH

# 1. Paths config
$sdkDir = "d:\android-sdk"
$gradleDir = "d:\gradle"
$buildDir = "d:\xueya_build"
$sourceDir = "d:\xueya"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Starting Android build environment setup..." -ForegroundColor Cyan
Write-Host " All dependencies will be installed locally." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Create directories
if (!(Test-Path $sdkDir)) { New-Item -ItemType Directory -Path $sdkDir | Out-Null }
if (!(Test-Path $gradleDir)) { New-Item -ItemType Directory -Path $gradleDir | Out-Null }
if (!(Test-Path "$sdkDir\cmdline-tools")) { New-Item -ItemType Directory -Path "$sdkDir\cmdline-tools" | Out-Null }

# --------------------------------------------------
# Step 1: Install/Configure JDK 17 (Microsoft OpenJDK)
# --------------------------------------------------
Write-Host "`n[1/6] Checking JDK 17 installation..." -ForegroundColor Yellow

# winget install was already executed, now let's locate the JDK path dynamically
$javaExe = Get-ChildItem -Path "C:\Program Files" -Filter "javac.exe" -Recurse -Depth 4 -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($javaExe) {
    $jdkPath = $javaExe.Directory.Parent.FullName
    $env:JAVA_HOME = $jdkPath
    $env:PATH = $jdkPath + "\bin;" + $env:PATH
    Write-Host "Found JDK 17 at: $jdkPath" -ForegroundColor Green
} else {
    # If not installed or missing, trigger winget once more just in case
    Write-Host "JDK 17 not found. Installing via winget..." -ForegroundColor White
    & winget install Microsoft.OpenJDK.17 --silent --accept-source-agreements --accept-package-agreements --upgrade-method install | Out-Null
    
    # Locate again after install
    $javaExe2 = Get-ChildItem -Path "C:\Program Files" -Filter "javac.exe" -Recurse -Depth 4 -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($javaExe2) {
        $jdkPath = $javaExe2.Directory.Parent.FullName
        $env:JAVA_HOME = $jdkPath
        $env:PATH = $jdkPath + "\bin;" + $env:PATH
        Write-Host "Successfully installed and located JDK 17: $jdkPath" -ForegroundColor Green
    } else {
        Write-Error "Failed to install/locate JDK 17. Please install JDK manually."
    }
}

# --------------------------------------------------
# Step 2: Download and extract Gradle 7.4.2
# --------------------------------------------------
Write-Host "`n[2/6] Checking and configuring Gradle 7.4.2 (Green Version)..." -ForegroundColor Yellow

$gradleZip = "$gradleDir\gradle-7.4.2-bin.zip"
$gradleUrl = "https://mirrors.huaweicloud.com/gradle/gradle-7.4.2-bin.zip"
$gradleBinPath = "$gradleDir\gradle-7.4.2\bin"

if (!(Test-Path "$gradleBinPath\gradle.bat")) {
    Write-Host "Downloading Gradle 7.4.2 (110MB)..." -ForegroundColor White
    Start-BitsTransfer -Source $gradleUrl -Destination $gradleZip -Description "Downloading Gradle"
    
    Write-Host "Extracting Gradle ZIP..." -ForegroundColor White
    Expand-Archive -Path $gradleZip -DestinationPath $gradleDir -Force
    
    Remove-Item -Path $gradleZip -Force
    Write-Host "Gradle 7.4.2 configured successfully." -ForegroundColor Green
} else {
    Write-Host "Gradle 7.4.2 already configured." -ForegroundColor Green
}

# Set temporary path for Gradle
$env:PATH = $gradleBinPath + ";" + $env:PATH

# --------------------------------------------------
# Step 3: Configure Android SDK command-line tools
# --------------------------------------------------
Write-Host "`n[3/6] Checking and configuring Android SDK command-line tools..." -ForegroundColor Yellow

$zipPath = "$sdkDir\cmdline-tools.zip"
$cmdlineUrl = "https://dl.google.com/android/repository/commandlinetools-win-9477386_latest.zip"

if (!(Test-Path "$sdkDir\cmdline-tools\latest\bin\sdkmanager.bat")) {
    Write-Host "Downloading Android SDK Command Line Tools (108MB)..." -ForegroundColor White
    Start-BitsTransfer -Source $cmdlineUrl -Destination $zipPath -Description "Downloading Android SDK tools"
    
    Write-Host "Extracting ZIP..." -ForegroundColor White
    Expand-Archive -Path $zipPath -DestinationPath "$sdkDir\cmdline-tools-temp" -Force
    
    # Restructure folder for sdkmanager (cmdline-tools/latest/bin/...)
    New-Item -ItemType Directory -Force -Path "$sdkDir\cmdline-tools\latest" | Out-Null
    Move-Item -Path "$sdkDir\cmdline-tools-temp\cmdline-tools\*" -Destination "$sdkDir\cmdline-tools\latest" -Force
    
    # Cleanup
    Remove-Item -Path $zipPath -Force
    Remove-Item -Path "$sdkDir\cmdline-tools-temp" -Recurse -Force
    Write-Host "Android CLI Tools configured successfully." -ForegroundColor Green
} else {
    Write-Host "Android CLI Tools already configured." -ForegroundColor Green
}

# Set temporary path for Android SDK
$env:ANDROID_HOME = $sdkDir
$env:PATH = $sdkDir + "\platform-tools;" + $sdkDir + "\cmdline-tools\latest\bin;" + $env:PATH
Write-Host "ANDROID_HOME path: $sdkDir" -ForegroundColor White

# Verify commands work
Write-Host "Testing commands in current session..." -ForegroundColor White
java -version
gradle -v
sdkmanager --version
Write-Host "Environment check passed." -ForegroundColor Green

# --------------------------------------------------
# Step 4: Install Android SDK Packages via Google Repository (Direct Zip)
# --------------------------------------------------
Write-Host "`n[4/6] Installing Android build components (Direct Zip via Google Repository)..." -ForegroundColor Yellow

# 1. Platform-tools
$platToolsZip = "$sdkDir\platform-tools.zip"
$platToolsUrl = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
if (!(Test-Path "$sdkDir\platform-tools\adb.exe")) {
    Write-Host "Downloading Platform Tools..." -ForegroundColor White
    Start-BitsTransfer -Source $platToolsUrl -Destination $platToolsZip -Description "Downloading Platform Tools"
    Write-Host "Extracting Platform Tools..." -ForegroundColor White
    Expand-Archive -Path $platToolsZip -DestinationPath $sdkDir -Force
    Remove-Item -Path $platToolsZip -Force
} else {
    Write-Host "Platform Tools already exists." -ForegroundColor Green
}

# 2. Platforms (Android-33)
$platformZip = "$sdkDir\platform-33.zip"
$platformUrl = "https://dl.google.com/android/repository/platform-33_r02.zip"
$targetPlatformDir = "$sdkDir\platforms\android-33"
if (!(Test-Path "$targetPlatformDir\android.jar")) {
    Write-Host "Downloading Android 33 Platform (approx 64MB)..." -ForegroundColor White
    Start-BitsTransfer -Source $platformUrl -Destination $platformZip -Description "Downloading Android 33 Platform"
    
    Write-Host "Extracting Platform..." -ForegroundColor White
    $tempPlatformDir = "$sdkDir\platforms-temp"
    if (Test-Path $tempPlatformDir) { Remove-Item -Path $tempPlatformDir -Recurse -Force }
    Expand-Archive -Path $platformZip -DestinationPath $tempPlatformDir -Force
    
    New-Item -ItemType Directory -Force -Path $targetPlatformDir | Out-Null
    $subDir = Get-ChildItem -Path $tempPlatformDir -Directory | Select-Object -First 1
    Move-Item -Path "$($subDir.FullName)\*" -Destination $targetPlatformDir -Force
    
    Remove-Item -Path $platformZip -Force
    Remove-Item -Path $tempPlatformDir -Recurse -Force
    Write-Host "Android 33 Platform installed." -ForegroundColor Green
} else {
    Write-Host "Android 33 Platform already exists." -ForegroundColor Green
}

# 3. Build-tools (33.0.2)
$buildToolsZip = "$sdkDir\build-tools-33.0.2.zip"
$buildToolsUrl = "https://dl.google.com/android/repository/build-tools_r33.0.2-windows.zip"
$targetBuildToolsDir = "$sdkDir\build-tools\33.0.2"
if (!(Test-Path "$targetBuildToolsDir\aapt.exe")) {
    Write-Host "Downloading Build Tools 33.0.2 (approx 53MB)..." -ForegroundColor White
    Start-BitsTransfer -Source $buildToolsUrl -Destination $buildToolsZip -Description "Downloading Build Tools"
    
    Write-Host "Extracting Build Tools..." -ForegroundColor White
    $tempBuildToolsDir = "$sdkDir\build-tools-temp"
    if (Test-Path $tempBuildToolsDir) { Remove-Item -Path $tempBuildToolsDir -Recurse -Force }
    Expand-Archive -Path $buildToolsZip -DestinationPath $tempBuildToolsDir -Force
    
    New-Item -ItemType Directory -Force -Path $targetBuildToolsDir | Out-Null
    $subDir = Get-ChildItem -Path $tempBuildToolsDir -Directory | Select-Object -First 1
    Move-Item -Path "$($subDir.FullName)\*" -Destination $targetBuildToolsDir -Force
    
    Remove-Item -Path $buildToolsZip -Force
    Remove-Item -Path $tempBuildToolsDir -Recurse -Force
    Write-Host "Build Tools 33.0.2 installed." -ForegroundColor Green
} else {
    Write-Host "Build Tools 33.0.2 already exists." -ForegroundColor Green
}

# 3b. Build-tools (32.0.0)
$targetBuildTools32Dir = "$sdkDir\build-tools\32.0.0"
if (!(Test-Path "$targetBuildTools32Dir\aapt.exe")) {
    Write-Host "Installing Build Tools 32.0.0 via sdkmanager..." -ForegroundColor White
    $agreeFile = $sdkDir + "\agree.txt"
    "y`ny`ny`ny`ny`ny`ny`n" | Out-File -FilePath $agreeFile -Encoding ascii
    Get-Content -Path $agreeFile | & sdkmanager.bat --sdk_root=$sdkDir "build-tools;32.0.0" | Out-Null
    Remove-Item -Path $agreeFile -Force
    Write-Host "Build Tools 32.0.0 installed." -ForegroundColor Green
} else {
    Write-Host "Build Tools 32.0.0 already exists." -ForegroundColor Green
}


# Agree to SDK licenses automatically (just in case Gradle build checks for it)
Write-Host "Accepting licenses..." -ForegroundColor White
$agreeFile = $sdkDir + "\agree.txt"
"y`ny`ny`ny`ny`ny`ny`n" | Out-File -FilePath $agreeFile -Encoding ascii
Get-Content -Path $agreeFile | & sdkmanager.bat --sdk_root=$sdkDir --licenses | Out-Null
Remove-Item -Path $agreeFile -Force
Write-Host "Android SDK build components configured successfully." -ForegroundColor Green

# --------------------------------------------------
# Step 5: Init Cordova Project and sync web code
# --------------------------------------------------
Write-Host "`n[5/6] Initializing Cordova project container..." -ForegroundColor Yellow

# Set Gradle Distribution Environment Variable to redirect download to domestic Huawei Cloud Mirror
$env:CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL = "https://mirrors.huaweicloud.com/gradle/gradle-7.4.2-all.zip"
Write-Host "Set CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL = $env:CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL" -ForegroundColor Green

if (!(Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir | Out-Null
}
Set-Location $buildDir

# Setup package.json and local cordova + cordova-android
if (!(Test-Path "package.json")) {
    Write-Host "Installing cordova and cordova-android packages dependency locally..." -ForegroundColor White
    & npm init -y | Out-Null
    & npm install cordova@11.1.0 cordova-android@11.0.0 | Out-Null
} else {
    # Ensure cordova-android is installed
    if (!(Test-Path "node_modules\cordova-android")) {
        Write-Host "Installing missing cordova-android..." -ForegroundColor White
        & npm install cordova@11.1.0 cordova-android@11.0.0 | Out-Null
    }
}

# Patch cordova-android framework gradle-wrapper template before creating the platform
Write-Host "Patching node_modules cordova-android Gradle Wrapper template..." -ForegroundColor White
$templateWrapperPath = "$buildDir\node_modules\cordova-android\framework\gradle\wrapper\gradle-wrapper.properties"
if (Test-Path $templateWrapperPath) {
    $content = Get-Content -Path $templateWrapperPath
    $newContent = $content -replace "services.gradle.org/distributions", "mirrors.huaweicloud.com/gradle"
    $newContent | Out-File -FilePath $templateWrapperPath -Encoding ascii
    Write-Host "Patched: $templateWrapperPath" -ForegroundColor Green
} else {
    Write-Host "Not found: $templateWrapperPath" -ForegroundColor Cyan
}

$cordovaProj = $buildDir + "\YouQianBPTracker"
if (Test-Path $cordovaProj) {
    Write-Host "Clearing old build project..." -ForegroundColor White
    Remove-Item -Path $cordovaProj -Recurse -Force
}

Write-Host "Creating new Cordova project skeleton..." -ForegroundColor White
& npx cordova create YouQianBPTracker com.youqian.bptracker YouQianBPTracker | Out-Null
Set-Location $cordovaProj

# Sync HTML5 resource assets to cordova www folder
Write-Host "Syncing app assets..." -ForegroundColor White
Remove-Item -Path "www\*" -Recurse -Force
Copy-Item -Path ($sourceDir + "\index.html") -Destination "www\index.html"
Copy-Item -Path ($sourceDir + "\styles.css") -Destination "www\styles.css"
Copy-Item -Path ($sourceDir + "\app.js") -Destination "www\app.js"
Copy-Item -Path ($sourceDir + "\manifest.json") -Destination "www\manifest.json"
Copy-Item -Path ($sourceDir + "\app_icon.png") -Destination "www\app_icon.png"
Copy-Item -Path ($sourceDir + "\sw.js") -Destination "www\sw.js"

# Inject app_icon into config.xml
Write-Host "Injecting application icon configuration..." -ForegroundColor White
$configXml = Get-Content -Path "config.xml"
$newConfig = $configXml | ForEach-Object {
    if ($_ -match "</widget>") {
        '    <icon src="www/app_icon.png" />' + "`n" + $_
    } else {
        $_
    }
}
$newConfig | Out-File -FilePath "config.xml" -Encoding utf8

# Add Android Platform support in Cordova project
Write-Host "Adding android platform support to project..." -ForegroundColor White
$env:ANDROID_HOME = $sdkDir
& npx cordova platform add android@11.0.0 | Out-Null
Write-Host "Android platform added successfully." -ForegroundColor Green

# Add Cordova Plugins
Write-Host "Adding cordova-plugin-camera..." -ForegroundColor White
& npx cordova plugin add cordova-plugin-camera --save | Out-Null
Write-Host "cordova-plugin-camera added successfully." -ForegroundColor Green

Write-Host "Adding cordova-plugin-file..." -ForegroundColor White
& npx cordova plugin add cordova-plugin-file --save | Out-Null
Write-Host "cordova-plugin-file added successfully." -ForegroundColor Green

Write-Host "Adding cordova-plugin-printer..." -ForegroundColor White
& npx cordova plugin add cordova-plugin-printer --save | Out-Null
Write-Host "cordova-plugin-printer added successfully." -ForegroundColor Green

# Patch Gradle Wrapper paths again to guarantee use of domestic Huawei Cloud Mirror
Write-Host "Double-patching Gradle Wrapper distribution URL in platform project..." -ForegroundColor White
$pathsToPatch = @(
    "$cordovaProj\platforms\android\gradle\wrapper\gradle-wrapper.properties",
    "$buildDir\node_modules\cordova-android\framework\gradle\wrapper\gradle-wrapper.properties"
)
foreach ($wrapperPropPath in $pathsToPatch) {
    if (Test-Path $wrapperPropPath) {
        $content = Get-Content -Path $wrapperPropPath
        $newContent = $content -replace "services.gradle.org/distributions", "mirrors.huaweicloud.com/gradle"
        $newContent | Out-File -FilePath $wrapperPropPath -Encoding ascii
        Write-Host "Patched: $wrapperPropPath" -ForegroundColor Green
    } else {
        Write-Host "Not found: $wrapperPropPath" -ForegroundColor Cyan
    }
}

# Patch all .gradle files in Android platform project to use Aliyun Maven mirror for build speed and SSL bypass
Write-Host "Recursively patching all .gradle files in platform project to use Aliyun Maven Mirror..." -ForegroundColor White
Get-ChildItem -Path "$cordovaProj\platforms\android" -Filter *.gradle -Recurse | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content -Path $file -Raw
    if ($content -match 'google\(\)|mavenCentral\(\)') {
        $newContent = $content -replace 'google\(\)', 'maven { url "https://maven.aliyun.com/repository/google" }'
        $newContent = $newContent -replace 'mavenCentral\(\)', 'maven { url "https://maven.aliyun.com/repository/public" }'
        $newContent | Out-File -FilePath $file -Encoding ascii
        Write-Host "Patched: $file" -ForegroundColor Green
    }
}

# Patch all .java files in Android platform project to use AndroidX instead of legacy Support libraries
Write-Host "Recursively patching all .java files in platform project to use AndroidX..." -ForegroundColor White
Get-ChildItem -Path "$cordovaProj\platforms\android" -Filter *.java -Recurse | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content -Path $file -Raw
    $changed = $false
    if ($content -match 'android\.support\.annotation') {
        $content = $content -replace 'android\.support\.annotation', 'androidx.annotation'
        $changed = $true
    }
    if ($content -match 'android\.support\.v4\.print') {
        $content = $content -replace 'android\.support\.v4\.print', 'androidx.print'
        $changed = $true
    }
    if ($changed) {
        $content | Out-File -FilePath $file -Encoding ascii
        Write-Host "Patched AndroidX for: $file" -ForegroundColor Green
    }
}

# --------------------------------------------------
# Step 6: Build APK Package
# --------------------------------------------------
Write-Host "`n[6/6] Compiling APK package..." -ForegroundColor Yellow

# Build release device apk
& npx cordova build android --device

$apkPath = $buildDir + "\YouQianBPTracker\platforms\android\app\build\outputs\apk\debug\app-debug.apk"
$appName = "$([char]0x8840)$([char]0x538b)$([char]0x52a9)$([char]0x624b)"
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$targetApkName = $sourceDir + "\YouQian" + $appName + "_V1.4_" + $timestamp + ".apk"

if (Test-Path $apkPath) {
    # 用 cmd copy 替代 Copy-Item，能完美兼容中文字符路径
    cmd.exe /c "copy /Y `"$apkPath`" `"$targetApkName`"" | Out-Null
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host " APK built successfully!" -ForegroundColor Green
    Write-Host " Location: $targetApkName" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Error "Build finished but output APK not found."
}

# Restore original path
$env:PATH = $originalPath
