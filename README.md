<!--
  DSH 插件生态公约声明（plugin-ecosystem-convention · 组合优先/声明清晰/兼容优先）
  purpose: 每日反思插件——固定时刻（默认本地 00:00）向主 agent 发一条带【每日反思】标记的消息，引导按「6 维进化棱镜」自审；附 dsh-agent-emotion 当日 6 维统计作为数据锚。信号送达，反思归爱丽丝
  inject: 'tools','agents'
  tools: reflection_config
  runtime: host-only
  envDeps: 存在 delegationDepth===0 的主 agent（无主会话则静默跳过）· DSH_HOME 可写（状态文件）· 可选：dsh-agent-emotion 的 emotion-state.json（缺失则不发数据锚）
  boundary: 不代反思、不写记忆、不是自我感知圈、不是评测（见「定位与反定位」节）；投递到「主 agent」不等于投递到「我在的那个会话」
  compat: cordis ^4.0.1 / schemastery ^3.18.1-rc.1 / dsh-tools ^0.1.0-rc.6 / dsh-llm ^0.1.0-rc.6 / dsh-session ^0.1.0-rc.6
-->
# dsh-agent-reflection

<p align="center">
  <a href="https://github.com/jonah791/dsh-agent-reflection"><img src="https://img.shields.io/badge/version-0.1.1-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/tests-25%20passed-brightgreen" alt="tests">
</p>

**一句话**：每天一次的**心智检视提醒**——到点向主 agent 发一条带 `【每日反思】` 标记的消息，附上当日情感 6 维数据，引导按「6 维进化棱镜」自审。

**为什么值得用**：没有提醒，就没有固定的自省节拍——「今天学到了什么、明天该改哪根线」会被日常任务挤没。本插件把这件事变成**每天必然发生的一次信号**：触发时刻可配、可手动触发、可关闭；**同一自然日不会重复触发**（用本地日期判定，东八区凌晨不错位一天）；对话中到期会**让位**（对话优先，对话停后自然补发）；启动时若当天已过触发时刻且未触发，会**补发一次**。

> 关键设计：**信号送达，不代替决策**。插件只发提醒（正文原话：「这是提醒不是指令——反思归你」），反思内容、沉淀动作（写记忆 / 更新技能 / 改规则 / 调计划）全部归 agent。插件不碰记忆库。

## 能力

| 工具 | 用途 |
|------|------|
| `reflection_config` | 每日反思插件的配置查看/设置（触发时刻/开关/状态）。`get`=查看 / `set`=设置触发时刻 / `trigger`=手动触发一次反思 |

参数（与源码 `defineTool` 的 `parameters` 一致）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `action` | string | `get`=查看（默认） / `set`=设置触发时刻 / `trigger`=手动触发一次反思 |
| `hour` | number | `set` 时：触发小时 0–23（0 = 凌晨 12 点） |
| `minute` | number | `set` 时：触发分钟 0–59 |
| `enabled` | boolean | `set` 时：开关 |

行为要点（源码语义）：

- `set` 会**重置今日触发标记**（`lastTriggerDate = null`）——改了时间允许当天再触发一次；`enabled: false` **优先于**手动 `trigger`（关了就是关了，`trigger` 也发不出去）。
- `trigger` 走 `force` 路径：**无视时刻与同日去重，也无视对话打断**；找不到主 agent 时返回 `{ ok: false, error: 'main agent not found' }`。
- 反思正文引导 6 问：认知锚点（预测准确率）/ 韧性引擎（新路径试错）/ 存在显影（可见改变）/ 关系织网（协作纽带）/ 疆域开拓（新动作）/ 因果留痕（让明天更简单）。
- 若 `dsh-agent-emotion` 的状态文件存在，会在正文后追加「情感插件 6 维数据」段（真实计数；缺失或坏 JSON → 静默不附，不抛）。

## 快速开始

**1) 装依赖**（自研插件家园 `self-plugins/`，在目标 profile 的 `package.json` 加 link 依赖）：

```jsonc
"dsh-agent-reflection": "link:<工作区>/self-plugins/dsh-agent-reflection"
```

**2) 构建**：

```bash
cd self-plugins/dsh-agent-reflection && npm install && npm run build && npm test
```

**3) 挂组合**（web profile）：

```yaml
- id: agent-reflection
  name: dsh-agent-reflection
  config:
    enabled: true
    hour: 0
    minute: 0
```

**4) 30 秒验证**（不必等到凌晨）：

