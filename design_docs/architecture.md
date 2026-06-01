# token-panic 架构设计

> 版本：草稿  |  最后更新：2026-05-26

---

## 项目概述

**token恐慌** 是一个 macOS 菜单栏工具，用来快速查看多个 LLM 服务的用量、余额或限额状态。

追踪的服务：ChatGPT/Codex、DeepSeek、OpenAI Platform、MiniMax（可扩展）。

核心目标：打开一眼就知道哪个服务快用完了、最近消耗了多少、按当前速度还能撑多久。

---

## 产品语言

不同 provider 的计费和限额体系不一样，产品层不统一称为“剩余 token 配额”，而统一表达为：

- **用量**：今天、本周、本月已经消耗了多少 token、请求量或费用。
- **余额/限额**：余额型 provider 显示剩余金额；限额型 provider 显示窗口内已用和总限额。
- **消耗速度**：按历史快照推算 tokens/hour、cost/day 或窗口消耗速度。
- **剩余时间**：按当前速度估算还能撑多久，无法可靠估算时不展示。

---

## Provider 配额模型

Provider 的数据不能强行归一成一种数字。Core domain 只归一化状态结构，不抹平业务差异。

| Provider | 优先数据源 | 配额模型 | 典型呈现 |
|----------|------------|----------|----------|
| **DeepSeek** | Official API | `balance` | 剩余金额 + 本月用量 |
| **MiniMax** | Official API 优先，必要时网页抓取 | `balance` | 剩余金额 + 本月用量 |
| **OpenAI Platform** | Official API | `usage` / `cost` | 今日/本月 token 和费用 |
| **ChatGPT / Codex** | Manual / user-mediated input | `limit` | 5 小时窗口、周窗口或计划限额 |

### Quota Model

- `balance`：预付费或充值余额模型，核心字段是剩余金额、币种和周期消耗。
- `limit`：窗口限额模型，核心字段是一个或多个时间窗口的 used/total/reset。
- `usage`：只有用量统计，没有明确余额或限额。
- `cost`：只有费用统计，或费用比 token 更适合做主指标。

---

## 核心设计决策

| # | 问题 | 决策 |
|---|------|------|
| 1 | Provider 数据来源不同 | 使用 `Provider Adapter` 抽象，优先 official API，网页抓取只作为 fallback |
| 2 | 配额模型异构 | Core domain 使用 `quota_model` + typed payload，而不是单一 token 字段 |
| 3 | UI 不应关心数据怎么来的 | Adapter 输出 normalized snapshot，Renderer 只消费 domain state |
| 4 | 网页抓取脆弱 | Browser adapter 只用于明确允许自动化且不需要绕过保护机制的数据源；ChatGPT/Codex 不走 browser scrape |
| 5 | 凭证敏感 | API key 和允许使用的 browser storageState 分开存放，后续接入系统 keychain；不保存 ChatGPT/Codex cookie 或 storageState |
| 6 | 早期复杂度控制 | MVP 先跑通内置 provider，不做 LLM 自助 parser |

---

## 分层架构

```
┌────────────────────────────────────────────────────┐
│                    Electron Shell                  │
│                                                    │
│  ┌──────────────────────┐      ┌────────────────┐  │
│  │ Main Process          │ IPC  │ Renderer        │  │
│  │                      │◄────►│ React Panel     │  │
│  │ Scheduler            │      │ Dashboard       │  │
│  │ Provider Adapters    │      │ Config          │  │
│  │ Core Domain          │      │ Alerts          │  │
│  │ Storage              │      └────────────────┘  │
│  └──────────────────────┘                          │
└────────────────────────────────────────────────────┘
```

### Provider Adapter

负责从 provider 获取原始数据，并转换为 normalized snapshot。

Adapter 类型：

- `official_api`：调用 provider 官方 API，优先使用。
- `browser_scrape`：用于明确允许自动化访问、且不需要绕过登录或反自动化保护的数据源。
- `custom_parser`：后续版本支持的用户自定义 parser。
- `manual`：用户手动录入余额或限额，作为低成本 fallback。
- `manual` 可带 `capture_method` 表示用户辅助来源，例如 `safari_visible_tab`：用户已打开并确认的 Safari 可见页面读取。

### Core Domain

负责业务计算，不关心数据来源：

- 校验 normalized snapshot。
- 计算消耗速度和剩余时间。
- 判断 `ok`、`stale`、`error`、`auth_required` 等状态。
- 生成面向 UI 的 provider summary。
- 维护历史快照。

