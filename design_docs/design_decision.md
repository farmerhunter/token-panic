# 设计决策记录

> 记录实现过程中的关键设计决策。格式：问题 → 决策 → 理由 → 替代方案。按阶段分组，新决策追加到对应阶段。

---

## 阶段 1：Core MVP

### DD-001：路径统一使用 `app.getPath("userData")`

**问题**：阶段 1 是开发模式，数据路径容易写成 repo-local `data/`，打包时再迁移。但 API key 文件和 `data.json` 的路径引用会散落在多个模块里，迁移容易遗漏。

**决策**：阶段 1 就用 `app.getPath("userData")`（`~/Library/Application Support/token-panic/`），开发和生产同一路径。

**理由**：Electron 开发模式支持 `app.getPath`，不需要等到打包。零迁移成本。

**替代方案**：阶段 1 用 repo-local `data/`，阶段 5 打包时迁移。被否决，因为迁移断点风险高于早期投入。

---

### DD-002：Adapter 只返回 fetch 结果，Core Domain 合成 fallback

**问题**：当 adapter fetch 失败时，谁负责把上一次成功的 snapshot 数据拼接进 ProviderSummary？如果 adapter 自己读 storage 取上次快照，就破坏了 adapter 的边界（adapter 只负责外部获取和归一化）。

**决策**：Adapter 只返回当前 fetch 的 `FetchResult`（snapshot 或 error classification）。Core Domain 的 `generateSummary()` 接收可选的 `lastSuccessSnapshot` 参数，负责合成 fallback 数据。

**理由**：保持分层边界。Adapter 不应知道 storage 的存在。error → fallback 合成是业务逻辑，属于 Core Domain。

**替代方案**：adapter 内部处理 fallback。被否决，违反 `architecture.md` 定义的 Provider Adapter 职责边界。

---

### DD-003：阶段 1 保留 ConfigPanel UI

**问题**：ConfigPanel 是 UI 配置流，会拖慢"菜单栏 + adapter + storage + summary"主链路的验证速度。是否应该先用环境变量或本地文件配置 API key，UI 配置放到后续？

**决策**：ConfigPanel 留在阶段 1 交付范围内，验收标准显式列出。

**理由**：ConfigPanel 实际工作量很小（一个文本输入 + 保存按钮，约 30 行 React）。阶段 1 的核心复杂度在 Electron 壳、IPC、adapter 和 domain 逻辑，ConfigPanel 不构成瓶颈。且 API key 输入是用户第一个交互，一上来就是可用的 app 比纯环境变量配置体验好得多。

---

### DD-004：自动更新拆为独立阶段

**问题**：阶段 5 "Packaging" 同时列入 .dmg、启动项、自动更新。自动更新涉及代码签名、更新 feed、回滚策略，和打包是独立问题。

**决策**：阶段 5 只做 .dmg 打包 + 启动项 + 公证。自动更新拆为阶段 7。

**理由**：打包和自动更新的复杂度独立，合在一起会让阶段 5 范围膨胀。分开后每个阶段目标明确。

---

## 阶段 2：Domain Metrics（历史与估算）

### DD-005：历史快照聚类合并（间隔 < 5min 归为一簇）

**问题**：用户手动连续刷新或在短时间内多次打开面板，会产生间隔极短（几秒到几分钟）的多个快照。这些点的差值几乎全是噪声，但如果直接参与 burn rate 回归，会把噪声放大到天级外推。

**决策**：相邻快照间隔 < 5 分钟的归为一簇，只保留簇中最新（余额最小）的那个点参与后续计算。

**理由**：
- 5 分钟是手动操作和自动刷新之间的自然分界（自动刷新最短间隔也远大于 5 分钟）
- 保留最新（余额最小）的点，因为簇内的消耗是真实的，只是粒度太细不适合直接回归
- 簇的个数可以作为 confidence 的输入：如果用户只有两个簇（隔了几天），数据可信度高于两个原始点（可能只隔了几分钟）

**替代方案**：不聚类，直接用原始点回归。被否决，因为短间隔噪声会严重扭曲消耗速度估算。

---

### DD-006：充值检测（余额上升 > 10% 且 > ¥1 标记为充值）

