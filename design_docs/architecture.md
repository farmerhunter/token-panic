# token-panic 架构设计

> 版本：草稿  |  最后更新：2026-05-25

---

## 项目概述

**token恐慌** 是一个 macOS 菜单栏工具，快速查看多个 LLM 服务的 token 配额和使用量。

追踪的服务：ChatGPT/Codex、DeepSeek、MiniMax（可扩展）。

核心指标：今日/本周消耗、剩余配额、燃烧速率估算。

---

## 核心挑战与设计决策

| # | 挑战 | 决策 |
|---|------|------|
| 1 | 无官方 API，只能从各 provider 网站获取 | 使用 Playwright 无头浏览器抓取 |
| 2 | 每家展示格式不同 | 每个 provider 独立 parser，归一化输出 |
| 3 | 登录认证 | Playwright 手动登录一次，保存 storageState，后续静默复用 |
| 4 | 跨平台（macOS 优先） | Electron + Playwright + React，menubar/tray 自动适配 |
| 5 | 网页布局可能变更 | 主 selector → fallback selector → 标记 stale + 截图 |

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                  Electron Shell                   │
│  ┌──────────────┐    ┌─────────────────────────┐ │
│  │  Main Process │    │    Renderer (React)      │ │
│  │              │    │                         │ │
│  │  Scheduler   │ IPC │  Menu Bar Panel         │ │
│  │  Playwright  │←──→│  - Token Dashboard       │ │
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

```
┌──────────────────────────────────┐
│  token恐慌  🔥          [刷新][⚙] │
│──────────────────────────────────│
│  Provider  │ 剩余          │ 今日  │
│────────────│───────────────│───────│
│ 🟢 DeepS  │ 8.2M tokens   │ 152K  │
│ 🟢 GPT     │ $12.50        │ $3.2  │
│ 🟡 MiniMax │ 340K tokens ⚠ │ 89K   │
│──────────────────────────────────│
│ 估算按当前速率还能用 3 天          │
└──────────────────────────────────┘
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
│  显示速率估算    ☑                │
└──────────────────────────────────┘
```

---

## Parser 设计

每个 provider 一个 parser，定义三部分：

1. **目标 URL** — 用量页面的完整地址
2. **Selectors** — 主 selector + 备用 selector 列表（按优先级）
3. **Normalize** — 将原始提取文本转为统一数据结构

### 归一化输出格式

所有 parser 输出统一结构：

```
{
  remaining:    number,    // 剩余配额（token 数或金额）
  used_today:   number,    // 今日消耗
  used_week:    number,    // 本周消耗
  plan:         string,    // 套餐名称
  unit:         string,    // "tokens" | "usd" | ...
}
```

### Provider Parser 开发流程

1. 开发者提供 provider 名称和 URL
2. 打开页面，分析 DOM，确定 selector
3. 写好 parser，验证提取结果
4. 提交成为内置 provider

---

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

```json
{
  "providers": {
    "deepseek": {
      "remaining": 8234567,
      "used_today": 152000,
      "used_week": 980000,
      "plan": "V4 Pro",
      "status": "ok",
      "stale_since": null,
      "last_fetch": "2026-05-25T14:00:00Z",
      "history": [
        { "date": "2026-05-24", "used": 420000 },
        { "date": "2026-05-23", "used": 380000 }
      ]
    }
  },
  "preferences": {
    "refresh_interval_min": 30,
    "auto_refresh": true,
    "show_burn_rate": true
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
| 2. Multi-provider | 接入 ChatGPT + MiniMax | 3 个 provider parser |
| 3. Polish | 配置面板、错误处理、历史趋势 | 完整菜单栏 app |
| 4. Packaging | macOS 打包 + 跨平台验证 | .dmg 可分发给其他开发者 |