### Renderer

负责展示和配置：

- 菜单栏 dashboard。
- Provider 开关、刷新间隔和凭证状态。
- 手动刷新。
- 错误提示和重新登录入口。

---

## 数据流

```
Scheduler / Manual Refresh
  │
  ▼
Provider Adapter
  ├── official_api: API key → provider endpoint → raw JSON
  ├── browser_scrape: permitted browser source → raw DOM/text
  └── manual: user input / pasted visible text / user-confirmed Safari visible tab → manual snapshot
  │
  ▼
Normalize
  │
  ▼
Core Domain
  ├── validate snapshot
  ├── calculate burn rate
  ├── derive remaining time
  └── update status
  │
  ▼
Storage → IPC → Renderer
```

---

## Normalized Snapshot

所有 adapter 都输出同一个外层结构，内部 payload 根据 `quota_model` 区分。

```ts
type ProviderSource = "official_api" | "browser_scrape" | "custom_parser" | "manual";
type ProviderStatus = "ok" | "stale" | "error" | "auth_required" | "disabled";
type QuotaModel = "balance" | "limit" | "usage" | "cost";

type ProviderSnapshot = {
  provider_id: string;
  provider_name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  captured_at: string;
  status: ProviderStatus;
  status_reason?: string;
  plan?: string;
  payload: BalancePayload | LimitPayload | UsagePayload | CostPayload;
};
```

### Balance Payload

```ts
type BalancePayload = {
  remaining_amount: number;
  currency: "CNY" | "USD" | string;
  period?: {
    key: "day" | "week" | "month";
    used_tokens?: number;
    spend_amount?: number;
    request_count?: number;
    starts_at?: string;
    ends_at?: string;
  };
};
```

`balance` 不要求 `total` 字段。充值、赠送、过期额度和后付费账单都可能让“总额”没有稳定含义。

### Limit Payload

```ts
type LimitPayload = {
  limits: Array<{
    window: "5h" | "day" | "week" | "month" | string;
    used: number;
    total: number;
    unit: "tokens" | "messages" | "requests" | string;
    resets_at?: string;
  }>;
};
```

### Usage Payload

```ts
type UsagePayload = {
  periods: Array<{
    key: "day" | "week" | "month";
    used_tokens?: number;
    request_count?: number;
    starts_at?: string;
    ends_at?: string;
  }>;
};
```

### Cost Payload

```ts
type CostPayload = {
  periods: Array<{
    key: "day" | "week" | "month";
    spend_amount: number;
    currency: "CNY" | "USD" | string;
    starts_at?: string;
    ends_at?: string;
  }>;
};
```

---

## Derived Metrics

Core domain 从历史快照推导展示指标。

```ts
type ProviderSummary = {
  provider_id: string;
  display_name: string;
  status: ProviderStatus;
  quota_model: QuotaModel;
  source: ProviderSource;
  primary_metric: string;
  secondary_metric?: string;
  burn_rate?: {
    value: number;
    unit: "tokens/hour" | "cost/day" | "requests/hour" | string;
    confidence: "high" | "medium" | "low";
  };
  estimated_remaining?: {
    value: number;
    unit: "hours" | "days";
    confidence: "high" | "medium" | "low";
  };
  last_fetch: string;
};
```

估算原则：

- 至少需要两个有效历史点才计算 burn rate。
- 余额型优先计算 `cost/day`，有 token 历史时再展示 tokens/hour。
- 限额型按对应窗口计算剩余比例和 reset 时间。
- 数据过期、窗口重置或历史点间隔过短时，降低 confidence 或不展示估算。

---

## UI 布局

### 菜单栏面板

面板按模型分组展示，文案使用“余额/限额/用量”，避免把所有 provider 都称为 token 配额。

```
┌──────────────────────────────────────────┐
│  token恐慌                    [刷新][设置]│
│──────────────────────────────────────────│
│  余额型                                  │
│  DeepSeek   ¥42.50 剩余   本月 380K tokens│
│  MiniMax    ¥8.20 剩余    本月 ¥12.40     │
│──────────────────────────────────────────│
│  限额型                                  │
│  ChatGPT   5h 1.2M/2M   周 3.8M/10M      │
│──────────────────────────────────────────│
│  用量/费用                               │
│  OpenAI    今日 120K tokens  $0.84       │
│──────────────────────────────────────────│
│  DeepSeek 按当前速度约还能撑 3 天         │
└──────────────────────────────────────────┘
```

