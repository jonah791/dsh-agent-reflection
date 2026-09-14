/**
 * state-io.ts — 落盘的**薄 IO 壳**（决策逻辑全在 `reflect-plan.ts`，本文件只碰文件系统）。
 *
 * 准则 C4（观测不反噬主流程，技能 `plugin-maintainability`）：留痕/状态写失败**绝不抛出**，
 * 一律吞错并返回 bool——写失败只代表「这次没留下痕」，不代表业务失败。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 原子感的最小写盘：建父目录 + JSON 美化写入。任何失败（父路径是普通文件、
 * 目录不可写、序列化循环引用）→ 返回 `false`，**不抛**。
 * @param file - 目标文件绝对路径
 * @param data - 待序列化数据
 * @returns 是否真的写入成功
 */
export function writeJsonSafe(file: string, data: unknown): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