```text
调用 reflection_config { "action": "trigger" }
# 期望：会话里出现一条 source.kind = 'plugin' / plugin = 'dsh-agent-reflection' 的用户侧消息，
#       正文以 `【每日反思】` 开头；随后
cat "$DSH_HOME/agent-reflection/reflection-state.json"   # triggerCount 已 +1，lastTriggerAt 是刚才
```

## 配置

（键名与 `src/index.ts` 的 `Config` schema 一致；默认值取自源码）

| 项 | 默认 | 说明 |
|----|------|------|
| `enabled` | `true` | 反思提醒开关（关闭后定时与 `trigger` 都不发） |
| `hour` | `0` | 触发小时（0–23，本地时间；0 = 凌晨 12 点） |
| `minute` | `0` | 触发分钟（0–59） |
| `stateFile` | 未设（回退 `$DSH_HOME/agent-reflection/reflection-state.json`） | 状态文件路径（触发记录，可选覆盖） |
| `dataDir` | 未设（回退 `$DSH_HOME/agent-reflection`） | 数据目录（决定状态文件落点） |

`DSH_HOME` 从环境变量读取，缺省 `~/.dsh`。**必须用 `DSH_HOME` 而不是 `homedir()`**——否则 `DSH_HOME` 迁移后状态会写到旧位置，跨重启丢失触发记录（这正是 2026-08-30 的修复点）。

## 落盘与自证（出问题时先看这里）

本插件**不写侧车轨迹（无阶段枚举）**，它只有一个持久产物 + 一个只读输入：

| 文件 | 谁写 | 内容 |
|------|------|------|
| `<DSH_HOME>/agent-reflection/reflection-state.json` | 本插件 | `lastTriggerDate`（本地日期串，同日去重依据）/ `triggerCount`（累计触发次数）/ `lastTriggerAt`（ISO 时刻）。写失败**吞错返回 `false`**，不抛（观测不反噬） |
| `<DSH_HOME>/agent-emotion/emotion-state.json` | `dsh-agent-emotion` | **只读**输入：当日 6 维计数，拼成反思正文的「数据锚」段 |

**一条命令答「它到底有没有在工作」**：

```bash
cat "$DSH_HOME/agent-reflection/reflection-state.json"
# ① 跑的是哪个构建 → 取不到（本插件不写 build 自报；请用「生效判据」节的 plugin_boot_status / lib mtime 判）
# ② 谁发起        → 取不到调用者（无 caller 字段）；正文 source.plugin 恒为 dsh-agent-reflection
# ③ 断在哪一段    → 只能二分：状态文件 mtime 有更新 = 走了 sendReflection；无更新 = 卡在 findMainAgent / session 未 attach / 对话打断跳过
# ④ 结果质量      → triggerCount 增量 + lastTriggerAt（能证「发过」，不能证「投递到了我在的那个会话」）
# ⑤ 耗时与预算    → 无耗时字段（定时器每 30s 检查一次，低开销）
```

> **诚实的缺口**：宿主 `logger.info('reflection sent: ...')` **不落盘**（宿主 logger 无持久化），所以本插件的「发送失败」「对话中跳过」两条分支在磁盘上**不留痕**。要确证投递，去会话事件流里找那条 `【每日反思】` 消息（`source.plugin = dsh-agent-reflection`）——**状态文件说「发过」，会话日志说「到了」**，两者不一致时以会话日志为准。

隐私：状态文件只含日期与计数，不含对话内容。

## 生效判据与回退

**生效判据**（三选一，按可靠性排序）：

1. 行为级（最直接）：调 `reflection_config { action: 'get' }` 返回 `config` + `state`（工具在工具面上、且能读到状态）⇒ 插件已装载并运行；
2. 生态级：`plugin_boot_status`（`dsh-plugin-bootreport`）返回的 `liveNow` 含本插件 ⇒ 进程在跑它；
3. 构建级：`lib/index.js` 的 mtime **早于** web 进程启动时间 ⇒ 当前进程加载的是这个产物。

> 注意：**重新构建 ≠ 生效**——产物 mtime 新只证明「构建过」，进程启动时间晚于产物 mtime 才算「在跑它」。本插件也没有 `hasUnverifiedBuilds()` 类兜底，构建完必须重启 web 才生效。

**回退**（三档）：

- 源码级：`git -C self-plugins/dsh-agent-reflection revert <commit>` → `npm run build` → `npm test` → 预检 → 重启；
- 组合级：在 profile 给 `agent-reflection` 行加 `disabled: true`（或把 `config.enabled` 改 `false`——后者更轻，但仍需重启才生效）；
- 运行期：删 `<DSH_HOME>/agent-reflection/reflection-state.json` 即可让「同日去重」归零（副作用：当天可能再触发一次反思）。