状态：

- `ok`：抓取成功，数据可用。
- `stale`：数据可展示，但来源或 selector 已不可靠。
- `error`：当前无法获取新数据，展示最后成功快照。
- `auth_required`：API key 缺失、失效，或 browser 登录态过期。
- `disabled`：用户关闭该 provider。

### 配置面板

```
┌────────────────────────────────────────┐
│  设置                               关闭 │
│────────────────────────────────────────│
│  DeepSeek   启用  Official API  30m     │
│  OpenAI     启用  Official API  30m     │
│  ChatGPT    启用  Manual        -       │
│  MiniMax    关闭  Official API  -       │
│────────────────────────────────────────│
│  启动时自动刷新  开                    │
└────────────────────────────────────────┘
```

---

## Provider Adapter 设计

每个内置 provider 定义：

```ts
type ProviderAdapter = {
  id: string;
  name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  refresh_interval_min: number;
  fetchSnapshot(context: AdapterContext): Promise<ProviderSnapshot>;
};
```

### Official API Adapter

适用于有稳定 API 的 provider。

职责：

- 读取 API key。
- 调用 provider endpoint。
- 处理 rate limit、401/403、网络错误。
- 将 raw JSON 转换为 normalized snapshot。

失败策略：

- 401/403 → `auth_required`。
- rate limit → `stale`，保留上次成功快照。
- schema 变化 → `error`，记录 raw response 摘要供调试。

### Browser Scrape Adapter

适用于无 API 或 API 不覆盖目标数据、且明确允许自动化访问的 provider。ChatGPT/Codex 不使用 browser scrape：不做自动登录、不保存网页登录态、不做 stealth 或反检测实验。

职责：

- 在允许范围内复用 provider 明确可接受的浏览器会话或公开页面。
- 打开目标页面。
- 等待关键区域渲染。
- 使用主 selector 和 fallback selector 提取文本。
- 将 raw DOM/text 转换为 normalized snapshot。

失败策略：

| 检测点 | 响应 |
|--------|------|
| 跳转登录页 | `auth_required` |
| 主 selector 失败、fallback 成功 | `stale` |
| 所有 selector 失败 | `error`，保留上次成功快照 |
| 提取值格式异常 | `stale` 或 `error`，取决于是否还能生成可信 snapshot |

### Manual Adapter

适用于没有稳定官方 API、或网页自动化风险过高的 provider。

职责：

- 接收用户结构化输入或用户主动粘贴的可见文本。
- 将输入转换为 normalized snapshot。
- 不访问 provider 网页、不读取 cookie/localStorage、不保存网页登录态。

ChatGPT/Codex 当前使用 `manual + limit`。如果未来出现官方 API 或明确允许的集成方式，可以替换 source，但 Core Domain 和 Renderer 不应改变。

### Safari Visible-Tab Assisted Capture

这是 `manual` source 的用户辅助采集方式，不属于 `browser_scrape`。

适用条件：

- 用户已经在 Safari 中打开并登录目标 analytics 页面。
- 用户手动触发读取，并在读取前确认目标 tab URL。
- 应用只读取页面可见文本并在本地解析，结果由用户确认后保存。

硬性边界：

- 不打开登录页，不自动登录，不保存 cookie/localStorage/storageState。
- 不使用 Playwright、CDP、Chrome profile、stealth 插件或反检测参数。
- 不后台轮询，不自动重试，不默认 reload。
- URL 不匹配允许列表、页面出现登录/验证码/connection limited、内容为空或解析失败时，返回 `manual_required`。

---

## 存储设计

数据路径：`~/Library/Application Support/token-panic/`

```
token-panic/
  data.json
  providers.json
  history.json
  auth/
    browser/        # only for providers that explicitly allow browser automation
    api/
      deepseek.json
      openai.json
  debug/
    screenshots/
```

### data.json

保存当前状态和偏好。

```json
{
  "schema_version": 1,
  "snapshots": {
    "deepseek": {
      "provider_id": "deepseek",
      "provider_name": "DeepSeek",
      "source": "official_api",
      "quota_model": "balance",
      "captured_at": "2026-05-26T10:00:00Z",
      "status": "ok",
      "payload": {
        "remaining_amount": 42.5,
        "currency": "CNY",
        "period": {
          "key": "month",
          "used_tokens": 380000
        }
      }
    }
  },
  "preferences": {
    "auto_refresh": true,
    "default_refresh_interval_min": 30
  }
}
```

