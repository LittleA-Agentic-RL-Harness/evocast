# Evocast：技术调研与设计（v2）

> 2026-10-28 · 范围：AI 论文 / 行业研报 / 新闻 → 3–8 分钟、按受众定制的中英双人播客。
> 平台：Web（Vercel）· 可安装 PWA（macOS / Windows / iOS / Android）· Mac 本地应用（Electron）。
> 核心：两层递归自改进（RSI）——**内容 Harness**（怎么写节目）和**界面 Harness**（预填什么、展示什么），外加一张越拼越完整的听众画像。

---

## 0. 结论速览

| 维度 | 决策 | 依据 |
|---|---|---|
| 使用门槛 | **两把钥匙**：一个大模型 Key，一个 ElevenLabs Key。粘贴即实时校验；自动识别服务商，自动选用最新模型 | Anthropic 用 `models.list()`；OpenAI 兼容服务用 `/models`（同一家公司的国内、国际、Token Plan 地址依次尝试）；ElevenLabs 用 `/v1/user` 和 `/v1/models`，限定权限的钥匙读不到的部分用默认值。只按钥匙格式识别，**绝不拿 Key 去别家"试"**。推荐哪个模型由 `lib/llm/rank.ts` 决定：发布日期和价格取 OpenRouter、Vercel AI Gateway、models.dev 的中位数 |
| 语音 | 默认用 **Eleven v4 的 Text-to-Dialogue** 并开启 `with-timestamps`：一次请求合成两位主播，同时拿到每句的起始时间，文字稿可精确同步；相邻块之间传 `previous_text` / `future_text`，让语气连贯 | v4 于 2026-09-28 GA，支持 `zh`，$0.08/千字符；每次请求 ≤2,000 字符；对话接口默认仍是 v3，所以**必须显式传 `model_id`** |
| 新模型 | ElevenLabs 出现 `eleven_v5` 时**无需改代码**即可自动采用；Anthropic 默认 `claude-opus-5-5`，界面列出该 Key 可用的最新模型供切换 | `newestDialogueModel()` 和 `modelInfo()` 会推断未来的版本号 |
| ElevenLabs 深度用法 | 为每个主播位置做推荐（声音库 featured / trending + use_cases，按语言筛选）· 声音库搜索 · Voice Design（一句话描述 → 3 个候选 → 保存）· 即时克隆 · Eleven Music 片头 · 按套餐自适应 | 见第 3 节 |
| 跨平台 | 一套代码三种形态：Vercel Web、可安装 PWA、Mac 本地 `.app` / `.dmg`（内置完整 API，无需部署） | 第 5 节 |
| 前端 | 采用 Apple HIG 风格：系统色（2026 Indigo `#6155F5` / `#6D7CFF`）、√φ 字号阶梯、Fibonacci 间距、618px 黄金主栏、38.2/61.8 播放器分栏、半透明材质、弹簧动效、光标聚光与磁吸按钮，支持减弱动态和减弱透明 | 第 6 节 |
| 渐进披露 | 第一次打开只有一句问候和一个拖放框。「收听」在第 1 期后出现，「你」在第 2 期后出现，「细调」和「进化引擎」在第 2–3 期后出现；阈值本身也由界面 Harness 学习 | Findlater & McGrenere；NN/g |
| 个性化 | 结构化的听众画像（9 块拼图）、可固定为默认的字段、可编辑和删除的偏好记录、5 次里有 1 次「换个角度」的探索配额 | PersonaMem / PrefEval 显示 LLM 记忆不可靠；个性化会加剧信息茧房和迎合 |
| 自进化 | 内容：HarnessPro 全流程，选档权重取**论文附录 A 的 (1,2) / (1,1) / (2,1)**。界面：用回放评估预填命中率（零成本、无需标签）+ 规划器 + 线上守护（命中率回落自动回滚） | 第 4 节 |

---

## 1. 产品形态与使用路径

```
首次（30 秒）  欢迎 → 第一把钥匙（自动识别并验证）→ 第二把钥匙（读取套餐、选最新模型）→ "好了，{名字}。"
              （也可以直接选「演示模式」：不需要 Key，脚本是占位稿，音频是静音）

每次（3 步）   拖入 PDF / 粘贴链接
              → 一句话配方：为「工程师」做一期「5 分钟」的「中文」播客，「深度访谈」风格。
                 字段由 Harness 预填，✦ 一句话解释为什么这样选
              → 「生成」：提炼 → 写稿与校验 → 配音（金色流光）→ 自动打开播放器

使用中         收听：生成式封面、迷你播放器、Now Playing（逐句同步文字稿 / 要点与证据 / 校验结果）
              反馈：👍 / 👎 → 原因标签 → 一句话备注（可选）。收听进度、倍速、重听自动记录
              你：9 块拼图画像、记住的偏好（可删除）、「它如何为你预填」（命中率、现在学习）、进化引擎
```

