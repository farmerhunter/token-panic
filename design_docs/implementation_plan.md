# token-panic 分阶段实现规划

> 基于 [architecture.md](architecture.md) 和 [architecture_design_considerations.md](architecture_design_considerations.md)。
> 每个阶段是对上一阶段的增量扩展，阶段 1 是最小闭环。
> 当前文档已按 2026-06-03 的实际实现状态更新：阶段 1-4 baseline 已完成，Dashboard interaction contract 已补入阶段 4.5。

---

## 当前状态总览

| 阶段 | 状态 | 当前结论 |
|------|------|----------|
| 阶段 1 Core MVP | 已完成 | DeepSeek official API、Electron tray/panel、配置、IPC、storage 主链路已跑通 |
| 阶段 2 Domain Metrics | 已完成 | history、burn rate、estimated remaining、confidence 相关 domain 测试已覆盖 |
| 阶段 3 Manual Limit Provider | 已完成 | ChatGPT/Codex manual provider、Safari assisted capture、limit summary 已落地 |
| 阶段 4 Serviceability | 已完成 baseline | metadata trace、parser diagnostics、debug bundle、raw cache 策略已实现 |
| 阶段 4.5 Dashboard Interaction Contract | 已完成 | 单一 `View` 状态、统一 provider hook、dashboard ViewModel 和测试已落地 |
| 阶段 5 Multi-provider | 下一主线 | 接入更多 provider 前，先基于现有交互契约扩展 |
| 阶段 6+ Packaging / Custom Provider / Auto Update | 未来 | 等多 provider 和日常使用稳定后再推进 |

当前验证基线：

- `npm test -- --run`：已覆盖 domain、parser diagnostics、shared diagnostics、integration、dashboard ViewModel。
- `npm run build`：main + renderer build 已通过。

---

## 阶段 1：Core MVP —— 跑通一个 provider 的主链路（已完成）

### 目标用户体验

用户启动应用后：

1. macOS 菜单栏出现图标。
2. 点击图标，弹出面板，看到 **DeepSeek 余额**（如 `¥42.50 剩余`）。
3. 面板底部显示数据获取时间（如 `刚刚刷新`）。
4. 如果 API key 未配置，面板显示 `需要配置 API Key`，点击跳转配置。
5. 如果网络错误或 API 挂了，面板显示最后一次成功的余额 + `数据已过期（X 分钟前）`。

**一句话**：打开就看到 DeepSeek 还剩多少钱，以及这个数字靠不靠谱。

### 交付物

| 项目 | 内容 |
|------|------|
| Electron Shell | 菜单栏图标 + 弹出面板窗口 |
| Provider Adapter | DeepSeek official API adapter |
| Core Domain | validate snapshot + 生成 ProviderSummary |
| Storage | 读写 data.json（snapshot + preferences） |
| Renderer | 单 provider 面板：余额、状态、刷新时间 |
| IPC | main ↔ renderer 双向通信 |
| 配置 | 设置面板填写/更新 API key |

### 文件结构

```
token-panic/
  package.json
  tsconfig.json
  electron-builder.yml
  src/
    main/
      index.ts              # Electron main process 入口
      tray.ts               # 菜单栏图标 + 面板窗口管理
      preload.ts            # contextBridge 暴露 renderer API
      ipc-handlers.ts       # IPC channel 注册
      scheduler.ts          # 定时刷新（简单 setInterval）
      adapters/
        adapter.interface.ts  # ProviderAdapter 接口定义
        deepseek.ts           # DeepSeek official API adapter
      domain/
        normalize.ts          # raw JSON → ProviderSnapshot（仅校验+构造）
        summary.ts            # ProviderSnapshot + 历史 → ProviderSummary（含 fallback 合成）
      storage/
        store.ts              # JSON 文件读写，路径统一使用 app.getPath("userData")
      credentials/
        credential-store.ts   # API key 存取接口 + 文件实现
    renderer/
      index.html
      index.tsx
      App.tsx                 # 根组件
      components/
        BalancePanel.tsx      # 单 provider 余额展示
        StatusBar.tsx         # 状态 + 刷新时间
        ConfigPanel.tsx       # API key 配置
      hooks/
        useSnapshot.ts        # IPC 订阅 snapshot 更新
    shared/
      types.ts                # ProviderSnapshot, ProviderSummary, QuotaModel 等
```

