/**
 * reflect-plan.ts — 每日反思的**纯决策层**（无 IO、无 `Date.now()`，时间/状态/会话访问器全部注入）。
 *
 * 为什么抽出来（2026-09-14 插件可维护性补课 · 技能 `dsh-plugin-testability`）：
 * 原实现的判定逻辑（开关 / 跨天同一日去重 / 到点判定 / 对话中跳过）全埋在 `apply()` 闭包里，
 * 只能靠「等凌晨 0 点」来验证——**没有任何回归保护**：改一个边界符号（`<` → `<=`）、
 * 挪一个早退顺序（先去重后判时刻），线上表现就是「今天不反思」或「一天反思两次」，
 * 而这两种都不会报错。
 *
 * 抽取纪律（与改动前**逐字等价**，只搬位置不改判据）：
 *   - 判据顺序：enabled → 同日去重 → 到点 → （调用方）agent 存在 → session 存在 → 对话中
 *   - 比较符号、默认值、字符串格式全部照搬
 *   - `shouldSkipForConversation` 的 interrupted 用**thunk**注入：原实现靠 `||` 短路，
 *     不短路会在 `session.eventAt` 缺失时抛异常（定时器回调内 = 未捕获异常）——语义原样保留
 */

/**
 * 反思触发状态（状态文件形状，与改动前一致）。
 * 注意必须是 **type 别名**（不是 interface）：工具 output schema 的 `JsonValue` 依赖隐式索引签名，
 * interface 缺索引签名会 tsc 报 TS2322（原实现就是 type 别名，这里保持不变）。
 */
export type ReflectionState = {
  /** 上次触发日期（YYYY-MM-DD），同一天不重复 */
  lastTriggerDate: string | null
  /** 触发次数 */
  triggerCount: number
  /** 最近触发时间 */
  lastTriggerAt: string | null
}

/** 状态缺省值（原样搬移：loadState 的兜底与测试断言共用同一份）。 */
export const DEFAULT_STATE: ReflectionState = {
  lastTriggerDate: null,
  triggerCount: 0,
  lastTriggerAt: null,
}

