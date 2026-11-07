import { describe, expect, it } from 'vitest'
import { fromMinor, toMinor } from './money'

describe('money', () => {
  it('parses without float error', () => {
    expect(toMinor('0.1') + toMinor('0.2')).toBe(30)
    expect(toMinor('19.99')).toBe(1999)
    expect(toMinor('-5')).toBe(-500)
  })
  it('accepts numbers from the API as well as strings', () => {
    expect(toMinor(1000)).toBe(100000)
    expect(toMinor(12.5)).toBe(1250)
    expect(toMinor(0)).toBe(0)
    expect(toMinor('1000.00')).toBe(100000)
  })
  it('round-trips', () => {
    expect(fromMinor(toMinor('125.5'))).toBe('125.50')
    expect(fromMinor(-5)).toBe('-0.05')
  })
  it('rejects bad input', () => {
    expect(() => toMinor('1.234')).toThrow()
    expect(() => toMinor('abc')).toThrow()
  })
})