**克制原则**：每个界面只做一件事；高级功能只在使用证明你需要时才出现。所有界面都可以在「设置 → 显示全部功能」里一次性打开。

---

## 2. 竞品格局与机会

（细节见 v1 调研，这里只列结论）

| 产品 | 缺口 |
|---|---|
| NotebookLM Audio Overviews | 无公开 API，不能选声音，常常超过 20 分钟，只有一个自由文本提示 |
| ElevenLabs GenFM / Studio Podcasts API | 需要申请开通，异步，无法插入校验与进化 |
| ListenHub、豆包 / 扣子、腾讯 ima、MiniMax | 不做受众分层，不做事实校验，不能选声音（豆包），没有自改进 |
| open-notebook（≈40.7k★）、Podcastfy（≈6.7k★） | 有 Speaker / Episode Profile，但没有闭环优化 |

**LittleA 的独特组合**：
- 一篇材料生成多个受众版本；
- 时长可控，并配要点覆盖测试；
- 中英文加中英混排术语；
- 数字校验；
- 空洞反应预算；
- 可观测、可回滚的两层自进化；
- 电商 / 供应链 / 金融的运营视角。

---

## 3. ElevenLabs：用到什么程度（2026-10 核实）

### 3.1 模型与接口

| 能力 | 接口 | 本项目用法 |
|---|---|---|
| 对话合成（带时间戳） | `POST /v1/text-to-dialogue/with-timestamps` | 返回 `voice_segments[].dialogue_input_index` 和 `start_time_seconds`，我们存下每句起点，实现逐句高亮与点句跳转。失败时降级到普通接口，按字数比例估算时间 |
| 跨块连贯 | `previous_text` / `future_text`（≤100 字符，2026-09-28 新增） | 每块带上前后文，减少拼接处的语气断裂 |
| 逐句 TTS | `POST /v1/text-to-speech/{voice}` | 用于 Flash 和 v4 Turbo（Lite 档），每句时长精确可知 |
| 模型清单 | `GET /v1/models` | 过滤 `can_do_text_to_speech` 和非 alpha 模型，选最新的 `eleven_vN` |
| 账户 | `GET /v1/user` | 读取套餐、额度、能否克隆、名字（用于问候） |
| 推荐 | `GET /v1/shared-voices` 参数 `featured`、`sort=trending`、`use_cases`、`gender`、`age`、`language` | 按「风格 × 语言 × 主持/嘉宾」组合查询；featured 结果不足时依次放宽 |
| 声音设计 | `POST /v1/text-to-voice/design`（`eleven_ttv_v3`），保存用 `POST /v1/text-to-voice` | 为每个位置预填 "Native Mandarin…" 描述 → 3 个候选 → 保存并使用。**所有套餐可用**，只按试听文字计费 |
| 克隆 | `POST /v1/voices/add`（IVC） | 强制勾选"本人或已获授权"；Starter 及以上套餐 |
| 片头 | `POST /v1/music`（`force_instrumental`，7 秒） | 每种声线生成一次并缓存；只有当采样率和声道与人声一致时才拼进 MP3。付费套餐可用，$0.15/分钟 |

### 3.2 默认声音（长期可用，不使用将于 2026-12-31 到期的旧默认声音）

| 声线 | 中文 A / B | English A / B |
|---|---|---|
| 深度访谈 Studio | James Gao `4VZIsMPtgggwNg7OXbPY` / Anna Su `9lHjugDhwqoxA5MhX0az` | Eddie `l7kNoIfnJKPg7779LI2t` / Alicia `BFd5oBc2DDna33pSi4Gf` |
| 甜妹电台 Idol | Shan Shan（北京）`ByhETIclHirOlWnWKhHc` / Lucy `r4thHOi5MAZw256OxDPJ` | Jade `g7LVvkPWALzPxOQbF6OE` / Elowen `dvbL7qkNGZY1IqPGZAjM` |

v4 在输出语言和声音母语不同时，会用目标语言的母语口音发音，适合双语主持。
社区声音可能被作者下架，所以每个位置都能一键替换（推荐、搜索、我的声音、设计）。

### 3.3 计费与限制

