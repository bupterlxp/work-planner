# 工作规划 · Work Planner

> **🔗 在线体验：<https://bupterlxp.github.io/work-planner/>** —— 打开即用，无需登录、无需安装。

一个零依赖、零构建、可离线安装的**工作规划记录**网页应用。看板 / 列表 / 本周 / 项目 / 能力五种视图，区分**长期项目**与**短期任务**，配有 **🧬 个人能力面板**与 **🤖 AI 工作总结**。纯前端运行，数据保存在**你自己浏览器**的 localStorage 里，不上传任何服务器。

![vanilla-js](https://img.shields.io/badge/vanilla-JS-f7df1e) ![no-build](https://img.shields.io/badge/build-none-success) ![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8) ![deploy](https://img.shields.io/badge/GitHub%20Pages-live-2ea44f)

> 适合个人工作规划、任务跟踪、周计划安排。打开即用，可作为 PWA 安装到桌面/手机离线使用。

## ✨ 功能

- **五种视图**
  - 📋 **看板**：在「待办 / 进行中 / 已完成」之间**拖拽**卡片，支持列内排序。
  - ☰ **列表**：按项目分组，信息密度高，行内可改状态、编辑、删除。
  - 🗓️ **本周**：未来 7 天 + 「待安排/无日期」区，把卡片**拖到某天即设为该天截止**，拖回待安排区清除日期。
  - 🗂️ **项目**：管理**长期项目**——每个项目一张卡，带目标、状态（进行中/搁置/已完成）、截止日、**里程碑**，并自动汇总旗下短期任务的**进度**与**能力贡献**。
  - 🧬 **能力**：能力雷达图 + 等级进度 + 成长记录（见下）。
- **🗂️ 长期项目 vs 短期任务**：长期项目是持续推进的大目标；短期任务归属于某个项目（编辑任务选「项目」即可）。项目视图按状态聚合、展示里程碑完成度与逾期提醒。
- **结构化字段**：标题、描述、项目（带颜色）、优先级（高/中/低）、状态、截止日期、**子任务清单**（带进度条）。
- **快速添加语法**：一行写完，例如 `完成季度汇报 #规划 !高 @周五`
  - `#项目` 归入项目（不存在自动创建）｜ `!高/!中/!低`（或 `!h/!m/!l`）优先级 ｜ `@今天/@明天/@后天/@周一…@周日/@2026-07-01` 截止日
- **🧬 个人能力面板**：预设 6 个能力维度（规划力、执行力、专业深度、协作沟通、学习成长、创新力）。**每完成一个工作项，系统会分析它锻炼了哪些能力并加分、升级**，长期沉淀为你的能力雷达图，并记录每一次成长。取消完成会自动扣回分数。
- **🤖 AI 工作总结**：一键生成今日 / 本周 / 全部进行中的工作进展总结。
  - **本地引擎**（默认）：离线、免费、隐私，基于关键词与数据自动生成。
  - **OpenAI 引擎**（可选）：在「AI 设置」填入 API Key，用**官方 OpenAI SDK** 获得更智能的总结与能力归因（模型可自由输入）。还可设置 **接口地址 Base URL**，指向任何**兼容 OpenAI 协议**的服务（DeepSeek / Moonshot / 通义千问 / OpenRouter / 本地 Ollama 等），留空即用官方接口。
- **搜索 + 筛选**：实时搜索；按项目、优先级筛选；一键隐藏已完成。
- **统计概览**：全部 / 待办 / 进行中 / 逾期 / 完成度（带进度条）。
- **数据安全**：导出 / 导入 JSON 备份；删除带「撤销」；自动从旧版数据迁移。
- **键盘快捷键**：`N` 新建、`/` 搜索、`1/2/3/4/5` 切视图（看板/列表/本周/项目/能力）、`?` 帮助、`Esc` 关闭。
- **炫酷体验**：极光渐变背景 + 玻璃拟态 + 微动效（升级有庆祝动画）；浅色 / 深色 / 跟随系统主题；响应式（手机可用）；PWA 可安装离线运行；尊重「减少动效」系统设置。

## 🤖 关于 AI（重要）

- **默认本地引擎**，开箱即用，不联网、不花钱、不上传任何数据。
- 想要更智能的总结与能力分析，可在 **右上角 ⋯ → AI 设置** 切换到 **OpenAI** 并填入你自己的 [OpenAI API Key](https://platform.openai.com/api-keys)。调用走**官方 `openai` SDK**（首次使用时从 CDN 按需加载，仅在 OpenAI 模式下加载，不影响本地引擎离线使用）。
- ⚠️ **运行环境**：OpenAI 模式需要通过 **http(s)** 访问（GitHub Pages 或本地服务器都可以）。直接双击 `index.html`（`file://`）时浏览器同源策略会拦截跨域请求，此时请用本地引擎，或用下方的本地服务器方式打开。
- ⚠️ **安全说明**：API Key 只保存在你浏览器本地（localStorage），由浏览器**直接**请求 OpenAI（SDK 的 `dangerouslyAllowBrowser` 选项）。请勿在公用电脑上填写密钥。这是个人本地工具的取舍——如需团队/生产使用，应改为经由你自己的后端代理调用，避免密钥暴露在前端。

## 🖥️ macOS App（数据存本地文件，不怕清缓存/换浏览器）

不想依赖浏览器缓存？仓库里的 [`mac/`](./mac/) 是一个用 **Xcode** 打开即可运行的原生 macOS 应用：用 `WKWebView` 封装同一套网页，但把数据落到磁盘真实文件
`~/Library/Application Support/WorkPlanner/data.json`（每次改动自动保存、启动自动读回），并提供原生「导出 / 导入备份」菜单。详见 [`mac/README.md`](./mac/README.md)。

```bash
open mac/WorkPlanner.xcodeproj   # 用 Xcode 打开，选 My Mac，⌘R 运行
# 或命令行构建：
cd mac && xcodebuild -project WorkPlanner.xcodeproj -target WorkPlanner -configuration Release SYMROOT=build
```

> 网页有更新后，运行根目录的 `./sync-web.sh` 把最新网页同步进 App 的 `mac/WorkPlanner/web/`。

## 🚀 本地预览

直接双击 `index.html` 即可使用。若要让 **Service Worker / PWA** 生效，需通过 http 访问：

```bash
cd work-planner
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 📦 部署到 GitHub Pages

1. 新建一个 GitHub 仓库，例如 `work-planner`。
2. 推送本目录：

   ```bash
   cd work-planner
   git init
   git add .
   git commit -m "feat: work planner app"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/work-planner.git
   git push -u origin main
   ```

3. 仓库 **Settings → Pages → Build and deployment**：
   - Source：**Deploy from a branch**
   - Branch：**main**，目录 **/(root)**，保存。
4. 约 1 分钟后访问：`https://<你的用户名>.github.io/work-planner/`

> 想用根域名 `https://<你的用户名>.github.io/` 访问，把仓库命名为 `<你的用户名>.github.io` 即可。
> 所有资源路径均为相对路径，子路径部署（`/work-planner/`）开箱即用。

## 🗂️ 文件结构

```
index.html              页面结构
styles.css              设计系统 / 主题 / 响应式
app.js                  全部逻辑（无依赖）
manifest.webmanifest    PWA 配置
sw.js                   Service Worker（离线缓存）
icon.svg, icons/*.png   应用图标
.nojekyll               让 Pages 原样发布
```

## ⚠️ 数据说明

- 数据存在**当前浏览器**本地，**不同浏览器 / 设备之间不互通**，清除浏览器数据会丢失。
- 换设备或备份：右上角 **⋯ → 导出备份**，在新设备 **⋯ → 导入备份**。
- 升级版本时若修改了缓存文件，请在 `sw.js` 顶部把 `CACHE` 版本号 `+1`，以便用户拿到新版。

## 🔧 自定义

- 主题色、圆角、阴影等都集中在 `styles.css` 顶部的 `:root` 变量里。
- 默认项目配色见 `app.js` 的 `DEFAULT_COLORS`。
