# 引入 view model 的轶事

（本文故事发生在开发token-panic（[https://github.com/farmerhunter/token-panic](https://github.com/farmerhunter/token-panic)）应用时。）


万万没想到，原本期待完全甩手喝咖啡的vibe coding，真实样子却是回到了coach junior developer。。

## 一、面多了掺水，水多了掺面

事情起初很简单，我带着两个agent干活（别问，问就是token限额总爆），做一个很小的MacOS app给我自己用。

这个小应用只看 DeepSeek 余额。一个 provider，一张卡，一个刷新按钮，一个设置入口。代码直接写在页面里，也不丢人。数据来了就显示，没来也能等。像一团刚揉好的面，粗糙归粗糙，至少知道自己要成什么形状。

这么简单，我放心的把它交给了Deepseek（Claude Code驱动）。它也一下子做出来了。

于是，开始做ChatGPT/Codex 的统计。它不是“再加一张卡”那么好打发。它不能自动登录，不能搞 stealth，只能借用户已经打开的 Safari 页面；读到页面文本还要解析，解析失败还得导出 diagnostics；用户有时要手动填，有时要从 Safari 读；哪怕已经有一份数据，也不能把“重新读取”和“手动修改”的入口弄丢。

DeepSeek 撸起袖子开始干活了。这里补一个按钮，那里加一个状态。空状态一个分支，已有数据一个分支。DeepSeek 一套订阅，ChatGPT 先写一套监听。每次改动都不大，每次看着也都合理。面多了掺水，水多了掺面，锅里一度热火朝天。

然后怪事就来了。

手动录入灰了。Safari 读取显示成手动录入。设置按钮不灵。DeepSeek 卡片被 ChatGPT 的状态冲了一下。保存后能显示，重启后又像没见过这份数据。修一个分支，另一个路径露馅；补一个入口，另一个按钮消失。。

这些 bug 单看都不大，合起来却很有教育意义。它们不像某个变量拼错，更像厨房里传来的提醒：师傅，您这个面糊已经不是靠再撒两把面粉能救的了。

真正散掉的不是按钮，而是交互语义。哪些动作应该一直存在，哪些 provider 不能互相覆盖，哪些状态只是展示差异，哪些入口是用户退路，这些承诺全散在 JSX 分支、hook 差异和临时状态里。局部修得越勤快，全局越像一锅各凭本事的粥。

看到情形不对，再读一下Deepseek那东一榔头西一棒子的修改计划，我没辙了，把工作交回给了隔壁的 Codex。 它停了下来，没有继续追着按钮改。

它先把 dashboard 的语义捋出来：顶部固定有刷新和设置；DeepSeek 是余额型；ChatGPT/Codex 是限额型；ChatGPT 无论空状态还是已有数据，都要保留 Safari 读取和手动输入；provider summary 要按 `provider_id` 过滤；页面只处理当前处在哪个 view，不再靠一堆 boolean 互相猜。

这些东西写进了 `dashboard_interaction_contract.md`，也落成了一个小的 `toDashboardViewModel()`。页面不再到处问“这个按钮现在该不该出现”，先拿一份菜单：header actions、balance provider、limit provider、每张卡有哪些动作。组件照菜单渲染，测试检查菜单。

最妙的是，原来那类 bug 终于能被一句测试抓住：

```text
ChatGPT 已经有 Safari 数据后，仍然必须包含：
- quick_capture_chatgpt
- manual_input_chatgpt
```

这比在页面上来回点要干脆。手动录入会不会丢，Safari 更新会不会丢，DeepSeek 和 ChatGPT 会不会互相覆盖，直接测那个交互菜单。

## 二、这件事真正说明了什么

这个故事表面上是“引入 view model”，实际说的是交互语义归纳。

一开始直接写 JSX 没错。系统小，状态少，直接写最快。后来状态多了，provider 多了，失败路径多了，用户入口也多了，原来的写法还在硬撑。混乱已经存在，只是藏在分支里。

架构调整的价值就在这里：不急着上大框架，也不继续在湿面团里找形状。先把“用户路径上必须成立的事”归纳出来，再让实现去消费这份归纳。

这层东西很小：

- 一个明确的 `View` 状态；
- 一个统一的 provider 订阅 hook；
- 一个 dashboard interaction model；
- 一组不依赖 Electron、不依赖 React 渲染的测试；
- 一份写给后续 agent 看的交互契约。

它没有把项目变重，反而让后面的活变轻了。

之后要加入口，看 contract。要改 dashboard，看 interaction model。要确认 ChatGPT 有数据后按钮还在，跑测试。要交给另一个 agent 接着做，也不用重新口头解释“这个按钮为什么不能消失”。

返工代价也跟着降下来。以前是补一点塌一点，单次都不贵，累计很耗神。现在工作量前移了一点，换来的是后续修改更稳，排查路径更短，agent 接手成本更低。

这也不是“以后都要 view model”。真正该学的是先判断问题类型：互斥页面状态，用 union；跨状态 action 可用性，用交互模型；共享写入复杂，再考虑 reducer 或 store；异步并发、取消、重试多了，再谈 state machine；URL 和历史记录成了需求，再谈 router。工具别抢戏，边界先说清楚。

## 三、老登继续培训 DeepSeek

故事到这里还没完。

我又把 Codex 的设计文档、`dashboard-view-model.ts`、测试文件，还有 Agent Foundry 里的 `ARCH-009` practice 拿给隔壁 DeepSeek 看。语气大概就是那种老登味十足的现场教学：你看，人家不是比你多长了三只手，人家是先停下来问了一句，“这个行为的契约到底是什么？”

DeepSeek 读完以后，反应挺好。

它没有嘴硬说“我刚才其实也差不多想到了”。它很快把事情对上了：手动录入灰掉、设置按钮不灵、跨层字段丢失，不是一串倒霉的小事故，而是同一个病灶在不同地方冒头。交互规则没有一个能验证的 truth source，JSX 分支里各自为政，于是今天这里掉按钮，明天那里掉状态。

它还总结出一个很关键的顺序：先写契约测试，再写实现。比如 ChatGPT 卡片这个事，正确顺序应该是先写测试，明确“空状态和已配状态都必须有手动录入按钮”；让测试先失败；再实现交互模型；最后让测试通过。它之前的节奏则是另一套：先改 JSX，用户发现 bug，再改，再发现新 bug。勤奋是真的勤奋，方向也是真的费劲。

更有意思的是，它读完 `ARCH-009` 后，能把自己的感悟和 practice 一条条对上：

- “bug 是架构在提醒这里缺一层抽象”，对应 `frontend fixes keep breaking different branches of the same user flow`。
- “先问行为契约是什么”，对应 `Shape the ViewModel around interaction semantics`。
- “契约要能测试”，对应直接测试 action availability。
- “不要一上来引入大框架”，对应那套从 union、ViewModel、reducer、state machine、router 到 component framework 的分级判断。

这就很有意思了。

这说明 agent 不是只能被动写代码。它也能被训练出一点工程嗅觉。前提是别只靠一句“下次注意”。“下次注意”这种东西，人类 junior 都未必记得住，何况一个上下文窗口会过期的 agent。

经验要变成 decision、interaction contract、practice、测试。能读，能查，能执行，最好还能在下次干活前自动冒出来。这样它才不是一次聊天里的道理，而是系统里的手艺。

所以这篇轶事的主角也不只是 view model。它更像一个小型工程教育现场：一个 agent 把面搅稀了，另一个 agent 把形状揉回来，用户端着盆继续讲课，前一个 agent 居然听懂了，还愿意承认“我下次应该先写契约”。

这已经很不容易。

代码是面，需求是水。面多了掺水，水多了掺面，偶尔能救急。可到了某个时刻，真正省事的办法是停一下，把它揉成形。更省事的办法，是把这个揉面的手法写下来，让下一个干活的别再从面糊开始悟道。