### 数据流（阶段 1）

```
启动
  → main process 读 data.json（上次 snapshot + preferences）
  → 检查 deepseek API key 是否存在
    → 有 key：scheduler 立即 fetch + 每 30 分钟 fetch
    → 无 key：renderer 展示「需要配置 API Key」

DeepSeek Adapter.fetchSnapshot()
  → GET https://api.deepseek.com/user/balance（Bearer token）
  → 200：解析 raw JSON，构造 ProviderSnapshot（status = ok）
  → 401：返回 status = auth_required
  → 其他错误：返回 status = error（含 status_reason）
  → Adapter 只返回本次 fetch 结果，不读 storage，不持有历史状态

Core Domain
  → validate snapshot（字段存在、类型正确、金额非负）
  → 若 status != ok：从 storage 取 last_success_snapshot 作为 fallback 数据
  → 合成 ProviderSummary（status、primary_metric、last_fetch、fallback 数据的时效）
  → 例如 status = error 时：展示 last_success_snapshot 的余额 + "数据已过期（X 分钟前）"

Storage
  → 写 data.json（含最新 snapshot + preferences）

IPC
  → main 推送 snapshot:updated 到 renderer
  → renderer 更新面板展示
```

### IPC Channels

| Channel | 方向 | 触发时机 | Payload |
|---------|------|----------|---------|
| `snapshot:updated` | main → renderer | fetch 完成 | `ProviderSummary` |
| `snapshot:request` | renderer → main | 面板打开 | — |
| `refresh:trigger` | renderer → main | 用户点刷新 | `provider_id` |
| `config:get` | renderer → main | 配置面板打开 | — |
| `config:update` | renderer → main | 用户保存配置 | `{ provider_id, api_key }` |
| `snapshot:reply` | main → renderer | 响应 snapshot:request | `ProviderSummary` |
| `config:reply` | main → renderer | 响应 config:get | `{ provider_id, has_key }` |

### 明确不做

- 不做 browser scrape / Playwright
- 不做历史数据 / burn rate 计算
- 不做多 provider（只有一个 DeepSeek）
- 不做 macOS 打包（开发模式运行）
- 不做 Keychain 集成（API key 存本地文件）
- 不做自定义 provider / 手动录入
- 不做系统通知 / 低余额告警

### 验收标准

1. `npm run dev` 可启动，菜单栏出现图标。
2. API key 未配置时，面板显示「需要配置 API Key」。
3. 配置面板可输入和保存 API key；保存后立即触发刷新。
4. 配置 DeepSeek API key 后，面板显示余额。
5. 关闭面板再打开，数据保持（持久化）。
6. 30 分钟自动刷新，面板更新。
7. 手动点刷新按钮，面板更新。
8. API key 故意填错 → 面板显示「认证失败」。
9. 断网 → 面板显示最后一次成功余额 + 过期提示。
10. adapter 和 domain 逻辑可通过 `npm test` 独立测试（不启动 Electron）。

---

## 阶段 2：Domain Metrics —— 历史和估算（已完成）

### 增量目标

- 记录每次 fetch 的 snapshot 到 history.json
- 根据至少 2 个历史点计算 burn rate（cost/day 或 tokens/hour）
- 计算 estimated remaining（按当前速度还能撑多久）
- confidence 输出（high / medium / low）
- ProviderSummary 扩展：增加 burn_rate、estimated_remaining 字段

### 增量用户体验

面板从「¥42.50 剩余」变为：
```
DeepSeek   ¥42.50 剩余
           本月已用 380K tokens
           按当前速度约还能撑 12 天
```