### providers.json

保存 provider 配置，不保存运行时快照。

```json
{
  "schema_version": 1,
  "providers": {
    "deepseek": {
      "enabled": true,
      "source": "official_api",
      "refresh_interval_min": 30,
      "low_balance_threshold": {
        "amount": 10,
        "currency": "CNY"
      }
    },
    "chatgpt": {
      "enabled": true,
      "source": "manual"
    }
  }
}
```

### history.json

保存历史快照，用于趋势和估算。早期可以按 provider 限制长度，例如每个 provider 最多 500 条。

```json
{
  "schema_version": 1,
  "history": {
    "deepseek": [
      {
        "captured_at": "2026-05-26T10:00:00Z",
        "quota_model": "balance",
        "remaining_amount": 42.5,
        "currency": "CNY",
        "used_tokens_month": 380000
      }
    ]
  }
}
```

### 凭证存储

MVP 可以先使用本地文件，但接口层要预留替换为系统 keychain：

- API key：按 provider 分文件存放，文件权限限制为当前用户可读写。
- Browser 登录态：仅在 provider 明确允许且实现需要时按 provider 保存；ChatGPT/Codex 不保存 cookie、localStorage 或 Playwright `storageState`。
- 不存储密码。
- debug 截图默认不自动上传，只保存在本机。

---

## 自定义 Provider

自定义 provider 分两个阶段实现。

### MVP

不做 LLM 自助 parser，只支持：

- 内置 provider。
- 手动录入 provider 余额或限额。
- 通过配置启用/禁用 provider。

### 后续版本

支持 LLM 辅助分析网页：

```
用户添加 provider
  → 打开浏览器并登录
  → 导航到用量/账单页
  → 应用提取可见文本和安全 DOM 摘要
  → 发给已配置的分析模型
  → 返回候选 fields 和 selectors
  → 用户确认或手动调整
  → 保存为 custom_parser
```

约束：

- 默认不发送完整 HTML、cookie、localStorage 或隐藏字段。
- LLM 输出必须通过 JSON schema 校验。
- selector 必须经过本地复跑验证。
- confidence 低于阈值时只能进入手动确认流程，不能自动启用。

---

## 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 应用壳 | Electron | macOS menubar 能力成熟，后续可扩展到 Windows/Linux tray |
| UI 框架 | React | 组件化，适合配置面板和 dashboard |
| 开发语言 | TypeScript | 用 discriminated union 表达 quota model，降低模型错用风险 |
| API 数据源 | Provider SDK / fetch | 有官方 API 时优先使用，稳定性高于网页抓取 |
| 网页抓取 | 待定 | 仅用于明确允许自动化且不需要绕过保护机制的数据源；ChatGPT/Codex 不使用 stealth/browser scrape |
| 数据存储 | JSON 文件 | 数据量小，便于调试和迁移 |
| 凭证存储 | 本地文件起步，后续 keychain | MVP 简单，接口保留安全升级空间 |

---

## 开发阶段

| 阶段 | 目标 | 交付 |
|------|------|------|
| 1. Core MVP | 跑通一个 official API provider | Adapter → normalized snapshot → storage → dashboard |
| 2. Domain Metrics | 增加历史和估算 | burn rate、remaining estimate、status derivation |
| 3. Manual Limit Provider | 跑通 ChatGPT/Codex manual limit provider | manual input → LimitPayload → dashboard |
| 4. Multi-provider | 接入 DeepSeek、OpenAI Platform、ChatGPT/Codex manual、MiniMax | 多模型 dashboard 和配置面板 |
| 5. Packaging | macOS 打包 | .dmg、本地数据路径、启动项 |
| 6. Custom Provider | 自定义 provider 能力 | manual provider，后续 LLM assisted parser |

---

## MVP 验收标准

- 至少一个 official API provider 能成功刷新并展示。
- snapshot、provider config、history 分文件持久化。
- UI 能展示 `ok`、`error`、`auth_required` 三种状态。
- 至少能根据两个历史点计算一个 burn rate。
- provider adapter 和 core domain 可以在不启动 Electron UI 的情况下单独测试。
- Browser scrape 能力不阻塞第一版发布；ChatGPT/Codex browser scrape 不进入默认路线。
