<div align="center">

<img src="docs/assets/logo.png" width="96" height="96" alt="Evocast" />

# Evocast

### 会自我进化的 AI 原生播客

丢给它论文、研报、一整个文件夹的资料或几个链接，它会为**你**写一期 **3–8 分钟的中英双人播客**。写稿用的 harness 还会**自己变得更好**。

[![CI](https://github.com/LittleA-Agentic-RL-Harness/evocast/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleA-Agentic-RL-Harness/evocast/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-6155f5)](LICENSE)
[![Release](https://img.shields.io/github/v/release/LittleA-Agentic-RL-Harness/evocast?color=bf5af2)](https://github.com/LittleA-Agentic-RL-Harness/evocast/releases)

[**免费试用，不需要 Key**](https://evocast.vercel.app) · [**下载 Mac 版**](https://github.com/LittleA-Agentic-RL-Harness/evocast/releases/latest) · [架构](docs/ARCHITECTURE.md) · [运营](docs/OPERATIONS.zh-CN.md) · [调研](docs/RESEARCH.md) · [English](README.md)

<br/>

<img src="docs/assets/evocast-demo.gif" width="860" alt="Evocast 演示" />

</div>

---

## 为什么是 Evocast

1. **一篇材料，多个听众版本。** 研究员、工程师、高管/投资人、产品电商运营、新手，各自得到深度、术语、结构和收尾都不同的一期，并用针对每类听众的测试逐条校验。
2. **会自我改进，而且可度量。** 写稿 harness 按 **HarnessPro**（arXiv [2610.26770](https://arxiv.org/abs/2610.26770)）进化：
   - 用固定的无标签测试评估；
   - 分别按「省钱 / 均衡 / 质量」三种优先级规划改进；
   - 用帕累托筛选，自动维护「轻快 / 均衡 / 精品」三档。

   另一层 harness 进化的是**界面本身**。
3. **越用越懂你。** 预填什么、展示什么、出现哪些快捷方式，都从你的选择中学习：
   - 拿历史会话回放评估，不花一分钱；
   - 变差了就自动回滚；
   - 你的画像像拼图一样逐块拼上，数据只存在你的设备里。

| | Evocast | NotebookLM | ElevenLabs GenFM | Podcastfy / open-notebook |
|---|:-:|:-:|:-:|:-:|
| 开源、可自部署、自带 Key | ✅ | — | — | ✅ |
| 任意来源：PDF、Markdown、网页、Word、PPT、EPUB、ZIP、文件夹、链接 | ✅ 本机解析 | ✅ | ✅ | ✅ |
| 同一来源生成多个受众版本 | ✅ 5 类 | 只能写提示词 | 只能写提示词 | 有配置档 |
| 严格时长 + 要点覆盖测试 | ✅ | — | 时长档位 | — |
| 基于原文固定测试的事实校验 | ✅ | — | — | — |
| 自我进化的 harness（帕累托三档） | ✅ | — | — | — |
| 自我进化的界面与预填 | ✅ | — | — | — |
| 逐句同步文字稿 | ✅ | — | — | — |
| 选声音、设计声音、克隆声音 | ✅ | — | ✅ | 不一定 |
| Web / PWA / Mac 原生应用 | ✅ | Web | Web | Web / Docker |

## 界面一览

<table>
<tr>
<td width="50%"><b>创作：一句话配方，替你预填好</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/home-recipe-dark.png"><img src="docs/assets/home-recipe-light.png" /></picture></td>
<td width="50%"><b>收听：生成式封面</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/listen-dark.png"><img src="docs/assets/listen-light.png" /></picture></td>
</tr>
<tr>
<td><b>正在播放：逐句同步</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/player-dark.png"><img src="docs/assets/player-light.png" /></picture></td>
<td><b>你：越听越完整的画像拼图</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/you-dark.png"><img src="docs/assets/you-light.png" /></picture></td>
</tr>
<tr>
<td><b>首次打开：一句问候，一个拖放框</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/home-empty-dark.png"><img src="docs/assets/home-empty-light.png" /></picture></td>
<td><b>两把钥匙：自动识别，实时校验</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/keys-dark.png"><img src="docs/assets/keys-light.png" /></picture></td>
</tr>
<tr>
<td><b>欢迎页：不填 Key 也能免费试用</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/welcome-dark.png"><img src="docs/assets/welcome-light.png" /></picture></td>
<td><b>进化：真实跑出来的帕累托三档</b><br/><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/engine-dark.png"><img src="docs/assets/engine-light.png" /></picture></td>
</tr>
</table>

<sub>截图里都是用免费试用、从真实 arXiv 论文生成的真实节目：Claude Opus 5.5 写稿，ElevenLabs 配音，并真实跑过一轮进化。</sub>

## 快速开始

- **直接用**：打开 [evocast.vercel.app](https://evocast.vercel.app)，不填 Key 也能免费试用，或者填上自己的两把钥匙。想装成 App：Safari 选「文件 → 添加到程序坞」，Chrome / Edge 点「安装」。
- **一键部署自己的**：[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLittleA-Agentic-RL-Harness%2Fevocast&project-name=evocast&repository-name=evocast)。不需要任何环境变量；在 Vercel Marketplace 加上 Neon，就会打开埋点、管理后台和免费试用，费用和上限见[运营文档](docs/OPERATIONS.zh-CN.md)。
- **本地运行**：

  ```bash
  npm install && npm run dev
  ```
- **Mac 应用**：从 [Releases](https://github.com/LittleA-Agentic-RL-Harness/evocast/releases/latest) 下载 `.dmg`（Apple Silicon）。它会在本机运行全部接口，不需要部署。首次打开：「系统设置 → 隐私与安全性 → 仍要打开」。
- **命令行**：

  ```bash
  npm run podcast -- --url https://arxiv.org/abs/2610.26770 --persona engineer --lang zh,en
  ```

## 两把钥匙

| Key | 作用 | 说明 |
|---|---|---|
| **大模型** | 读懂原文、写稿、校验、进化 | 支持 Anthropic（默认 **Claude Opus 5.5**，实时列出你可用的最新模型），以及 DeepSeek、通义、Kimi、GLM、OpenRouter、Gemini 等 OpenAI 兼容接口 |
| **ElevenLabs** | 声音 | 读取你的套餐和额度，自动使用最新的对话语音模型（目前是 **Eleven v4**）。通过 API 使用声音库声音需要付费套餐 |

Key 只保存在你的设备上，服务端不存储、不记录。

## 免费试用（不需要 Key）

部署在 Vercel 上时，访客不填 Key 也能先试。试用由 [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) 运行 **Claude Opus 5.5** 和 **ElevenLabs**，用部署自带的 OIDC 身份认证（没有需要创建或轮换的 Key），费用记在团队的 AI Gateway 额度上。每次调用都按实际花费记到 Postgres，并有两道每日上限：每位访客（`TRIAL_VISITOR_USD`，默认每天 1.5 美元）和全站（`TRIAL_DAILY_USD`，默认每天 5 美元）；材料最多读取前 10 万字。没有数据库或设置了 `TRIAL=off` 时，欢迎页改为提供离线演示。不在 Vercel 上时，设置 `AI_GATEWAY_API_KEY` 即可。

## 什么都能导入

| 来源 | 方式 |
|---|---|
| **文件** | PDF、Markdown、网页、Word、PPT（含演讲者备注）、EPUB、Notebook、字幕、代码、CSV/JSON。可以一次拖多个、拖整个**文件夹**或 **ZIP**，合并成一个来源，每个文件一个小标题。全部在本机解析，大小只受内存限制 |
| **链接** | 一次粘贴一个或多个：arXiv（读取真实标题）、任意文章（包括公众号）、PDF、GitHub 仓库和文件、公开的 Google 文档/幻灯片/表格 |
| **Claude Artifacts、Notion、飞书** | 它们的分享页在浏览器里渲染，任何服务器都读不到正文。复制内容后粘贴（会保留标题和列表），或把导出的 `.md` / `.html` / `.zip` 拖进来 |

## 埋点与管理后台（给部署者）

连上任意 Postgres（Vercel → Storage → **Neon**，免费档即可），再设置 `ADMIN_PASSWORD`。每个页面、每次点击、导入和收听都会变成匿名的第一方事件，**`/admin`**（也可以通过 `ADMIN_HOST` 放在独立域名，比如 `admin.example.com`）里可以看到：

- **概览**：访客、会话、生成过节目的人、节目数和制作分钟、听完率，都和上一周期对比。
- **漏斗**：访问 → 设好钥匙或开始试用 → 导入 → 点击生成 → 节目生成 → 开始收听 → 听完 75%，每一步的流失，以及到第一期节目的中位时间。
- **来源**：完整的来源网址、`utm_*` 推广活动和落地页，各自的转化率；点任意来源，整个看板只看这部分人。
- **导入、点击、生成、收听、访客画像、前端报错**，以及实时事件流。
- **试用算力**：今天的试用花费和上限、AI Gateway 实时余额、大模型与语音各花了多少。
- **自助分析**：对 `events` 表的只读 SQL，内置留存、单个访客路径等查询，支持导出 CSV / NDJSON。

没连数据库就什么都不记录；具体记录和不记录哪些内容，见 [SECURITY.md](SECURITY.md)。

## 许可证与致谢

- **许可证**：[Apache-2.0](LICENSE) © 2026 LittleA。
- **方法来源**：自进化方法来自 HarnessPro（arXiv:2610.26770）。本项目是独立实现，与论文作者无关联。
- **声音**：由 ElevenLabs 提供。