---

## 阶段 3：Manual Limit Provider —— 接入 ChatGPT/Codex（已完成）

### 增量目标

- 实现 `manual` source 的 ChatGPT/Codex provider
- 支持结构化录入一个或多个 limit window（used / total / unit / resets_at）
- 将手动录入数据归一化为 `LimitPayload`
- ProviderSummary 支持 `limit` 模型展示
- 支持用户主动粘贴可见文本后的本地解析，解析结果必须由用户确认
- 支持 Safari 已打开 analytics tab 的用户辅助读取（`capture_method = "safari_visible_tab"`）
- 明确不做 ChatGPT 自动登录、browser scrape、storageState 复用或 stealth/反检测实验

### 增量用户体验

用户手动录入或粘贴 ChatGPT/Codex 限额后，面板增加 ChatGPT 行：
```
ChatGPT   5h 1.2M/2M  周 3.8M/10M
```

### 安全边界

- 不打开 ChatGPT 登录页。
- 不保存 ChatGPT cookie、localStorage 或 `storageState`。
- 不使用 Playwright、CDP、真实 Chrome profile 或 stealth 插件访问 ChatGPT。
- 不继续做 ChatGPT headless/headful 绕过实验；上次实验已经造成连接受限，继续实验风险过高。
- Safari assisted capture 只能由用户手动触发；默认不 reload、不轮询、不重试。
- 只读取已打开且 URL 匹配允许列表的 Safari tab；读取前必须显示目标 URL 并等待用户确认。
- 读取内容仅限页面可见文本；不读取 cookie、localStorage、sessionStorage 或隐藏字段。
- 解析结果必须由用户确认后才写入 snapshot/history。

### Safari assisted capture 探测步骤

1. 用 AppleScript 只列出 Safari tabs，确认是否存在 `chatgpt.com/codex/cloud/settings/analytics`，不激活页面。
2. 用户确认目标 tab 后，激活 Safari 并切到该 tab。
3. 通过 Safari Apple Events 执行只读 JS，读取 `document.body.innerText`；如果 Safari 未启用 `Allow JavaScript from Apple Events`，提示用户改用手动粘贴。
4. 本地 parser 提取候选 balance/limit 数据。
5. UI 展示候选值、来源 URL、读取时间，由用户确认后保存。

停止条件：

- URL 不匹配允许列表。
- 页面显示登录、验证码、connection limited、异常重定向或空内容。
- AppleScript/JS 读取失败。
- parser 找不到可信候选值。
- 用户取消确认。

---

## 阶段 4：Serviceability —— 传统运维与 agent 排查闭环（已完成 baseline）

### 增量目标

把本地 Electron app 的故障排查能力设计成一个完整闭环，同时兼容两类 serviceability：

- **传统线上运维视角**：trace/log/diagnostics 能说明系统在哪个阶段失败、失败频率如何、是否可归类为已知 failure state。
- **agent serviceability 视角**：debug artifact 能让用户把问题带回 coding agent，由 agent 快速复现、补测试、修 parser/IPC/UI，再让用户重新验证。

当前阶段优先覆盖 Safari assisted capture、manual parser、IPC 和 domain summary 这条最容易出问题的链路。

### 增量用户体验

当 Safari 读取或 parser 失败时，用户不只看到一行错误，而是看到可解释的诊断信息：

```
读取失败 / 解析失败
trace: safari-...
页面文本：1234 chars / 42 lines
parser 尝试：balance_keyword, limit_fraction
候选行：...
失败原因：candidate_lines_found_but_no_valid_limit

[导出诊断包] [导出含完整文本]
```

用户可以把 debug bundle 路径或诊断摘要发回 coding agent。agent 可以基于 bundle 中的 raw/redacted text 和 parser diagnostics 补充 fixture test，然后修改 parser 或 capture 边界逻辑。

### MVP 范围

