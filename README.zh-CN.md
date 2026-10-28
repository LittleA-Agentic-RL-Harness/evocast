<div align="center">

<img src="docs/assets/logo.png" width="96" height="96" alt="Evocast" />

# Evocast

### 会自我进化的 AI 原生播客

丢给它一篇 60 页的论文、研报或一个链接，它会为**你**写一期 **3–8 分钟的中英双人播客**。写稿用的 harness 还会**自己变得更好**。

[![CI](https://github.com/LittleA-Agentic-RL-Harness/evocast/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleA-Agentic-RL-Harness/evocast/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-6155f5)](LICENSE)
[![Release](https://img.shields.io/github/v/release/LittleA-Agentic-RL-Harness/evocast?color=bf5af2)](https://github.com/LittleA-Agentic-RL-Harness/evocast/releases)

[**在线体验**](https://evocast.vercel.app) · [**下载 Mac 版**](https://github.com/LittleA-Agentic-RL-Harness/evocast/releases/latest) · [架构](docs/ARCHITECTURE.md) · [调研](docs/RESEARCH.md) · [English](README.md)

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
</table>

<sub>截图来自内置的演示模式：不需要 Key，脚本是引用原文的占位稿，音频为静音；所用论文均为真实 arXiv 论文。</sub>

## 快速开始

- **直接用**：打开[在线体验](https://evocast.vercel.app)，填入两把钥匙，或者先试演示模式。想装成 App：Safari 选「文件 → 添加到程序坞」，Chrome / Edge 点「安装」。
- **一键部署自己的**：[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLittleA-Agentic-RL-Harness%2Fevocast&project-name=evocast&repository-name=evocast)
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

Key 只保存在你的设备上，服务端不存储、不记录，也没有任何遥测。

## 许可证与致谢

- **许可证**：[Apache-2.0](LICENSE) © 2026 LittleA。
- **方法来源**：自进化方法来自 HarnessPro（arXiv:2610.26770）。本项目是独立实现，与论文作者无关联。
- **声音**：由 ElevenLabs 提供。