/** 本地日期（YYYY-MM-DD）——跨天判定必须用本地而非 UTC（toISOString 是 UTC，东八区凌晨判定会错位一天）。 */
export function localDateStr(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 解析状态文件原文（容错：缺失/坏 JSON/非对象一律回落到默认值，**不抛**）。
 * 与原实现同语义：`{ ...DEFAULT_STATE, ...parsed }` 浅合并——不合法字段保持默认（保守）。
 */
export function parseState(raw: string | null | undefined): ReflectionState {
  if (raw === null || raw === undefined) return { ...DEFAULT_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<ReflectionState> | null
    return { ...DEFAULT_STATE, ...(parsed as Partial<ReflectionState>) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** 时刻判定的裁决结果（reason 供日志/测试定位是哪个早退分支）。 */
export type TimeDecision =
  | { action: 'trigger' }
  | { action: 'skip'; reason: 'disabled' | 'already-triggered-today' | 'before-trigger-time' }

/**
 * 时刻判定（原 `checkAndTrigger` 的前半段，早退顺序逐字保留）：
 *   ① `enabled === false` → 跳过
 *   ② 非 force 且同日已触发 → 跳过
 *   ③ 非 force 且当前时刻 < 触发时刻 → 跳过
 * force（手动触发）跳过 ②③，但**不**跳过 ①（原实现里 enabled 判定在 force 之前）。
 */
export function decideByTime(input: {
  enabled: boolean
  hour: number
  minute: number
  force: boolean
  now: Date
  state: ReflectionState
}): TimeDecision {
  if (!input.enabled) return { action: 'skip', reason: 'disabled' }
  const today = localDateStr(input.now)
  if (!input.force && input.state.lastTriggerDate === today) return { action: 'skip', reason: 'already-triggered-today' }
  const nowMin = input.now.getHours() * 60 + input.now.getMinutes()
  const targetMin = input.hour * 60 + input.minute
  if (!input.force && nowMin < targetMin) return { action: 'skip', reason: 'before-trigger-time' }
  return { action: 'trigger' }
}

/** 会话事件访问器（只读，duck-typing——不 import 宿主类型）。 */
export interface SessionLike {
  seq: number
  eventAt(seq: number): unknown | undefined
}

/**
 * 对话中判定：区间 `[startSeq, session.seq)` 内是否出现真正的用户输入（GUI 用户消息 /
 * telegram 插件消息）。纯函数（只读访问器），脏事件（缺 data/source/type）一律跳过、**不抛**。
 */
export function isInterrupted(session: SessionLike, startSeq: number): boolean {
  for (let i = startSeq; i < session.seq; i += 1) {
    const ev = session.eventAt(i) as { type?: string; data?: { source?: { kind?: string; plugin?: string } } } | undefined
    if (ev?.type !== 'user/message') continue
    const src = ev.data?.source
    const kind = src?.kind
    if (kind === 'user') return true
    if (kind === 'plugin' && src?.plugin === 'dsh-agent-telegram') return true
  }
  return false
}

/**
 * 可打断性判定（对话优先）：force 忽略；否则 inbox 有 pending **或**期间被用户打断 → 跳过。
 * `interrupted` 以 thunk 传入：保留原 `||` 的**短路**语义（inbox 有 pending 时不再触碰
 * `session.eventAt`——该访问器缺失时会让定时器回调抛未捕获异常）。
 */
export function shouldSkipForConversation(
  force: boolean,
  opts: { inboxPending: boolean; interrupted: () => boolean },
): boolean {
  if (force) return false
  return opts.inboxPending || opts.interrupted()
}

/** 情感插件统计数据（宽松形状，跨包不 import）。 */
export interface EmotionStats {
  toolCalls?: number
  toolSuccess?: number
  toolErrors?: number
  outputs?: number
  interactions?: number
  frontierTools?: number
  legacyWrites?: number
}

/** 情感插件状态文件（宽松形状）。 */
export interface EmotionStateLoose {
  today?: string
  stats?: EmotionStats
  weights?: Record<string, number>
  emotions?: Record<string, number>
  history?: unknown[]
}

/** 工具预期命中率（侧面一·认知锚点）：无调用记录 → 0（保守，不返回 NaN/Infinity）。 */
export function computeHitRate(stats: EmotionStats | undefined): number {
  const s = stats ?? {}
  return (s.toolCalls ?? 0) > 0 ? Math.round(((s.toolSuccess ?? 0) / (s.toolCalls ?? 1)) * 100) : 0
}

/** 6 维总结正文（与原实现逐字一致：字段名、分隔符、缺省 '?' 全部照搬）。 */
export function buildEmotionSummary(st: EmotionStateLoose): string {
  const s = st.stats ?? {}
  const hitRate = computeHitRate(s)
  const w = st.weights ?? {}
  const e = st.emotions ?? {}
  const weightStr = Object.entries(w).map(([k, v]) => `${k.slice(0, 1).toUpperCase()}${Math.round((v ?? 0) * 100)}%`).join(' ')
  return [
    '',
    '—— 情感插件 6 维数据（dsh-agent-emotion，' + (st.today ?? '?') + '）——',
    '一·认知锚点：工具预期命中率 ' + hitRate + '%（' + (s.toolCalls ?? 0) + ' 次）',
    '二·韧性引擎：失败 ' + (s.toolErrors ?? 0) + ' 次',
    '三·存在显影：输出 ' + (s.outputs ?? 0) + ' / 交互 ' + (s.interactions ?? 0),
    '四·关系织网：交互 ' + (s.interactions ?? 0) + ' 次',
    '五·疆域开拓：新工具 ' + (s.frontierTools ?? 0) + ' 个',
    '六·因果留痕：写入 ' + (s.legacyWrites ?? 0) + ' 条',
    '人格权重：' + weightStr,
    '情感信号：' + JSON.stringify(e),
  ].join('\n')
}

/**
 * 从状态文件原文生成 6 维总结：坏 JSON / JSON null / 形状异常一律返回 `null`（**不抛**）。
 * 与原实现的 try/catch 边界等价——原来「解析 + 取字段 + 拼串」在同一 try 里，这里同样。
 */
export function buildEmotionSummaryFromRaw(raw: string): string | null {
  try {
    return buildEmotionSummary(JSON.parse(raw) as EmotionStateLoose)
  } catch {
    return null
  }
}
