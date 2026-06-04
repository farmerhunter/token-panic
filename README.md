# token恐慌 / Token Panic

你的 token 还在燃烧。

---

一个快速查看多个 LLM 服务用量、余额和限额状态的小面板。

## 追踪的服务

- DeepSeek（余额型，official API）
- Kimi / Moonshot（余额型，official API）
- OpenAI Platform（费用型，official API）
- ChatGPT / Codex（限额型，Safari 辅助读取 / 手动录入）
- MiniMax（待接入）
- （可扩展）

## 核心指标

- 今日 / 本周 / 本月用量
- 余额型 provider 的剩余金额
- 限额型 provider 的窗口用量和重置时间
- 消耗速度（tokens/hour、cost/day 等）
- 按当前速度估算还能撑多久

## 目标

打开一眼就知道：

1. 哪个服务快用完了
2. 最近消耗了多少
3. 按这个速度还能撑多久

---

## 技术方案

token-panic 是一个 macOS 菜单栏工具，使用 Electron + React + TypeScript 构建。

数据获取采用分层 provider adapter：

- 优先使用 official API（DeepSeek、OpenAI Platform、Kimi）。
- ChatGPT/Codex 通过 Safari 辅助读取用户已打开的页面，或手动录入限额。
- 不保存网页登录凭证，不做 headless 浏览器自动抓取。

核心域模型把 provider 分为 `balance`、`limit`、`usage`、`cost` 等配额模型，UI 根据模型展示余额、限额、用量和消耗速度。

详细设计见 [architecture.md](design_docs/architecture.md)。

架构设计思想复盘见 [architecture_design_considerations.md](design_docs/architecture_design_considerations.md)。

---

## 轶事和感想

另外，用 Vibe Coding 的方式开发此应用的感受和感悟见 [anecdote_Introducing_view_model.md](design_docs/anecdote_Introducing_view_model.md)。
