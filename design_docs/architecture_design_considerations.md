# 架构设计思想复盘

> 基于 token-panic 架构重设计过程整理，可作为后续软件项目架构设计时的参考。

---

## 背景

token-panic 的第一版设计已经可以落地：Electron 负责菜单栏应用，React 负责面板展示，Playwright 抓取 provider 页面，parser 解析数据，JSON 文件保存状态。

这条路径的问题不在于“不能用”，而在于它把当前最显眼的实现困难放在了架构中心：如何抓网页、如何写 parser、如何保存抓取结果。

重设计后的版本把中心换成了更稳定的业务事实：

- 用户关心 provider 的用量、余额、限额和风险状态。
- 不同 provider 的配额模型不同。
- 数据来源会变化，可以是 official API、browser scrape、manual input 或 custom parser。
- UI 只应该展示 domain summary，不应该知道数据是怎么取来的。
- 外部 provider 一定会失败、变更或过期，所以失败状态应作为 domain model 的一部分。

因此新版架构从：

```text
Playwright 抓网页 → parser → storage → UI
```

调整为：

```text
Provider Adapter → Core Domain → Storage / Renderer
```

这个变化不是技术栈替换，而是设计中心的迁移：从“怎么抓到数据”迁移到“如何稳定表达 provider 状态，并允许不同来源逐步接入”。

---

## 主要出发点

### 1. 不让当前实现手段成为架构中心

第一版默认所有 provider 都要通过 Playwright 抓网页。这个假设在早期看起来合理，因为 ChatGPT/Codex 这类服务确实可能没有稳定公开 API。

但一旦引入 DeepSeek、OpenAI Platform 等有 official API 的 provider，Playwright 就不应该再是系统主轴。它只是某类 provider 的获取方式。

新版设计把 Playwright 降级为 `browser_scrape` adapter 的实现，把 official API、manual input、custom parser 都纳入同一个 `Provider Adapter` 边界。

可传承的原则：

> 工具可以是某个边界的实现方式，但不应该直接成为系统的核心抽象。

### 2. 识别长期稳定的业务事实

架构应该围绕相对稳定的事实建模，而不是围绕暂时的技术障碍建模。

在 token-panic 中，相对稳定的事实是：

- provider 有状态。
- 状态来自某个 source。
- 状态属于某种 quota model。
- 状态可以被归一化、持久化、展示和用于趋势估算。

相对不稳定的是：

- provider 是否提供 API。
- API 字段如何命名。
- 网页 selector 是否稳定。
- 第一版 UI 用 Electron 还是别的 shell。
- 历史数据用 JSON 还是 SQLite。

因此新版将稳定部分沉到 `Core Domain`，将不稳定部分隔离到 adapter、storage、renderer 等边界。

### 3. 把独立变化的维度分开建模

旧版的 parser 同时承载了数据来源、提取方式和 quota model。新版拆成两个独立维度：

```ts
source: "official_api" | "browser_scrape" | "custom_parser" | "manual";
quota_model: "balance" | "limit" | "usage" | "cost";
```

这样可以自然表达组合：

- DeepSeek：`official_api + balance`
- OpenAI Platform：`official_api + usage/cost`
- ChatGPT/Codex：`manual + limit`（不做 stealth/browser scrape）
- 手动录入：`manual + balance`
- 未来自定义网页：`custom_parser + balance/limit`

可传承的原则：

> 两个会独立变化的维度，不要塞进同一个概念。否则扩展时会制造大量例外和条件分支。

### 4. 统一外层协议，保留内部差异

provider 的数据不能强行统一成“剩余 token”。余额、窗口限额、费用、请求量都是真实存在的不同模型。

新版采用统一外层结构：

```ts
ProviderSnapshot {
  provider_id;
  source;
  quota_model;
  status;
  captured_at;
  payload;
}
```

但 `payload` 根据 `quota_model` 保留差异：

- `BalancePayload`
- `LimitPayload`
- `UsagePayload`
- `CostPayload`

这体现了一个重要原则：

> 统一入口和生命周期，不强行统一业务语义。

这种设计既让 UI、storage、history 能统一处理 provider 状态，又避免用一个脆弱的大字段模型去覆盖所有 provider。

### 5. 把失败状态作为一等公民

依赖外部 provider 的系统一定会失败：

- API key 失效。
- 登录态过期。
- provider rate limit。
- 网页 selector 变更。
- 网络错误。
- 数据过期但旧快照仍有展示价值。

如果这些情况只作为异常处理，代码会很快变成到处散落的 try/catch 和 fallback 判断。

新版把状态显式建模为：

```ts
status: "ok" | "stale" | "error" | "auth_required" | "disabled";
```

并让 adapter 负责把外部失败转换为 domain status，让 UI 只消费清晰状态。

可传承的原则：

> 系统一定会遇到的失败，不是边缘异常，而是 domain state。

### 6. 让 UI 依赖 summary，而不是原始数据

UI 不应该直接理解每个 provider 的原始结构，也不应该承担 burn rate、remaining estimate、confidence 等业务推导。

新版增加 `ProviderSummary` 概念，由 Core Domain 根据 snapshot 和 history 生成面向展示的模型：