| 能力 | MVP 要求 |
|------|----------|
| Trace correlation | 每次 capture/parse/save 生成或沿用 `trace_id` |
| Metadata log | 写入 metadata-only JSONL，不默认保存完整页面文本 |
| Failure taxonomy | 对 capture/parser/export 常见失败给出稳定 `failure_reason` |
| Parser diagnostics | 记录 strategy、candidate lines、文本长度、行数、失败原因 |
| Debug bundle | 用户显式导出 manifest、environment、trace、parser diagnostics |
| Raw data policy | raw text 默认只进短期内存缓存；显式选择后才写入 bundle |
| Agent handoff | bundle 中包含足够信息，能转化为 parser fixture/test |

### 传统 serviceability 设计点

- **事件 envelope 统一**：`timestamp`、`trace_id`、`component`、`action`、`status`、`reason`、`metadata`。
- **组件边界清晰**：Safari capture、text parser、manual save、summary generation、debug export 分别记录事件。
- **失败状态可归类**：避免只有自由文本错误；常见失败必须落到稳定 reason。
- **默认低敏**：默认 diagnostics 只记录规模、路径、状态和候选摘要，不记录 credential、cookie、localStorage、完整 raw text。
- **可回溯但不长期污染业务数据**：diagnostics 不进入 snapshot/history，不参与 burn rate。

### Agent serviceability 设计点

- **最小复现优先**：debug bundle 的目标不是完整遥测，而是让 agent 能快速回答“读到了什么、parser 为什么没认出来、应该加什么测试”。
- **fixture 转换路径**：raw/redacted text 应能复制到 parser fixture，形成失败测试，再修复 parser。
- **诊断摘要可复制**：UI 提供“复制诊断摘要”，包含 trace、failure_reason、candidate lines、bundle path。
- **schema version 明确**：debug bundle 包含 `manifest.json`，写明 bundle schema、trace id、capture method、是否包含 raw text。
- **raw/redacted 双轨**：后续优先支持 redacted text 或相关行上下文，减少把整页 raw text 交给 agent 的需要。

### Debug bundle 目标结构

MVP：

```
debug-bundle-<trace_id>/
  manifest.json
  environment.json
  trace.jsonl
  parser-diagnostics.json
  raw-text.txt              # 仅用户显式选择时存在
```

后续增强：

```
debug-bundle-<trace_id>/
  environment.json
  trace.jsonl
  parser-diagnostics.json
  redacted-text.txt
  raw-text.txt              # 仅用户显式选择时存在
  reproduction.md           # 可选：agent 排查提示，不在 MVP 自动生成
```

### 验收标准

1. Safari capture 成功和失败都能生成 `trace_id`。
2. Parser 失败时 UI 展示 parser diagnostics，不只展示自由文本错误。
3. 默认日志不包含完整页面文本、cookie、localStorage、API key。
4. 用户可导出不含 raw text 的 debug bundle。
5. 用户显式选择后，可在 raw cache 未过期时导出含完整文本的 debug bundle。
6. debug bundle 中的 parser diagnostics 足够支持新增一个 parser fixture test。
7. `npm test` 覆盖 parser diagnostics 的成功/失败路径。
8. `npm run build` 通过。

### 当前实现状态

阶段 4 MVP baseline 已实现：

- `src/shared/diagnostics.ts` 定义 diagnostics event、failure reason、debug bundle manifest 和诊断摘要 formatter。
- `src/main/diagnostics.ts` 写 metadata-only JSONL，维护短期 raw cache，并导出 manifest/environment/trace/parser diagnostics/raw text。
- `src/main/safari-capture.ts` 为 Safari tab 查找、JS probe、页面文本读取生成 trace 和稳定失败 reason。
- `src/domain/text-parser.ts` 提供 `parseLimitTextWithDiagnostics()`，保留原业务 parser API。
- `src/renderer/components/ManualInputForm.tsx` 在 parse 失败时展示 diagnostics，支持导出 debug bundle 和复制诊断摘要。
- 测试覆盖 parser diagnostics 与 shared diagnostics manifest/summary；`npm test` 和 `npm run build` 已通过。
- Parser 已支持 Codex analytics 页面的 percentage remaining section（Strategy 3: `section_percent_remaining`），含 regression fixture test。
- `LimitPayload.remaining` 字段已添加；`buildLimitSummary` 对 `unit === 'percent'` 展示为 `5h 40% 剩余`。
- `resets_at` 解析暂缓（DD-021），parser diagnostics 记录 candidate line 但不写入 snapshot。
- IPC listener lifecycle 已收尾：所有 `onXxx()` 返回 unsubscribe，组件 `useEffect` cleanup 正确注销。