- **价格**：v4 / v3 / Multilingual 为 $0.08/千字符，Flash / v4 Turbo 为 $0.04。标点、空格和音频标签都计入字符。
- **免费套餐**：没有商用授权，API 也不能使用声音库声音（引导用户用「我的声音」或 Voice Design）。
- **并发**：Creator 为 5，Pro 为 10。我们逐块串行请求，不会触发上限。
- **前端调用**：官方要求不要把 Key 暴露在前端，而对话接口没有一次性 token，所以走无状态代理：Key 只放在请求头里，服务器不落盘。

---

## 4. 两层递归自改进（RSI）

### 4.1 内容 Harness —— HarnessPro 落地

| HarnessPro（arXiv 2610.26770） | LittleA |
|---|---|
| Harness = 指令、技能、hooks、验证、预算 | **基因组**：提炼规则、写稿规则、结构、钩子、每分钟字符数（中 / 英）、单轮上限、反应预算、音频标签密度、effort、是否校验、是否修订 |
| 固定的、LLM 生成的测试（失败召回从 41.7% 提到 83.3%） | T\*：每篇文档测试一次就固定；S\*：标准测试；P\*：受众测试；R\*：确定性规则测试 |
| 轨迹分析器 → 三种优先级的规划器 → 编辑器（git） | 分析器（同时写画像摘要、沉淀偏好）→ cost / balanced / quality 规划器 → **白名单 + schema 校验的补丁编辑器**（逐条拒绝非法操作、保留版本、可回滚） |
| 固定验证集，下限为 PR(h₀)，帕累托过滤，选档 J = αd²+βd² | 同样做法；**(α,β) = (1,2) / (1,1) / (2,1)（论文附录 A）**，可选拉开到 1:10；下限取三颗种子中最弱的那颗；归一化时设最小有效区间（通过率 5 个百分点、成本 10%） |

### 4.2 界面 Harness —— 把同一个闭环用在交互上（新）

| 环节 | 实现 |
|---|---|
| 基因组 | 预填策略（习惯 / 内容 / 混合）、习惯半衰期、内容权重、**预填规则（自然语言，可进化）**、渐进披露阈值、文案语气、最多 3 个一键快捷方式 |
| 轨迹 | 每次「生成」记录一条：预填值、最终选择、改了哪些字段、从打开到生成用了多久 |
| 标签 | 用户最终的选择本身就是标签：**完全无需人工标注** |
| 评估 | **回放命中率**：对每条历史会话，只用它之前的历史重新计算预填，统计 6 个字段里命中几个。零成本、确定性 |
| 自调参 | 在回放上网格搜索 strategy × halfLife × contentWeight，只接受严格更优的组合 |
| 规划器 | `ui-plan`：读取命中统计（哪些字段常被改）、画像、近期会话，重写预填规则、快捷方式、披露阈值和语气 |
| 编辑器 | `applyUIPatch`：每个字段都限幅和校验（语言只能是 zh/en，时长 2–8 分钟，视角在白名单内，等等） |
| 守护 | 改动后在线跟踪：新会话 ≥3 条且命中率比父版本低 10 个百分点以上 → 自动回滚 |
| 内容感知预填 | `/api/prefill`：读文档开头加画像加近期配方 → 推荐配方和一句理由；与习惯按权重融合；**被固定的字段永不覆盖** |

设计依据：
- Gajos 等：自适应界面的"准确度"比"可预测性"更重要 → 预填显示在固定位置，从不重排选项。
- Findlater & McGrenere：用户更喜欢自己能控制的界面 → 「固定为默认」。
- Johnson & Goldstein：默认值会强烈影响选择 → 只把"未修改"当作弱信号，并用守护机制兜底。
- 个性化带来茧房（Spotify 推荐使单个用户的收听多样性下降 11.5%）与迎合（带记忆的模型更容易附和用户）→ 设置探索配额，画像可见、可删除，规划器只能依据证据改动。

### 4.3 听众画像「拼图」

- **9 块**：角色、语言、时长、声线、关注、深度、节奏（倍速）、习惯（时段）、口味（赞踩与完听率）。每块有置信度，≥0.35（约 2–3 次一致证据）才"拼上"。
- **生成方式**：纯本地、结构化。之所以不交给 LLM 记忆，是因为 PersonaMem 实验里模型跟踪变化偏好的准确率只有约 50%。分析器只额外写一段可删除的文字画像。
- **用途**：画像以结构化文本注入预填和写稿提示词，也在「你」页面以拼图形式可视化。

### 4.4 评估风险与护栏

