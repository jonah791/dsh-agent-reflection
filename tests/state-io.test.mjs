/**
 * tests/state-io.test.mjs — 落盘薄壳的回归测试（准则 C4：观测/留痕失败绝不反噬主流程）。
 *
 * 覆盖：主路径（写得进、读得回）／失败路径（父路径是普通文件 = 不可写 → 返回 false **不抛**，
 * 可传不可写路径）／脏数据序列化（循环引用 → false 不抛）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJsonSafe } from '../lib/state-io.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'reflect-io-'))

test('writeJsonSafe: 主路径——建父目录 + JSON 美化写入，返回 true', () => {
  const dir = tmp()
  try {
    const file = join(dir, 'nested', 'reflection-state.json')
    assert.equal(writeJsonSafe(file, { lastTriggerDate: '2026-09-14', triggerCount: 2, lastTriggerAt: null }), true)
    assert.equal(existsSync(file), true)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { lastTriggerDate: '2026-09-14', triggerCount: 2, lastTriggerAt: null })
    assert.ok(readFileSync(file, 'utf-8').includes('\n  "triggerCount"')) // 缩进 2 = 与原实现逐字一致
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('writeJsonSafe: 覆盖已有文件（状态文件就地更新）', () => {
  const dir = tmp()
  try {
    const file = join(dir, 's.json')
    writeJsonSafe(file, { triggerCount: 1 })
    writeJsonSafe(file, { triggerCount: 9 })
    assert.equal(JSON.parse(readFileSync(file, 'utf-8')).triggerCount, 9)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('writeJsonSafe: 不可写路径（父路径是普通文件）→ 返回 false 且不抛', () => {
  const dir = tmp()
  try {
    const blocker = join(dir, 'not-a-dir')
    writeFileSync(blocker, 'x', 'utf-8')
    let ok
    assert.doesNotThrow(() => { ok = writeJsonSafe(join(blocker, 'child.json'), { a: 1 }) })
    assert.equal(ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('writeJsonSafe: 序列化失败（循环引用）→ 返回 false 且不抛', () => {
  const dir = tmp()
  try {
    const cyclic = { name: 'loop' }
    cyclic.self = cyclic
    let ok
    assert.doesNotThrow(() => { ok = writeJsonSafe(join(dir, 'cyclic.json'), cyclic) })
    assert.equal(ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('writeJsonSafe: 空对象/空串路径都不抛（保守，退化输入）', () => {
  assert.doesNotThrow(() => writeJsonSafe('', {}))
  assert.equal(writeJsonSafe('', {}), false)
})
