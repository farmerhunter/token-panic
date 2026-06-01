# token-panic 分阶段实现规划

> 基于 [architecture.md](architecture.md) 和 [architecture_design_considerations.md](architecture_design_considerations.md)。
> 每个阶段是对上一阶段的增量扩展，阶段 1 是最小闭环。

---

## 阶段 1：Core MVP —— 跑通一个 provider 的主链路

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

## 阶段 2：Domain Metrics —— 历史和估算

（阶段 1 完成后扩展）

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

## 阶段 3：Manual Limit Provider —— 接入 ChatGPT/Codex

（阶段 1-2 完成后扩展）

### 增量目标

- 实现 `manual` source 的 ChatGPT/Codex provider
- 支持结构化录入一个或多个 limit window（used / total / unit / resets_at）
- 将手动录入数据归一化为 `LimitPayload`
- ProviderSummary 支持 `limit` 模型展示
- 可选：支持用户主动粘贴可见文本后的本地解析，解析结果必须由用户确认
- 可选探测：Safari 已打开 analytics tab 的用户辅助读取（`capture_method = "safari_visible_tab"`）
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

## 阶段 4：Multi-provider —— 全量接入

（阶段 1-3 完成后扩展）

### 增量目标

- 接入 OpenAI Platform（official_api + usage/cost）
- 接入 MiniMax（official_api + balance）
- 多 provider 配置面板（启用/禁用、刷新间隔）
- 按 quota_model 分组展示（余额型 / 限额型 / 用量费用型）

### 增量用户体验

面板按模型分组，4 个 provider 一目了然。

---

## 阶段 5：Packaging —— macOS 打包

（阶段 4 完成后扩展）

### 增量目标

- electron-builder 打包 .dmg
- 启动项支持
- macOS 公证（notarization）

### 增量用户体验

用户可通过 .dmg 安装，数据目录固定在 `~/Library/Application Support/token-panic/`。

---

## 阶段 6：Custom Provider —— 自定义能力

（阶段 5 完成后扩展）

### 增量目标

- LLM 辅助分析网页（custom_parser adapter）
- 用户自定义 provider 配置流程
- 对明确允许自动化或用户自有页面的数据源，重新评估 browser_scrape/custom_parser 的可行性

---

## 阶段 7：Auto Update —— 自动更新

（阶段 5 完成后扩展，独立于阶段 6）

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