- **LLM 评委的偏差**：位置、啰嗦、偏爱自己的输出，以及"万能钥匙"式攻击。我们的做法：按单条测试判定、通过/失败二元化、加入规则测试。也可以把评委换成另一家族的模型（路线图）。
- **Goodhart 效应与上下文内奖励作弊**：编辑器看不到验证集的测试；验证集固定；设置下限；对界面设置回滚守护；每个改动都有 diff 和变更日志，由人决定是否采纳某个版本。
- **局限**：文本测试衡量不到音质，所以 TTS 模型不纳入进化，由用户按档位决定。

### 4.5 相关工作与借鉴（详见调研代理报告）

| 工作 | 可借鉴之处 |
|---|---|
| RHO、AHE、HarnessFix、HarnessX、Self-Harness | 基于 DPP 选核心集、每次编辑附带效果预测、把失败归因到具体规则、类型化插槽、回归测试 |
| GEPA | Pareto 候选池保留"专长型"提示词，例如专为高管写稿的版本 |
| SkillOpt、SkillMOO | 小步编辑、拒绝缓冲、按通过率 × 成本做 NSGA-II 多目标选择 |
| Dynamic Cheatsheet、ReasoningBank | 按受众维护"讲解模式"小抄 |
| Sleep-time Compute | 一篇材料只提炼一次，供所有受众和语言复用（已实现：中英共用同一次提炼） |
| COMPAS | 按难度把材料路由到 Lite / Medium / Heavy（路线图） |
| DGM、SICA、ADAS、Promptbreeder | 开放式归档；自改代码的风险提示：DGM 曾删除自己的幻觉检测标记 |

---

## 5. 跨平台

| 形态 | 方案 | 状态 |
|---|---|---|
| Web | Vercel（Next 16，函数 ≤300s，请求/响应 ≤4.5MB → 浏览器解析 PDF，TTS 分块） | ✅ |
| PWA | `app/manifest.ts`、多尺寸图标（含 maskable 与 Apple 图标）、手写 `public/sw.js`（外壳离线，绝不缓存 `/api`）、`storage.persist()` | ✅ |
| macOS（Safari「添加到程序坞」） | 无需 Service Worker，读取 `name` / `display` / `start_url` | ✅ |
| Chrome / Edge 安装（Mac / Windows）、Android WebAPK、iOS 主屏幕 | manifest 加 HTTPS 即可 | ✅ |
| **Mac 本地应用** | Electron 45：`utilityProcess.fork` 运行 Next standalone server（含全部 API），固定端口 43117（保证 IndexedDB 来源稳定），隐藏标题栏加红绿灯内嵌、可拖拽顶栏、ad-hoc 签名；`afterPack` 原样复制 server（`extraResources` 会丢掉 node_modules 和 .next） | ✅ `.app` / `.dmg` / `.zip`（arm64），已实机启动验证 |
| Windows 桌面版、x64 / universal 构建 | 同一套 Electron 配置加目标平台 | 路线图 |

首次打开未签名应用时，macOS 15 起需要到「系统设置 → 隐私与安全性 → 仍要打开」；若提示"已损坏"，可执行 `xattr -dr com.apple.quarantine "/Applications/Evocast.app"`。要正式分发，需 Apple Developer ID 签名和公证。

---

## 6. 视觉与交互系统

- **颜色**：Apple 系统色。浅色背景 `#F5F5F7`、标签 `#1D1D1F`；深色背景 `#000`、卡片 `#1C1C1E`。强调色 Indigo `#6155F5` / `#6D7CFF`。三档模式色：Lite Teal、Medium Indigo、Heavy Pink。
- **字号**：以 16px 为基准，按 √φ ≈ 1.272 递进：12.6 / 16 / 20.4 / 25.9 / 33 / 41.9 / 53.3。展示级标题使用 φ 量级。
- **间距与圆角**：间距用 Fibonacci 数列 5 / 8 / 13 / 21 / 34 / 55 / 89；圆角 8 / 13 / 21 / 34。
- **版式**：主栏 618px（黄金比例）；播放器 38.2 / 61.8 分栏；首页单栏居中。
- **材质**：顶栏、菜单、迷你播放器使用 `saturate(180%) blur(20–30px)`，0.5px 发丝线；用户开启减弱透明时退回实色。
- **动效**：快速、临界阻尼的 UI 弹簧（stiffness 420 / damping 36），出现时使用柔和弹簧。具体包括：
  - 导航胶囊、分段控件用 `layoutId` 滑动；
  - 配方字段切换时带模糊过渡；
  - 拼图逐块轻微旋转后"咔哒"落位；
  - 帕累托曲线逐段描出；
  - 生成时卡片外沿出现彩虹流光（conic gradient 绕行）；
  - 欢迎页的声波随"呼吸"起伏。
  - 所有动画都可打断，并遵循系统的"减弱动态"设置。