**问题**：用户充值后余额跳跃上升，旧消耗速度失效。如果旧数据参与回归，斜率被扭曲到失去意义。

**决策**：检测到当前余额 > 上一次余额 × 1.1 **且** 差值 > ¥1.00 时，标记为充值事件。充值前的历史点不参与 burn rate 计算。充值后的数据窗口独立计算。

**理由**：
- 10% 阈值过滤小额波动（汇率换算误差、API 返回精度变化）
- ¥1 绝对值阈值过滤极小余额的正常波动
- 两个条件 AND：避免误判

**替代方案**：不检测充值，直接对所有点做回归。被否决，因为充值后的斜率完全不可靠。

---

### DD-007：密集采样降采样策略

**问题**：重度用户（应用常驻，每 30min 刷新）一天产生 48 个点，一周 336 个。全部参与线性回归计算量大，且近期高密度点会淹没更早期的趋势信息。

**决策**：合格数据点 > 24 个时触发降采样：
- 最近 24h：每小时一个代表点（取该小时最新值）
- 24h–7d：每天一个代表点（取该天最新值）
- 7d 以上：保留原有点（本身就很稀疏）

降采样后参与回归的点数控制在 ~30 个左右。

**理由**：24 小时内的消耗速度是用户最关心的（"今天花了多少"），近期的密集采样有意义。超过 24h 后，按天聚合可以平滑短期波动，保留长期趋势。

**替代方案**：不做降采样，加权回归（近期权重高）。被否决，因为加权回归不能解决计算量问题，且调权重本身引入新的主观参数。

---

### DD-008：Burn rate 使用简单线性回归

**问题**：用什么算法从历史点推算消耗速度？

**决策**：使用最小二乘线性回归。输入为 `[{timestamp, remaining_amount}]`，输出 slope（余额变化/小时）、intercept、R²。

**理由**：
- 余额消耗本质上是近似线性的（按 token 计费，单价固定）
- 线性回归足够简单，R² 可以直接用作 confidence 的输入
- 不引入多项式或指数模型（过度拟合稀疏数据）

**替代方案**：
- 平均差分法（相邻点差值取平均）：更简单但不平滑，受离群点影响大
- 指数模型：理论上有道理（消耗可能加速），但数据点太少时指数拟合不稳定
- Theil-Sen estimator：对离群点更鲁棒，但实现复杂度更高

选择最小二乘是因为它是"够用且可解释"的最简方案。

---

### DD-009：Confidence 三级模型

**问题**：点少、跨度短的数据不可靠，但不能简单用二元（可靠/不可靠）判断。

**决策**：

| Confidence | 条件 |
|------------|------|
| `high` | 合格簇 ≥ 5，时间跨度 ≥ 24h，R² ≥ 0.8 |
| `medium` | 合格簇 ≥ 3，时间跨度 ≥ 6h |
| `low` | 合格簇 ≥ 2，时间跨度 ≥ 5min |
| 不展示 | 合格簇 < 2 或 R² < 0.3 |

**理由**：用"簇数"而非"原始点数"判断，避免两个连续手动快照（间隔 30 秒）伪装成"2 个数据点"。R² < 0.3 说明消耗模式不稳定（可能在试用不同模型），这种情况给一个不准确的数字比不给数字更误导用户。

---

### DD-010：零消耗与充值后的展示策略

**问题**：余额几乎不变（burn rate ≈ 0）时，不能展示"还能撑 ∞ 天"。刚充值后数据不足，估算不可靠。

**决策**：
- burn rate ≈ 0（|slope| < 阈值）：展示"近期无消耗"，不估算剩余时间
- 充值后 < 24h：展示估算值，但附加文字说明"余额已充值，估算基于充值后数据"
- 剩余时间 > 30 天：展示"> 30 天"，不给精确数字

**理由**：
- 零消耗时强行展示数字（如"还能撑 999 天"）既无用又像 bug
- 充值后给估算但带说明，比不给任何信息好
- 超长时间不精确展示，避免"还能撑 847 天"这种虚假精确感

---

## 阶段 3：Manual ChatGPT/Codex Provider

### DD-011：停止 ChatGPT 自动化登录、scrape 和 stealth 方向

