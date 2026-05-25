# token-panic 架构设计

> 版本：草稿  |  最后更新：2026-05-25

---

## 项目概述

**token恐慌** 是一个 macOS 菜单栏工具，快速查看多个 LLM 服务的用量和余额。

追踪的服务：ChatGPT/Codex、DeepSeek、MiniMax（可扩展）。

核心目标：打开一眼就知道哪个服务快没钱了、今天用了多少、按这个速度还能撑几天。

---

## 各 Provider 配额模型差异

不同 LLM 服务的配额体系差异显著，不能简单统一为"token 剩余量"：

| Provider | 配额类型 | 周期粒度 | 呈现形式 |
|----------|---------|---------|---------|
| **DeepSeek** | 充值余额 | 月度统计 | 剩余费用（¥）+ 本月调用量 |
| **MiniMax** | 充值余额 | 月度统计 | 剩余费用（¥）+ 本月用量 |
| **ChatGPT / Codex** | Token 限额 | 5 小时限制 + 周限制 | 窗口内已用 / 总限额 + 周已用 / 周限额 |

这意味着：
- DeepSeek/MiniMax 关注的是「还剩多少钱」「本月用了多少」
- ChatGPT 关注的是「这个 5 小时窗口还能用多少」「本周配额还剩多少」
- 归一化输出结构需要兼容两种模型

---

## 核心挑战与设计决策

| # | 挑战 | 决策 |
|---|------|------|
| 1 | 无官方 API，只能从各 provider 网站获取 | 使用 Playwright 无头浏览器抓取 |
| 2 | 每家展示格式不同 | 每个 provider 独立 parser，归一化输出 |
| 3 | 配额模型异构（余额 vs token 限额 vs 时间窗口） | Parser 输出带 `quota_model` 标识，UI 按模型渲染不同指标 |
| 4 | 登录认证 | Playwright 手动登录一次，保存 storageState，后续静默复用 |
| 5 | 跨平台（macOS 优先） | Electron + Playwright + React，menubar/tray 自动适配 |
| 6 | 网页布局可能变更 | 主 selector → fallback selector → 标记 stale + 截图 |

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                  Electron Shell                   │
│  ┌──────────────┐    ┌─────────────────────────┐ │
│  │  Main Process │    │    Renderer (React)      │ │
│  │              │    │                         │ │
│  │  Scheduler   │ IPC │  Menu Bar Panel         │ │
│  │  Playwright  │←──→│  - Dashboard             │ │
│  │  Parsers     │    │  - ⚠️ Alerts              │ │
│  │  Storage     │    │  - Config Panel           │ │
│  └──────────────┘    └─────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Main Process**：定时调度抓取、Playwright 管理、parser 执行、数据持久化。
**Renderer**：React 渲染、用户交互、配置管理。

---

## 数据流

```
Scheduler (每 N 分钟 / 手动触发)
  │
  ├── DeepSeek  │ Playwright → 加载登录态 → 打开用量页面
  ├── OpenAI    │ → 等待 JS 渲染 → 提取 raw text
  ├── MiniMax   │ → Parser 归一化 → 写入 Storage
  │
  ▼
  IPC → Renderer 更新面板
```

---

## UI 布局

### 菜单栏面板

面板按配额模型分组展示：

```
┌────────────────────────────────────────┐
│  token恐慌  🔥              [刷新][⚙]  │
│────────────────────────────────────────│
│  💰 余额型                             │
│  DeepSeek  │ ¥42.50 / ¥100  本月 380K │
│  MiniMax   │ ¥8.20 / ¥50     本月 120K │
│────────────────────────────────────────│
│  🎯 限額型                             │
│  ChatGPT   │ 5h: 1.2M/2M   周: 3.8M/10M│
│────────────────────────────────────────│
│  ⚠ DeepSeek 余额不足 3 天              │
└────────────────────────────────────────┘
```

状态图标：
- 🟢 正常 — 抓取成功
- 🟡 stale — 数据可能过期，主 selector 失效，使用了 fallback
- 🔴 error — 无法获取，数据缺失

### 配置面板

```
┌──────────────────────────────────┐
│  配置                          ✕ │
│──────────────────────────────────│
│  ☑ DeepSeek  [登录]  刷新间隔 30m│
│  ☑ ChatGPT   [登录]  刷新间隔 30m│
│  ☐ MiniMax   [登录]  刷新间隔 —  │
│  [+ 添加]                        │
│──────────────────────────────────│
│  启动时自动刷新  ☑                │
└──────────────────────────────────┘
```

---

## Parser 设计

每个 provider 一个 parser，定义三部分：

1. **目标 URL** — 用量页面的完整地址
2. **Selectors** — 主 selector + 备用 selector 列表（按优先级）
3. **Normalize** — 将原始提取文本转为统一数据结构