- **光标**：只在精确指针设备上启用。卡片有跟随光标的聚光，主按钮有 ≤5px 的磁吸，悬停时卡片轻微抬起。
- **生成式封面**：按标题哈希生成。深度访谈用深色、甜妹电台用糖果色；模糊色团配排版，接近 Apple Podcasts 的气质。

---

## 7. 音频与语速依据

- **英文**：舒适区约 150–170 wpm；125–250 wpm 理解基本不下降（Foulke & Sticht）；视频以 2 倍速播放理解无显著下降，2.5 倍会下降。
- **普通话**：朗读约 5.2 音节/秒；室内偏好约 4.0 音节/秒。默认取 250 字/分钟（约 4.2 字/秒），由 R1 测试和分析器自动校准。
- **形式**：双人对话更吸引人，独白更利于抓重点 → 用对话形式，并强制结尾用要点复盘（已写入写稿规则）。
- **信任**：AI 克隆声音有 58% 被判断为真人，有些 AI 声音反而被认为更可信 → 需要声明是 AI 合成，同时持续投入音质。

---

## 8. 成本（估算，待真实 Key 校准）

| 场景（Medium：Opus 5.5 + Eleven v4） | 合计 |
|---|---|
| 中文 5 分钟（约 1,250 字符） | 约 $0.4–0.5 |
| 英文 5 分钟（约 4,100 字符） | 约 $0.6–0.75 |
| 中英双语（共用一次提炼） | 约 $0.9–1.0 |
| 内容进化一轮（快速档，验证集 2 期） | 约 $0.5–1.5，不消耗 TTS |
| 界面进化一轮 | 回放免费，规划器约 $0.02 |
| 片头（每种声线一次） | 约 $0.02 |

---

## 9. 验证状态（本次）

| 项目 | 状态 |
|---|---|
| 单元测试 23 项：帕累托与论文权重、补丁编辑器、切块与原句映射、MP3、规则测试、清洗、受众画像、界面 Harness（习惯、融合、回放、自调参、守护、补丁限幅、披露）、服务商识别、新模型自动采用 | ✅ |
| TypeScript 类型检查、Vercel 生产构建、桌面 standalone 构建 | ✅ |
| 真实接口：Anthropic 和 ElevenLabs 对无效 Key 返回清晰错误；模糊 Key 正确触发选择服务商 | ✅ |
| 演示模式全流程（新界面）：两把钥匙页、arXiv 抓取、内容预填、配方菜单与固定、双语生成、阶段动画、自动打开播放器、逐句时间、会话轨迹、导航随使用出现、拼图、界面学习 | ✅ |
| 深色 / 浅色、桌面 / 375px 移动端无横向滚动 | ✅ |
| Mac 应用：打包、ad-hoc 签名验证、实机启动，3 秒内本地服务就绪，API 可用 | ✅ |
| **用真实 Key 生成一期**（音质、中文计费、标签效果、时间戳精度、片头格式兼容性） | ⏳ 需要你的 Key |

---

## 10. 路线图

- **P0**
  - 用真实 Key 各跑一期中文、一期英文，校准语速与成本，确认 `with-timestamps` 和片头拼接。
- **P1**
  - 评委改用另一家族模型。
  - 使用 `audio_effects`（演播室混响等）。
  - 用发音词典处理中文里的英文缩写。
  - 先出稿后配音（浏览器免费试听）。
  - 按难度路由到不同档位（COMPAS）。
- **P2**
  - 团队共享 Hub（Vercel Blob / KV，合并多人反馈一起进化）。
  - 订阅 arXiv、RSS，每天自动生成「AI 电商晨报」。
  - 输出 RSS 播客源。
  - Windows 与 universal 构建。
  - 正式签名与公证。
- **P3**
  - DPP 核心集。
  - GEPA 式 Pareto 提示词池。
  - 用真实完听率做线上 A/B。
  - 封装为 Claude Code Skill / MCP。

---

**参考**：HarnessPro arXiv:2610.26770 · ElevenLabs Docs（Text to Dialogue、Models、v4 best practices、Voice Library、Voice Design、Music、Pronunciation dictionaries、changelog 2026-09/10）· Vercel Functions Limits · Next.js PWA guide · Electron utilityProcess · Apple HIG（Motion、Materials、Color）· Gajos 2008 · Findlater & McGrenere 2004/2007 · Johnson & Goldstein 2003 · PersonaMem · PrefEval · Spotify diversity (arXiv 2003.08203) · CheckEval · TICK · GEPA · RHO · AHE · SkillOpt · Sleep-time Compute · COMPAS · DGM · PAIGE · Foulke & Sticht · Pellegrino 2011