**问题**：Phase 3 原计划用 Playwright 登录 ChatGPT、保存 `storageState`，再用 headless/headful 浏览器自动刷新并 scrape usage 页面。但实机实验显示，裸 headless、隐藏 `navigator.webdriver`、headful Playwright Chromium 都无法稳定加载 `chatgpt.com`，且实验后已经造成连接受限。继续做 stealth 或反自动化实验会带来更高账号、网络和产品风险。

**决策**：ChatGPT/Codex 不再作为 `browser_scrape` 自动化目标。停止并禁止继续进行 ChatGPT stealth 相关实验，包括：

- 不再尝试 headless/headful Playwright 登录 ChatGPT。
- 不再尝试 `--disable-blink-features=AutomationControlled`、User-Agent 伪装、webdriver 覆写、TLS/浏览器指纹规避等反检测手段。
- 不引入 `playwright-stealth`、`puppeteer-extra-plugin-stealth` 或同类第三方 stealth 依赖。
- 不使用用户真实 Chrome profile、CDP 连接、cookie 导出/导入或 `storageState` 复用来绕过登录和反自动化检测。
- 不再抓取 ChatGPT usage 页面的 DOM、截图或 selector 结构作为自动化实现依据。

**理由**：
- 已有实验足以证明原方案不可作为可靠产品路径，继续实验收益低、风险高。
- ChatGPT 网页登录态和 usage 页面不是稳定 API contract，页面和限制规则都可能变化。
- 反自动化对抗会把项目拖进高维护成本方向，违背“工具不能成为架构中心”的原则。
- 保存 ChatGPT cookie/localStorage 等价于保存登录凭证，风险高于普通 provider API key。

**替代方案**：
- **采用**：Phase 3 改为 manual/user-mediated provider，让用户手动录入或粘贴 ChatGPT/Codex 的限额信息。
- **后置**：只有当出现官方 API、明确允许的集成方式，或目标 provider 明确允许自动化访问时，才重新评估 `browser_scrape`。

---

### DD-012：Phase 3 改为 manual/user-mediated limit provider

**问题**：仍需要验证 `limit` quota model、多 provider UI、ProviderSummary 展示和历史估算，但不能继续依赖 ChatGPT 自动登录或网页抓取。

**决策**：Phase 3 实现 `manual` source 的 ChatGPT/Codex provider。用户在配置面板中手动录入或粘贴限额数据，应用归一化为 `LimitPayload`：

- plan/name：如 ChatGPT Plus、Codex。
- 一个或多个 limit window：如 `5h`、`day`、`week`。
- `used`、`total`、`unit`、可选 `resets_at`。
- `captured_at` 由应用生成。

**理由**：
- 继续验证架构中最重要的新维度：`source = manual` 与 `quota_model = limit` 的组合。
- 不保存 ChatGPT 登录凭证，不触发反自动化检测。
- 用户仍能在 dashboard 里统一查看 DeepSeek balance 和 ChatGPT/Codex limit。
- 后续如果出现官方 API 或允许自动化的数据源，可以替换 `source`，不影响 Core Domain 和 Renderer。

**替代方案**：
- 继续 browser scrape：被否决，风险过高。
- 直接跳到 OpenAI Platform API：可作为 Phase 4，但不能覆盖 ChatGPT/Codex 订阅限额。
- 暂停 ChatGPT/Codex：实现最简单，但无法验证 `limit` 模型和多模型展示。

---

### DD-013：Manual input 的解析边界

**问题**：手动录入可以做成结构化表单，也可以允许用户粘贴页面文案后由本地 parser 解析。后者更省输入，但 parser 不能重新变成脆弱网页抓取的替代中心。

**决策**：Phase 3 优先做结构化输入；可选增加本地文本解析作为辅助，但必须满足：

- parser 只处理用户主动粘贴的可见文本，不访问网页、不读取剪贴板外内容。
- parser 失败时回退到结构化表单。
- parser 输出必须让用户确认后才保存。
- parser 只生成 `LimitPayload`，不创建 selector、cookie、storageState 或浏览器自动化配置。

**理由**：结构化输入最稳定，文本解析只改善用户体验，不改变安全边界。

**替代方案**：
- 只做粘贴解析：体验看似好，但失败时用户不可控。
- 自动打开页面并提取文本：被否决，仍属于 ChatGPT 自动化访问。