### 归一化输出格式

Parser 输出带 `quota_model` 字段标识类型，UI 据此选择渲染方式：

**余额型**（DeepSeek、MiniMax）：

```
{
  quota_model: "balance",
  balance: {
    remaining:  42.50,     // 剩余金额
    total:      100.00,    // 充值总额
    currency:   "CNY",
  },
  usage: {
    this_month: 380000,    // 本月 token 调用量
    unit:       "tokens",
  },
  plan:         "V4 Pro",
}
```

**限额型**（ChatGPT / Codex）：

```
{
  quota_model: "limit",
  limits: [
    {
      window:   "5h",      // 时间窗口标识
      used:     1200000,
      total:    2000000,
      resets_at: "2026-05-25T19:00:00Z",
    },
    {
      window:   "week",
      used:     3800000,
      total:    10000000,
      resets_at: "2026-05-31T23:59:59Z",
    },
  ],
  plan:         "Plus",
}
```

### Provider Parser 开发流程

1. 开发者提供 provider 名称和 URL
2. 打开页面，分析 DOM，确定 selector
3. 确认配额模型类型（balance / limit）
4. 写好 parser，验证提取结果
5. 提交成为内置 provider

---

## 自助添加 Provider（LLM 辅助分析）

除了内置 parser，应用支持用户自助添加新 LLM 服务——不需要等开发者更新。

### 流程

```
用户点击「添加」
  → Playwright 打开浏览器 → 用户登录 → 导航到用量/账单页面
  → 点击「分析」
  → 应用截取页面 + 提取 DOM 可见文本摘要
  → 发给 LLM 分析（使用已配置的任一 provider 的 API）
  → LLM 返回：quota_model + fields（selector + 语义类型）
  → 展示预览让用户确认
```

### 确认界面

```
┌─────────────────────────────────────┐
│  检测结果                            │
│  类型：余额型                         │
│  余额：¥42.50    ← [.balance-amount]  │
│  本月用量：380K  ← [.usage .number]   │
│  套餐：V4 Pro    ← [.plan-badge]      │
│                                     │
│  [确认] [手动调整] [重新分析]          │
└─────────────────────────────────────┘
```

- **确认**：保存为自定义 parser，立即生效
- **手动调整**：用户在页面上点击元素重新标注
- **重新分析**：重新发 LLM 请求（用于 LLM 结果不对时）

### 分析 LLM 的选择

**使用已配置的任一 provider**（不是正在被分析的那个）。

原因：
- 鸡生蛋问题 — 被分析的 provider 还没接入，无法用它调用 API
- 已配置的 provider 有现成的 API key 和余额
- 一次分析仅消耗 ~2K tokens，成本可忽略
- 首次安装时至少有一个内置 parser（DeepSeek），可立即用作分析引擎

边界：如果所有已配置 provider 都余额耗尽或过期，分析功能暂时不可用。此时需要等至少一个恢复，或手动编辑 parser 配置。

### 发给 LLM 的 Prompt 结构

```
你是 token-panic 的页面分析器。

分析以下 LLM 服务商的用量/账单页面，判断配额模型类型，
提取关键数据字段和对应的 CSS selector。

页面可见文本内容：
[去除了 script/style 标签的 DOM 文本摘要]

请返回严格 JSON：
{
  "quota_model": "balance" | "limit",
  "confidence": 0.0 - 1.0,
  "fields": [
    {
      "key": "字段标识",
      "label": "页面显示的文字",
      "selector": "CSS selector",
      "type": "currency" | "tokens" | "text" | "percentage",
      "sample_value": "页面显示的示例值"
    }
  ]
}

规则：
- selector 必须是能从页面稳定提取该值的 CSS path
- 如果页面布局不清晰或无法确定，降低 confidence
- 不要猜测。无法确定的字段不要输出
```

### 存储格式（自定义 parser）

```json
{
  "id": "custom-deepseek",
  "name": "DeepSeek",
  "url": "https://platform.deepseek.com/usage",
  "quota_model": "balance",
  "fields": {
    "balance_remaining": {
      "selector": ".balance-amount",
      "type": "currency"
    },
    "monthly_usage": {
      "selector": ".usage-table tr:last td:last",
      "type": "tokens"
    },
    "plan_name": {
      "selector": ".plan-badge",
      "type": "text"
    }
  },
  "created_by": "llm_analysis",
  "last_verified": "2026-05-25"
}
```

### 与内置 Parser 的关系

```
内置 parser（手工维护）          自定义 parser（LLM 生成）
  deepseek.js       ← 精准       custom-1.json  ← 可自助
  chatgpt.js        ← fallback   custom-2.json  ← 即时
  minimax.js        ← 优化过
      ↓                              ↓
  开箱即用                      用户自助添加，无需等待
```

