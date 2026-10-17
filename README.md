# 学习目标台 · StudyGoal

> 一个专门管理「有终点、有总量」学习目标的跨平台 App —— 比如“背完 2000 个单词”“读完一本 440 页的书”，而不是无限期的习惯打卡。

基于 **Capacitor** 包裹一个**单文件、零外部依赖、断网可用**的 Web 应用，一次开发即可上架 **Android / iOS**，并保留后续把热点界面迁移为原生模块的空间。

---

## ✨ 核心能力

- **目标模型**：名称 / 单位 / 总量 / 截止日 / 配色，外加两个选填字段——「最容易拦住我的障碍」与「如果它出现，我就……」的对策。
- **智能建议量**：每日建议量 = 剩余量 ÷ 剩余天数，打卡时预填可改（支持向上取整 / 四舍五入 / 向下取整）。
- **智能状态**：完成率、连续打卡天数（每周一自动配 1 个休息日，第一次漏打不断、第二次才断）、预计完成日（按近 7 天平均速度推算，样本不足显示「暂无推算」，**绝不编数字**）；与截止日比较显示提前 / 拖后。
- **今日要处理**：昨日漏打卡自动置顶——本周首次漏打用温和黄卡解释休息日，用完则红卡解释滚入今日；逾期目标显示天数并给「立即打卡」「调整计划」两个出口。
- **打卡**：一天可多次、选填分钟数、可补记最近 6 天（带「补」标并按真实日期参与连续天数与推算）；目标达成有彩带动效。
- **四 Tab 布局**
  - **今日**：新建 / 编辑 / 二次确认删除，待处理目标卡。
  - **看板**：进度环 + 三核心数字 + 最近 10 条可删记录 + 手写 SVG 近 14 天投入分钟分目标堆叠柱状图（未填分钟不硬凑）。
  - **周报**：周一至周日汇总 + 上周同口径环比 + 可翻历史周 + 保持 / 问题 / 尝试 / 下周预案四栏 + 一键生成周报文本。
  - **我的**：导出 / 导入 JSON、旧版本迁移、清空示例、输入「清空」清全部、添加到主屏三步说明、移动端能力卡片。
- **离线优先**：全部数据存 `localStorage` / WebView，断网完全可用；20 条记录后顶部出现可一键导出的温和备份横幅。
- **原生增强（移动端）**：每日打卡本地通知提醒、生物识别锁（插件接入后启用）、系统分享，均由 `www/native.js` 桥接，无 Capacitor 时优雅降级。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| Web 核心 | 原生 HTML / CSS / JS（单文件，内联 SVG 图标，无 emoji，无外部库） |
| 原生壳 | Capacitor 6（iOS + Android） |
| 存储 | `localStorage`（已预留云同步接口 `window.StudyGoalSync`，默认本地优先） |
| 构建 | Gradle 8.2.1 / AGP 8.2.1，compileSdk 34，JDK 17 |

---

## 📁 工程结构

```
study-goal-app/
├── www/                      # Web 应用核心（即学习目标台）
│   ├── index.html            # 单文件页面，逻辑 100% 复用
│   └── native.js             # 原生桥接层：通知 / 生物识别 / 分享 / 同步预留
├── android/                  # Capacitor 生成的 Android 原生工程（含签名配置）
├── ios/                      # Capacitor 生成的 iOS 原生工程（含通知用途描述）
├── keys/                     # ⚠️ 本地签名密钥目录（已被 .gitignore 忽略，切勿提交）
├── capacitor.config.json     # appId=com.studygoal.app，配色 / 通知配置
├── package.json              # Capacitor 依赖与脚本
└── .github/workflows/
    ├── build-android.yml     # 推 master → 自动出 debug APK（Actions 产物可下载）
    └── release.yml           # 打 v* 标签 → 自动出签名 AAB 并发到 GitHub Release
```

---

## 🚀 本地开发

### 前置条件
- Node.js 18+
- JDK 17
- Android Studio（Android）/ Xcode（iOS，需 macOS）
- Android SDK（platforms;android-34、build-tools;34.0.0）

### 步骤
```bash
# 1. 安装依赖
npm install

# 2. 同步 Web 资源到原生壳
npx cap sync

# 3. 用浏览器快速预览 Web 核心
#    直接用浏览器打开 www/index.html 即可（断网可用）

# 4. 打开原生工程
npx cap open android   # 或 npx cap open ios
```

> 本地沙箱为加速构建，`android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 指向了腾讯镜像；
> CI 运行时会自动切回官方源 `services.gradle.org`，不影响你本机配置。若你本机官方源可达，可改回原值。

---

## 📦 自动打包 / 发版（CI）

仓库已配置两条 GitHub Actions 流水线，**无需本地安装 SDK 即可出包**：

| 触发方式 | 流水线 | 产物 | 去哪下 |
|---|---|---|---|
| 推送 `master` | `build-android.yml` | 调试版 APK（`app-debug.apk`） | Actions → Artifacts |
| 推送 `v*` 标签（如 `v1.0.1`） | `release.yml` | 签名版 AAB（`app-release.aab`） | Releases 页面 |

### 发一次新版本
```bash
git tag -a v1.0.1 -m "本周修复打卡提醒"
git push origin v1.0.1
```
CI 会自动：装 SDK → 签名构建 AAB → 发布到 GitHub Release（标签名作为版本名，如 `1.0.1`）。

### 两种产物用途
- **Debug APK**：`adb install app-debug.apk` 直接装手机测试。
- **Release AAB**：用于上架 Google Play（Play 要求的格式，不能直接安装到手机）。

---

## 🔐 签名与安全

- 发布签名用的密钥库已存入仓库 **GitHub Secrets**（`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`），不进入源码。
- 本地备份的密钥库位于 `keys/release.keystore`（已被 `.gitignore` 忽略）。
- **密钥库是同一应用持续发版的法定凭证，一旦丢失将无法用新 AAB 更新旧应用**，请务必离线备份。
- 生物识别锁（`@capacitor/biometric-authentication`）因受限网络未预装，代码已接好；在可联网机器执行 `npm i` 该插件并把插件块加回 `capacitor.config.json` 即可启用（不装不影响其他功能）。

---

## 📱 安装与体验

- **Web / PWA**：浏览器打开 `www/index.html`，或部署为静态站点后「添加到主屏幕」当 App 用。
- **Android 测试**：下载 Actions 产物 `app-debug.apk` → `adb install app-debug.apk`。
- **iOS**：在 macOS 上 `npx cap open ios`，用 Xcode 选证书 / 签名后真机或 TestFlight 安装。

---

## 🗺️ 后续可演进

- Release 签名 + 自动发 AAB（✅ 已完成）
- 接入真实云同步后端（存储层已预留 `StorageAdapter` / `window.StudyGoalSync`）
- Widget、系统分享面板深度集成
- 将「看板 SVG 图表」迁移为原生模块以进一步提升性能
- 升级被标记废弃的 action 版本（Node 20 / setup-java v4 / ubuntu-latest 迁移预告）

---

## 📄 许可

个人学习 / 内部使用。如需商用请自行评估依赖许可。
