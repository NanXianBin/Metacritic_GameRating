# Metacritic 游戏评分 · Android

开发者：**南仙**

把 Metacritic 游戏评分插件做成安卓 App：内置全量快照，支持实时抓取、全量重建、批量翻译、详情页平台评分与分布，翻译只使用 **Bing**，不包含任何 DeepSeek / 大模型翻译。

## 版本历史

| 版本 | 内容 |
|---|---|
| [v1.0](versions/v1.0) | 初始 WebView 版本：列表、详情、封面、双语、Bing 简介翻译、双主题 |
| [v1.1](versions/v1.1) | 实时抓取、全量重建、批量翻译、详情平台评分与分布、持久化 |
| [v1.2](versions/v1.2) | Android 12 基线（minSdk/targetSdk 31），评分分布默认展示 |
| [v1.3](versions/v1.3) | 年份弹层、平台多选、排序精简、Material 3 组件、SplashScreen / Edge-to-edge / Material You |
| [v1.4](versions/v1.4) | 排序与年份改 M3 选择器，发行商移入标题信息行 |
| [v1.5](versions/v1.5) | 平台 + 年份索引，平台筛选结果与 Metacritic 官网一致 |
| [v1.6](versions/v1.6) | 筛选条件持久化，详情页新增「刷新数据」按钮 |
| [v1.7](versions/v1.7) | 首页新增「检查更新」与「GitHub 仓库」入口 |
| [v1.8](versions/v1.8) | 入口收进主题旁的「⋯」弹窗，按钮样式与「实时抓取」一致 |
| [v1.9](versions/v1.9) | 主题与「⋯」按钮合并靠右，主题在左、⋯在右 |
| [v2.0](versions/v2.0) | Must Play 筛选开关与详情页 Must Play 徽章 |

每个版本目录包含：

- `Metacritic-南仙-vX.Y.apk`：该版本安装包（可直接安装）
- `web/`：该版本 APK 内的前端代码（index.html / app.css / app.js / scraper-app.js）
- `screenshots/`：该版本界面截图
- `CHANGELOG.md`：该版本改动说明

## 源码

`android/` 为 v1.5 完整工程源码：

```
android/app/
  AndroidManifest.xml
  res/                      # 图标、应用名、主题（含 Android 12 SplashScreen 属性）
  src/com/nanxian/metacritic/MainActivity.java
  assets/www/               # index.html / app.css / app.js / scraper-app.js
```

游戏快照 `assets/www/data.js` 与平台索引由 `tools/gen-data.mjs`、`tools/build-platform-index.mjs` 生成，体积较大，不入库。

## 构建

```powershell
# 1. 生成数据（读取 ~/.dsh/metacritic-games/ 下的 games.json / translations.json / platforms.json）
node tools/gen-data.mjs

# 2. 编译打包（需要 JDK 17、Android build-tools 34、android.jar）
powershell -File tools/build.ps1 `
  -JdkBin "C:\path\to\jdk-17\bin" `
  -BuildTools "C:\path\to\build-tools\34.0.0" `
  -AndroidJar "C:\path\to\platforms\android-34\android.jar"

# 3. 签名（使用自己的 keystore）
```

签名密钥不入库；正式发布请使用自己的 keystore。

## 说明

- 数据来源 Metacritic，评分版权归 Metacritic 所有；翻译由 Bing 提供。
- 首次启动使用打包快照（14,440 款）；「实时抓取」更新最近年份，「全量重建」重爬 1995–当前。
- 平台筛选使用 Metacritic 平台筛选页建立的「平台 + 年份」索引，结果与官网一致。
