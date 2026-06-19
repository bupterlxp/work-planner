# 工作规划 · Mac App

把网页版「工作规划」封装成的**原生 macOS 应用**（SwiftUI + `WKWebView`）。界面与功能和网页版完全一致，但数据不再依赖浏览器缓存——它保存在磁盘上的一个真实文件里，**关掉、清浏览器、重启都不会丢**。

## 为什么做成 App

网页版的数据存在浏览器 localStorage 里，清缓存或换浏览器就没了。这个 App 把数据落到本机一个真实文件：

```
~/Library/Application Support/WorkPlanner/data.json
```

每次改动都会自动写入这个文件，启动时自动读回。换电脑 / 备份：用菜单「文件 → 导出备份…」导出，到新机器「导入备份…」即可。

## 用 Xcode 打开运行

1. 双击 `mac/WorkPlanner.xcodeproj` 用 Xcode 打开。
2. 顶部选中 **WorkPlanner** scheme，目标设备选 **My Mac**。
3. 按 **⌘R** 运行。

> 首次运行如果提示签名/Team：在 **Signing & Capabilities** 里，签名已设为「Sign to Run Locally」（无需 Apple 开发者账号即可在本机运行）。如果 Xcode 让你选 Team，可留空或选你的个人账号都行。

## 命令行构建（可选）

```bash
cd mac
xcodebuild -project WorkPlanner.xcodeproj -target WorkPlanner -configuration Release SYMROOT=build
# 产物：mac/build/Release/WorkPlanner.app —— 可拖进「应用程序」文件夹
```

## 菜单功能

- **文件 → 导出备份…**（⇧⌘E）：把数据导出成一个 JSON 文件。
- **文件 → 导入备份…**（⇧⌘I）：从 JSON 文件恢复（会覆盖当前数据并刷新）。
- **文件 → 在访达中显示数据文件**（⇧⌘R）：定位 `data.json`，方便手动备份或拖进 iCloud/Dropbox 同步盘。
- **文件 → 从磁盘重新载入**：重新读取数据文件刷新界面。

App 内右上角 ⋯ 菜单里的「导出 / 导入备份」也已接到原生的保存/打开面板，可正常使用。

## 结构

```
WorkPlanner.xcodeproj          Xcode 工程
WorkPlanner/
  WorkPlannerApp.swift         App 入口 + 菜单命令
  ContentView.swift            窗口内容
  WebView.swift                WKWebView 封装 + localStorage↔文件桥接 + 导入导出面板
  Store.swift                  数据文件读写（Application Support）
  web/                         网页版资源（index.html / app.js / styles.css / ...）
```

`web/` 是网页版的副本。网页有更新时，把根目录的 `index.html` `app.js` `styles.css` 等覆盖到 `web/` 即可（可用仓库根的 `sync-web.sh`）。

## 已知限制

- **OpenAI 模式**：App 内网页以 `file://` 方式加载，跨域 Origin 为 `null`，浏览器同源策略会拦截直连 `api.openai.com` 的请求——所以 App 里 **OpenAI 引擎可能用不了，本地引擎完全正常**。需要 OpenAI 时用网页版（GitHub Pages），或告诉我，我可以加一个自定义 URL scheme 让 App 内也能用 OpenAI。
- App 未做沙盒 / 公证，仅供本机个人使用；如需分发给别人，需要 Apple 开发者账号签名公证。