---

### DD-014：Browser scrape 保留为通用抽象，但不用于 ChatGPT/Codex

**问题**：架构里仍有 `browser_scrape` source。是否应该删除这个 source？

**决策**：保留 `browser_scrape` 作为未来通用 provider source，但 Phase 3 不实现 ChatGPT/Codex browser adapter。只有满足以下条件的 provider 才能进入 browser scrape 候选：

- provider 明确允许自动化访问，或项目仅在用户本地、用户主动授权、低频、无绕过保护机制的范围内使用；
- 不需要绕过登录、验证码、bot protection、rate limit 或 protective measures；
- 不需要保存高风险网页登录凭证，或凭证风险可接受且用户明确知情；
- 页面结构有足够稳定的可见数据，失败时可返回 `manual_required` 或 `auth_required`，而不是继续重试。

**理由**：`browser_scrape` 是某类数据源的实现方式，不应因为 ChatGPT 不适合而从模型中删除；但也不能让 ChatGPT 的困难反过来驱动系统进入 stealth 对抗。

---

### DD-015：Safari visible-tab assisted capture 探测路线

**问题**：用户长期保留一个 Safari tab 打开在 `https://chatgpt.com/codex/cloud/settings/analytics`，页面里已有 balance 数据。是否可以利用这个已登录、已打开、用户可见的 tab，半自动读取网页内容，减少手动录入，同时避免再次触发 ChatGPT 反自动化限制？

**决策**：可以作为 Phase 3 的受控探测路线，但必须定义为 **用户辅助读取可见页面**，不是后台 browser scrape。先在 `manual` source 下增加 `capture_method = "safari_visible_tab"` 的概念；只有在探测证明稳定且不触发限制后，再考虑是否把它提升为单独 source。

探测必须按以下顺序推进，每一步都可独立停止：

1. **零网络探测**：只用 AppleScript 查找 Safari 中已打开的 analytics tab URL 和窗口标题，不激活、不 reload、不执行页面 JS。
2. **用户确认后激活**：显示将读取的 tab URL，由用户点击确认后才激活 Safari 并切到该 tab。
3. **只读文本读取**：优先通过 Safari Apple Events 执行只读 JS，读取 `document.body.innerText`；不访问 cookie/localStorage/sessionStorage，不读取隐藏字段，不注入修改页面状态的脚本。
4. **本地解析与确认**：parser 只在本地从可见文本里提取 balance/limit 候选值，展示给用户确认后才保存 snapshot。
5. **刷新保持手动**：默认不自动 reload。若后续需要刷新，只允许用户显式点击“刷新 Safari 页面并读取”，且一次点击最多触发一次 reload。

**风险控制**：

- 不使用 Playwright、CDP、Chrome profile、headless/headful automation 或 stealth 插件。
- 不打开 ChatGPT 登录页，不尝试登录，不保存 ChatGPT cookie/localStorage/storageState。
- 不做后台定时轮询，不在 app 启动时自动读取，不反复 retry。
- 设置读取冷却时间；失败后不自动重试，必须用户再次触发。
- 如果页面 URL 不在允许列表、出现登录页/验证码/connection limited/异常重定向、读取结果为空或结构异常，立即停止并返回 `manual_required`。
- 默认不保存原始文本或截图；如需调试，必须用户显式导出，并在 UI 中提示可能包含敏感数据。
- 探测阶段不得使用真实高频数据采样；只验证一次可见读取链路和 parser 正确性。

**理由**：

- 该路线不绕过登录或保护机制，只读取用户已打开、已可见、已授权的 Safari 页面。
- 它符合用户当前工作习惯，比纯手动录入省力，比 Playwright scrape 风险低。
- 把读取结果放进用户确认流程，可以避免 parser 误读直接污染 history。
- 通过“先 URL 探测、再用户确认、再只读文本、再本地确认”的阶段化流程，最大限度减少触发服务端反制的行为。

**替代方案**：

- OCR 截图读取：不执行页面 JS，但需要 Screen Recording 权限，准确率和隐私风险更差，作为备选。
- Safari Web Extension companion：授权边界更清晰，长期更产品化，但开发和签名成本更高，可作为后续路线。
- 继续 Playwright/stealth：已明确否决。
