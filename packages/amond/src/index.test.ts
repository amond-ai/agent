import { describe, expect, it, vi } from 'vitest'
import { main } from './index'

describe('the amond CLI entry point', () => {
  it('exits 1 and prints usage when no command is given', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    expect(main([])).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('usage: amond'))

    stderr.mockRestore()
  })

  it('exits 2 on an unknown command, distinguishing it from no command at all', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    expect(main(['deploy'])).toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('usage: amond'))

    stderr.mockRestore()
  })

  it('names the command it cannot run yet, rather than reporting a usage error', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    expect(main(['build'])).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('amond build: not implemented'))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('usage:'))

    stderr.mockRestore()
  })
})