### 明确不做

- 不接入远程 telemetry 平台。
- 不上传 debug bundle。
- 不自动收集完整页面文本或截图。
- 不把 diagnostics 写入 provider history。
- 不为排障重新引入 ChatGPT stealth、Playwright 登录或 browser scrape。

### 文档策略

当前阶段把关键决策记录在 `design_decision.md`，并以 [serviceability_design.md](serviceability_design.md) 作为持续维护的 serviceability 设计上下文，用于记录：

- 传统 serviceability 与 agent serviceability 的共通模型和差异。
- diagnostics event schema。
- failure taxonomy。
- debug bundle schema。
- raw/redacted data policy。
- 从 debug bundle 到 parser fixture/test 的协作流程。

该文档作为“可调试性架构上下文”，避免 serviceability 思考散落在 implementation plan、design decision 和代码注释中。

---

## 阶段 4.5：Dashboard Interaction Contract —— 交互语义归纳（已完成）

### 触发背景

阶段 3-4 后，dashboard 同时承载 DeepSeek balance provider、ChatGPT/Codex limit provider、Safari 读取、手动输入、diagnostics fallback 和设置入口。早期实现把交互状态分散在多个 boolean、provider hook 和 JSX 条件判断里，导致以下问题：

- ChatGPT snapshot 保存后能显示，但应用重启后可能没有通过 `snapshot:reply` 加载回来。
- ChatGPT 有数据后，Safari 更新和手动修改入口容易因为 JSX 分支变化而丢失。
- DeepSeek 和 ChatGPT summary 的订阅路径不一致，存在 provider 状态互相覆盖或遗漏的风险。

### 已落地决策

- renderer 顶层页面状态统一为单一 `View` discriminated union：
  - `dashboard`
  - `settings`
  - `quick-capture`
  - `manual-input`
- DeepSeek 和 ChatGPT 都通过 `useSnapshot(providerId, initialSummary?)` 订阅 provider summary。
- hook 同时监听 `snapshot:reply` 和 `snapshot:updated`，并按 `provider_id` 过滤。
- Dashboard 动作和 provider 卡片状态由 `toDashboardViewModel()` 生成，JSX 只负责渲染。
- ChatGPT/Codex 在无数据、`manual_required`、已有 Safari 数据、已有手动数据时，都保留：
  - `quick_capture_chatgpt`
  - `manual_input_chatgpt`

### 已交付文件

| 文件 | 作用 |
|------|------|
| `src/renderer/App.tsx` | 顶层 `View` 状态和 dashboard/subpage 渲染 |
| `src/renderer/hooks/useSnapshot.ts` | 统一 provider summary 订阅和 refresh hook |
| `src/renderer/dashboard-view-model.ts` | Dashboard interaction ViewModel |
| `src/renderer/dashboard-view-model.test.ts` | 交互 action availability 回归测试 |
| [dashboard_interaction_contract.md](dashboard_interaction_contract.md) | Dashboard 交互契约 |
| [design_decision.md](design_decision.md) DD-022 | View union + ViewModel 架构决策 |

### 验收标准

