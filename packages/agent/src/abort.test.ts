import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeTimeoutSignal, roundUpTimeoutMs } from './abort.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('roundUpTimeoutMs', () => {
  it('rounds fractional deadlines up, never down', () => {
    expect(roundUpTimeoutMs(1500.4)).toBe(1501)
    expect(roundUpTimeoutMs(1500.9)).toBe(1501)
    expect(roundUpTimeoutMs(0.1)).toBe(1)
  })

  it('leaves whole deadlines unchanged', () => {
    expect(roundUpTimeoutMs(1500)).toBe(1500)
    expect(roundUpTimeoutMs(0)).toBe(0)
  })
})

describe('composeTimeoutSignal', () => {
  it('rounds a fractional timeoutMs up before building the signal deadline', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    composeTimeoutSignal(1500.4, undefined)
    expect(spy).toHaveBeenCalledWith(1501)
  })

  it('returns no signals when there is no timeout and no caller signal', () => {
    expect(composeTimeoutSignal(undefined, undefined)).toEqual({
      timeoutSignal: undefined,
      mergedSignal: undefined,
    })
  })

  it('merges the caller signal with the deadline', () => {
    const controller = new AbortController()
    const { timeoutSignal, mergedSignal } = composeTimeoutSignal(60_000, controller.signal)
    expect(timeoutSignal?.aborted).toBe(false)
    controller.abort('host')
    expect(mergedSignal?.aborted).toBe(true)
  })
})