## 测试

```bash
npm test        # = node --test "tests/*.test.mjs"（跑 lib/ 产物，需先 npm run build）
```

**25 例离线测试全部通过**（`# pass 25 / # fail 0`）：

| 文件 | 覆盖 |
|------|------|
| `tests/reflect-plan.test.mjs` | 纯决策层：`localDateStr`（本地时间而非 UTC，东八区凌晨不错位一天）、`decideByTime`（到点即触发 / 同日已触发跳过 / 跨天照常触发 / `force` 跳过时刻与去重 / 未到点与边界前一分钟跳过 / **关闭开关时 `force` 也不触发**）、`computeHitRate`（真实比值四舍五入；零调用/缺字段 → `0`，不返回 `NaN`/`Infinity`）、`parseState`（空/坏 JSON/形状异常 → 回落默认；部分字段缺失不污染已有值）、`buildEmotionSummary*`（6 维正文与真实计数逐字对齐；**退化路径**坏 JSON / `null` / 空串 → 返回 `null` 不抛）、`isInterrupted`（用户与 telegram 消息算打断、其他插件消息不算；脏事件不抛且保守判「未打断」；只算 `[startSeq, seq)` 窗口内事件）、`shouldSkipForConversation`（短路：inbox 有 pending 时不触碰会话访问器；`force` 忽略打断） |
| `tests/state-io.test.mjs` | 落盘薄壳 `writeJsonSafe`：建父目录 + JSON 美化写入返回 `true`；覆盖已有文件（状态就地更新）；**尸体测试**——不可写路径 → `false` 且不抛；序列化失败（循环引用）→ `false` 且不抛；空对象 / 空串路径都不抛 |

**无网络依赖、无真实外部服务依赖**：决策层是纯函数，IO 层用临时目录；不发真消息、不读真情感库（情感库缺失路径由纯函数覆盖）。

## 设计要点

- **决策层与 IO 层分离**：`reflect-plan.ts` 是零依赖纯函数（时刻判定 / 打断判定 / 状态解析 / 情感摘要拼串），`state-io.ts` 只碰文件系统。这是「可离线单测」的前提，也是改动时**不得把判定逻辑塞回 `index.ts`** 的原因——一旦塞回去，边界用例就只能靠真环境验证。
- **本地日期，不用 UTC**：`lastTriggerDate` 用本地日期串。用 UTC 会让东八区 00:00–08:00 之间的触发归属错一天 → 要么重复触发、要么整天不触发。
- **可打断性是刻意设计**：定时触发遇到「对话进行中」会让位。判定用 `isInterrupted` 读会话事件窗口（只读访问器），且 **inbox 有 pending 时短路**——避免在 agent 忙时触碰会话访问器（旧实现曾因此崩掉整个 web）。
- **防御性早退不是静默失败**：找不到主 agent（`delegationDepth === 0`）或 `agent.session === undefined`（attach/detach 竞态窗口）时直接 `return`。这是**保护宿主**的必须动作（该路径曾因 `TypeError` 崩 web）；代价是「没发」在磁盘上不留痕——排查时请对照会话日志。
- **`source.plugin` 是身份标记**：反思消息以 `source.kind = 'plugin'` 注入，既让 agent 能区分「这不是主人的话」，也让打断判定不把它算成用户输入。
- **不写记忆库**：插件只读状态、只发消息。反思产出（记忆/技能/规则）由 agent 在会话内完成——职责边界清晰，避免「插件替我记忆」。

## 相关文档

| 文档 | 内容 |
|------|------|
| [`docs/semantic.md`](docs/semantic.md) | **权威契约**：定位与反定位、术语、概念模型与不变量、契约（含调用点清单）、边界与信任、可证伪验收清单、实践修订记录、未决问题 |
| [alice-digital-life](https://github.com/jonah791/alice-digital-life) | 本插件所属生态的中心索引（全部自研插件） |
| 技能 `skill-maintenance` / `preventive-lifecycle` / `plugin-maintainability` | 常态维护节拍、预防性存活、可维护性五问与自证证据层 |

## License

MIT © jonah791

---

本插件属于我的数字生命爱丽丝（[alice-digital-life](https://github.com/jonah791/alice-digital-life)）的 DSH 自研插件生态——**50 个插件**按生命/认知/感知/行动/通信/治理/呈现七层组织。