内置 parser 保留 — 它们更精确、有多层 fallback selector、经过验证。LLM 分析让用户不必等我们支持就能接入新 provider。

## 运行时防御：页面变更应对

三层 fallback 机制：

| 检测点 | 触发条件 | 响应 |
|--------|---------|------|
| 元素不存在 | 主 selector 返回 null | 依次尝试备用 selector |
| 提取值异常 | 结果不是预期格式 | 标记 stale，保留上次数据 |
| 连续失败 | 3 次提取均失败 | 标记 error，通知用户「页面可能已更新」 |
| 全部备用失效 | 所有 fallback 都失败 | 保留上次数据 + 自动截图供排查 |

### 状态流转

```
                    ┌──────────┐
        ┌──────────→│    ok    │←──────────┐
        │           └────┬─────┘           │
        │ fetch         │ selector          │ fetch
        │ success       │ missing           │ success
        │           ┌───▼─────┐             │
        │           │  stale  │──── fallback│
        │           └───┬─────┘    works    │
        │               │ 3x                │
        │           ┌───▼─────┐             │
        │           │  error  │             │
        │           └─────────┘             │
        │                                  │
        └──────────────────────────────────┘
```

- **stale**：仍展示数据 + ⚠️ 标记，不丢历史
- **error**：展示 🔴，7 天以上过期数据自动清除

---

## 存储设计

数据路径：`~/Library/Application Support/token-panic/`

### data.json — 运行时数据

Provider 的 `quota` 字段随 `quota_model` 不同而结构不同：

```json
{
  "providers": {
    "deepseek": {
      "quota_model": "balance",
      "balance": {
        "remaining": 42.50,
        "total": 100.00,
        "currency": "CNY"
      },
      "usage": {
        "this_month": 380000,
        "unit": "tokens"
      },
      "plan": "V4 Pro",
      "status": "ok",
      "stale_since": null,
      "last_fetch": "2026-05-25T14:00:00Z",
      "history": [
        { "date": "2026-05-24", "balance_remaining": 46.80 },
        { "date": "2026-05-23", "balance_remaining": 51.20 }
      ]
    },
    "chatgpt": {
      "quota_model": "limit",
      "limits": [
        {
          "window": "5h",
          "used": 1200000,
          "total": 2000000,
          "resets_at": "2026-05-25T19:00:00Z"
        },
        {
          "window": "week",
          "used": 3800000,
          "total": 10000000,
          "resets_at": "2026-05-31T23:59:59Z"
        }
      ],
      "plan": "Plus",
      "status": "ok",
      "stale_since": null,
      "last_fetch": "2026-05-25T14:00:00Z",
      "history": [
        { "date": "2026-05-24", "week_used": 3200000 },
        { "date": "2026-05-23", "week_used": 2800000 }
      ]
    }
  },
  "preferences": {
    "refresh_interval_min": 30,
    "auto_refresh": true
  }
}
```

### auth/ — 登录态

每个 provider 一个文件，存储 Playwright `storageState`（cookies + localStorage）。

```
auth/
  deepseek.json
  chatgpt.json
```

---

## 登录流程

1. 用户在配置面板点击 provider 的「登录」
2. Playwright 打开可见浏览器窗口，用户手动完成登录
3. 登录成功后自动保存 `storageState` 到文件
4. 后续抓取：headless 模式 + 加载已保存的 `storageState`
5. 若登录态过期（页面重定向到登录页）→ 通知用户重新登录

**不存储密码**。仅保存浏览器会话状态。

---

## 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 抓取引擎 | Playwright | 支持 JS 渲染、登录态管理、跨浏览器 |
| 应用壳 | Electron | 跨平台 menubar/tray、全 JS 栈统一 |
| UI 框架 | React | 组件化、生态成熟 |
| 菜单栏集成 | electron-menubar | macOS menubar ↔ Windows/Linux tray 自动适配 |
| 数据存储 | JSON 文件 | 数据量极小，无需数据库 |
| 开发语言 | TypeScript | 类型安全，大型项目更可控 |

---

## 开发阶段

| 阶段 | 目标 | 交付 |
|------|------|------|
| 1. Prototype | 跑通 DeepSeek 全链路 | 登录 → 抓取 → 解析 → 面板展示 |
| 2. Multi-provider | 接入 ChatGPT + MiniMax | 3 个 provider parser，余额型 + 限额型 |
| 3. Polish | 配置面板、错误处理、历史趋势 | 完整菜单栏 app |
| 4. Packaging | macOS 打包 + 跨平台验证 | .dmg 可分发给其他开发者 |