- primary metric
- secondary metric
- burn rate
- estimated remaining
- confidence
- last fetch

这样 UI 只负责布局和交互，业务规则留在可测试、可迁移的 domain 层。

可传承的原则：

> Renderer 展示状态，Core Domain 推导状态。

### 7. MVP 验证主链路，不验证全部想象力

第一版设计中的 LLM 自助 parser 很有价值，但它不是系统地基。它涉及 DOM 摘要、隐私脱敏、LLM JSON schema、selector 验证、用户确认和失败回滚，复杂度高且不确定。

新版将它放到后续阶段，MVP 只验证最小闭环：

```text
一个 provider 可获取
→ 可归一化
→ 可持久化
→ 可展示
→ 可计算简单趋势
```

可传承的原则：

> MVP 应该验证系统主链路和关键边界，不应该把所有未来能力都压进第一版。

### 8. 技术选型服务于边界

技术栈不是架构本身。Electron、React、Playwright、JSON 文件、TypeScript 都只是某个边界的实现选择。

在新版中：

- Electron 实现 shell。
- React 实现 renderer。
- Playwright 或其他浏览器自动化只在明确允许自动化的数据源中实现 browser scrape adapter。
- JSON 文件实现 storage。
- TypeScript union types 实现 quota model 的类型约束。

如果未来替换 React、换成 SQLite、把凭证迁到 Keychain，核心架构仍然成立。原因是设计先定义了边界，再为边界选择实现。

可传承的原则：

> 技术栈回答“怎么实现”，架构回答“变化发生时系统如何保持局部稳定”。

---

## 架构设计时应优先提出的问题

在类似项目中，进入技术选型前应先问：

1. 用户真正关心的 domain state 是什么？
2. 哪些概念是长期稳定的，哪些只是当前实现手段？
3. 哪些维度会独立变化？
4. 是否存在被强行统一的业务差异？
5. 外部依赖会如何失败？这些失败是否应该进入 domain model？
6. UI 是否依赖了过多原始数据或业务推导？
7. 第一版要验证哪条主链路？哪些能力可以后置？
8. 如果替换某个技术，架构文档是否仍然成立？

这些问题比“用什么框架”更早，也更重要。

---

## 可复用设计原则

### 原则一：围绕稳定业务对象建模

不要让当前最棘手的实现手段主导架构。先识别系统长期稳定的业务对象和状态，再决定用什么技术获取、存储和展示它们。

### 原则二：拆开独立变化维度

当两个概念会独立变化时，应分别建模。把它们塞进同一个 abstraction 会让扩展变成条件分支和例外处理。

### 原则三：统一协议，保留语义差异

统一生命周期、元数据和外层协议，但不要强行统一不同业务模型的内部字段。好的归一化不是抹平差异，而是让差异有明确归属。

### 原则四：把必然失败建模为状态

外部系统失败、认证过期、数据过期、schema 变化等情况如果一定会发生，就应该成为 domain state，而不是散落在实现中的异常。

### 原则五：让 UI 消费展示模型

UI 应该消费由 domain 层推导出的 summary，而不是直接解析原始数据或承担业务计算。这样业务规则可以测试，展示层可以替换。

### 原则六：MVP 验证主链路

MVP 只需要验证系统的关键闭环和边界是否成立。高不确定性、高复杂度、增强型能力应后置，不要让它们决定第一版结构。

### 原则七：技术选型服务于边界

先定义系统边界和变化归属，再选择技术栈。技术可以替换，边界应该尽量稳定。

---

## 可放入 Skill 的压缩版

以下文字可抽象为通用软件项目架构设计指导：

```md
## 架构设计原则

在做软件架构设计时，不要先从技术栈或当前最显眼的实现困难出发。先识别系统中长期稳定的业务对象、状态和生命周期，再判断哪些维度会独立变化，并为这些变化建立清晰边界。

优先回答这些问题：

- 用户真正关心的 domain state 是什么？
- 哪些概念长期稳定，哪些只是当前实现手段？
- 哪些维度会独立变化，是否应该分别建模？
- 是否存在被强行统一的业务差异？
- 外部依赖会如何失败，这些失败是否应成为 domain state？
- UI 是否依赖了原始数据或承担了业务推导？
- MVP 要验证哪条主链路，哪些能力应后置？
- 如果替换某个技术，架构是否仍然成立？

设计时遵循这些原则：

1. 不让当前实现手段成为架构中心。工具只应是某个边界的实现方式。
2. 围绕稳定业务对象建模，把不稳定实现隔离在 adapter、storage、renderer 等边界内。
3. 拆开独立变化维度，不把 source、model、transport、presentation 等概念混成一个 abstraction。
4. 统一外层协议和生命周期，但保留内部业务语义差异。
5. 把必然发生的失败建模为状态，而不是散落的异常处理。
6. 让 UI 消费由 domain 层推导出的 summary，不直接解析原始数据或承担核心业务计算。
7. MVP 验证主链路和关键边界，不把高不确定性增强能力压进第一版。
8. 技术选型服务于边界。技术栈回答“怎么实现”，架构回答“变化发生时系统如何保持局部稳定”。
```
