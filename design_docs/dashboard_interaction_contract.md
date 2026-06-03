# Dashboard Interaction Contract

本文档记录当前 dashboard 和 ChatGPT/Codex 录入流程的交互契约。它不是视觉稿，也不是一次性 bug 复盘，而是后续改 UI、改 provider、改 diagnostics 时需要维持的行为边界。

## 设计目标

之前的可用性问题并不只是按钮样式或文案问题，而是交互状态分散在多个 boolean、hook、组件条件判断里：

- ChatGPT 保存后 dashboard 能显示，但重启后未必能加载已有 snapshot。
- Safari 读取和手动输入入口在不同状态下容易丢失。
- provider 数据订阅、dashboard 动作、panel 展示逻辑混在 JSX 里，缺少可测试的中间契约。

当前阶段采用轻量方案：不引入 router、全局 store 或状态机框架，而是用单一 `View` 状态、统一 provider subscription hook、纯函数 ViewModel 和单元测试来固定交互行为。

## View 契约

renderer 顶层只能同时处于一个页面状态：

```ts
type View =
  | { page: 'dashboard' }
  | { page: 'settings' }
  | { page: 'quick-capture' }
  | { page: 'manual-input' };
```

约束：

- 不再用多个 boolean 表示页面状态。
- Safari 快速读取是独立子页 `quick-capture`，不是 dashboard 内联 loading 状态。
- 手动录入是独立子页 `manual-input`。
- DeepSeek 设置是独立子页 `settings`。
- 所有子页返回或保存成功后回到 `dashboard`。

## Provider 订阅契约

所有 provider summary 都通过同一类 hook 订阅：

- `useSnapshot(providerId, initialSummary?)` 负责初始请求、实时更新和手动刷新。
- hook 必须同时监听 `snapshot:reply` 和 `snapshot:updated`。
- hook 必须按 `provider_id` 过滤事件，避免 DeepSeek 和 ChatGPT 互相覆盖。
- `initialSummary` 只用于没有持久化 snapshot 时的占位 UI，不能替代真实 storage 读取。

ChatGPT/Codex 的默认占位 summary：

- `provider_id = chatgpt`
- `status = manual_required`
- `quota_model = limit`
- `source = manual`

一旦 storage 中存在 ChatGPT snapshot，`snapshot:reply` 或 `snapshot:updated` 必须覆盖默认占位状态。

## Dashboard ViewModel 契约

dashboard JSX 不直接判断业务状态，而是读取 `toDashboardViewModel()` 的结果。

输入：

```ts
{
  deepseekSummary: ProviderSummary | null;
  deepseekLoading: boolean;
  chatgptSummary: ProviderSummary | null;
}
```

输出必须包含：

- `headerActions`: dashboard 顶部动作。
- `balanceProvider`: DeepSeek 余额卡状态。
- `limitProvider`: ChatGPT/Codex 限额卡状态。

当前 action id：

- `refresh_deepseek`
- `open_settings`
- `quick_capture_chatgpt`
- `manual_input_chatgpt`

约束：

- 顶部必须持续提供 `refresh_deepseek` 和 `open_settings`。
- ChatGPT/Codex 在无数据、`manual_required`、已有 Safari 数据、已有手动数据时，都必须提供 `quick_capture_chatgpt` 和 `manual_input_chatgpt`。
- `limitProvider.kind = empty` 时显示空状态卡，但仍显示 Safari 读取和手动输入入口。
- `limitProvider.kind = summary` 时显示 `LimitPanel`，但仍显示 Safari 更新和手动修改入口。

## Workflow 契约

### Dashboard

显示两个 provider 分组：

- 余额型：DeepSeek `BalancePanel`
- 限额型：ChatGPT/Codex `LimitPanel` 或空状态卡

Dashboard 的核心原则是“查看状态”和“进入修正动作”同屏可达。用户不应该因为已经有一份 ChatGPT 数据而失去重新 Safari 读取或手动修改的入口。

### DeepSeek 设置

流程：

```text
dashboard -> settings -> 保存成功 -> dashboard -> refresh DeepSeek
dashboard -> settings -> 返回 -> dashboard
```

设置页只负责 DeepSeek credential，不负责 ChatGPT/Codex 录入。

### ChatGPT/Codex Safari 读取

流程：

```text
dashboard -> quick-capture -> Safari capture -> parse -> 用户确认 -> 保存 -> dashboard
```

失败契约：

- Safari tab 不可访问：显示具体失败原因，并保留手动输入 fallback。
- parser 失败：显示 parser diagnostics，允许导出 debug bundle，并保留手动输入 fallback。
- 用户取消：不写 snapshot，返回 dashboard。

Safari 读取必须保持 user-mediated：不登录、不保存 ChatGPT cookie、不做 stealth、只读取用户已打开的 Safari visible tab。

### ChatGPT/Codex 手动输入

流程：

```text
dashboard -> manual-input -> 用户录入 -> 保存 -> dashboard
dashboard -> manual-input -> 返回 -> dashboard
```

手动输入和 Safari 读取最终都写入同一种 `ProviderSnapshot`，区别通过 `capture_method` 表示。

## Testing Contract

必须有测试覆盖以下行为：

- dashboard header actions 始终包含刷新和设置。
- ChatGPT/Codex 无数据时仍显示 Safari 读取和手动输入 action。
- ChatGPT/Codex 有 Safari snapshot 后仍保留 Safari 更新和手动修改 action。
- DeepSeek summary 和 ChatGPT summary 不能互相覆盖。
- `capture_method` 从 normalize 到 summary 不丢失。

当前优先测试纯函数 ViewModel 和 domain/storage/summary 管道。React component test 暂缓，等页面状态继续膨胀或 JSX 分支变复杂时再引入。

## 非目标

当前不引入以下机制：

- React Router：窗口只有少量本地页面，顶层 `View` union 足够。
- Zustand/Redux：状态来源简单，provider summary 已由 hook 收敛。
- XState：当前流程没有复杂并发状态，先用 TypeScript union 和 ViewModel 固定契约。
- UI component framework：现阶段问题主要是交互状态和信息架构，不是组件库能力不足。

如果后续出现跨窗口导航、复杂异步取消、批量 provider 管理、undo/redo 或多步骤 wizard，再重新评估这些框架。
