#!/usr/bin/env bash
# iOS 构建脚本：在 GitHub macOS runner 上把 Capacitor iOS 工程打包为 IPA。
# 若提供 Apple 签名密钥（环境变量），产出可安装 IPA；否则产出未签名 IPA（仅演示打包链路）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/ios/App"

echo "== 安装 CocoaPods 依赖 =="
pod install --repo-update

# ---- 签名密钥解码（仅在提供时）----
SIGNED=false
if [ -n "${IOS_P12_BASE64:-}" ]; then
  echo "== 检测到 Apple 签名密钥，准备签名构建 =="
  echo "$IOS_P12_BASE64" | base64 --decode > cert.p12
  echo "$IOS_PROFILE_BASE64" | base64 --decode > profile.mobileprovision
  security create-keychain -p "" build.keychain
  security import cert.p12 -k build.keychain -P "$IOS_P12_PASSWORD" -T /usr/bin/codesign
  security list-keychains -d user -s build.keychain login.keychain
  security unlock-keychain -p "" build.keychain
  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  cp profile.mobileprovision "$HOME/Library/MobileDevice/Provisioning Profiles/"
  PROFILE_NAME=$(security cms -D -i profile.mobileprovision 2>/dev/null | plutil -extract Name raw -)
  SIGNED=true
else
  echo "== 未提供 Apple 签名密钥 =="
fi

if [ "$SIGNED" = "true" ]; then
  echo "== 签名构建并导出 IPA =="
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
    -archivePath build/App.xcarchive \
    CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
    PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \
    CODE_SIGN_IDENTITY="iPhone Distribution" clean archive
  cat > ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>$IOS_TEAM_ID</string>
  <key>provisioningProfiles</key><dict>
    <key>com.studygoal.app</key><string>$PROFILE_NAME</string>
  </dict>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath build/App.xcarchive \
    -exportOptionsPlist ExportOptions.plist -exportPath build
  cp build/App.ipa build/app-release.ipa
else
  echo "== 未签名构建（演示打包链路，需重签后才可安装真机）=="
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
    -archivePath build/App.xcarchive \
    CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
    clean archive
  mkdir -p Payload
  cp -r build/App.xcarchive/Products/Applications/*.app Payload/
  (cd Payload && zip -r ../build/app-release.ipa .)
fi

ls -lh build/app-release.ipa
