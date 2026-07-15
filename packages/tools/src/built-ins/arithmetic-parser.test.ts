import { describe, expect, it } from 'vitest'

import { evaluateArithmetic } from './arithmetic-parser'

describe('evaluateArithmetic', () => {
  it('evaluates operator precedence and grouping', () => {
    expect(evaluateArithmetic('2 + 3 * 4')).toBe(14)
    expect(evaluateArithmetic('-(2 + 3) * 4')).toBe(-20)
  })

  it('rejects non-arithmetic input', () => {
    expect(() => evaluateArithmetic('process.exit()')).toThrow('Only arithmetic expressions are allowed.')
  })

  it('rejects non-finite results', () => {
    expect(() => evaluateArithmetic('1 / 0')).toThrow('Expression did not return a finite number.')
  })
})