1. Dashboard 顶部始终提供刷新 DeepSeek 和设置入口。
2. ChatGPT/Codex 无数据时仍显示 Safari 读取和手动输入。
3. ChatGPT/Codex 已有 Safari 数据后仍显示 Safari 更新和手动修改。
4. DeepSeek 和 ChatGPT summary 互不覆盖。
5. `npm test -- --run` 覆盖 ViewModel 行为。

### 后续边界

当前不引入 React Router、Zustand/Redux、XState 或 UI component framework。若后续出现跨窗口导航、复杂异步取消、批量 provider 管理、undo/redo、多步骤 wizard 或明显的视觉系统复用压力，再重新评估。

---

## 全阶段通用准则

### 测试优先

下列场景必须 test-first——先写测试定义契约，测试失败后再写实现：

- 新增或修改 provider adapter（先写 adapter raw→snapshot 测试 + error case 测试）
- 新增或修改 Dashboard ViewModel（先写 action availability 测试 + provider isolation 测试）
- 新增或修改 parser（先写 fixture→parse result 测试 + failure reason 测试）
- 新增或修改跨层数据字段（先更新 ViewModel test fixture 验证字段传递）

不强制 test-first 的场景：纯样式调整、文案修改、已有的 renderer 组件内部重构（不改变交互契约时）。

---

## 阶段 5：Multi-provider —— 全量接入

（下一主线）

### 前置原则

- 新 provider 接入不破坏已有 ChatGPT/Codex Safari/manual 入口和 DeepSeek balance 刷新。
- Dashboard 行为由 `toDashboardViewModel()` 和其测试保护。
- JSX 不直接写 provider-specific 判断。
- 每加一个 provider，补 ViewModel tests。

### 增量目标

- OpenAI Platform（official_api + cost）— 已实现
- Kimi / Moonshot（official_api + balance）— 已实现
- MiniMax（official_api + balance）— deferred，等待 API 文档验证
- 多 provider 配置面板（ApiKeySection 组件 × 3）+ config-view-model.ts 契约
- 按 quota_model 分组展示（余额型 / 限额型 / 用量费用型），balanceProviders 数组化
- 复用阶段 4.5 的 dashboard ViewModel，不在 JSX 中新增散落的 provider-specific action 判断
- 新 provider 的 failure state、diagnostics 和 user-facing action 必须先进入 provider summary / interaction contract

### 增量用户体验

面板按模型分组，4 个 provider 一目了然。

### 进入阶段 5 前置检查

- Dashboard interaction contract 与当前 UI 行为一致。
- 新 provider 的 source、quota_model、refresh 语义已在 design decision 中明确。
- 如果 provider 依赖第三方 API 或页面行为，先做最小可丢弃实验验证可行性。
- 每个 provider 的配置入口、刷新入口、错误状态和 fallback 行为必须能被 ViewModel 表达。

---

## 阶段 6：Packaging —— macOS 打包

（阶段 5 完成后扩展）

### 增量目标

- electron-builder 打包 .dmg
- 启动项支持
- macOS 公证（notarization）

### 增量用户体验

用户可通过 .dmg 安装，数据目录固定在 `~/Library/Application Support/token-panic/`。

---

## 阶段 7：Custom Provider —— 自定义能力

（阶段 6 完成后扩展）

### 增量目标

- LLM 辅助分析网页（custom_parser adapter）
- 用户自定义 provider 配置流程
- 对明确允许自动化或用户自有页面的数据源，重新评估 browser_scrape/custom_parser 的可行性

---

## 阶段 8：Auto Update —— 自动更新

（阶段 6 完成后扩展，独立于阶段 7）

### 增量目标

- electron-updater 集成
- 更新 feed 服务器配置
- 代码签名证书
- 回滚策略

---

## 技术约束（全阶段通用）

- TypeScript strict mode，用 discriminated union 表达 quota model
- Adapter 接口统一，domain 纯函数可测试
- IPC 使用 contextBridge + preload script（Electron 安全最佳实践）
- 凭证文件权限 `0o600`
- 所有外部请求有超时（默认 15s）
- Debug 截图仅存本地，不上传
