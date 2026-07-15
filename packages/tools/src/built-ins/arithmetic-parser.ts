type Token = number | '+' | '-' | '*' | '/' | '%' | '(' | ')'

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < expression.length) {
    const char = expression[index]

    if (char === undefined) {
      break
    }

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if ('+-*/%()'.includes(char)) {
      tokens.push(char as Token)
      index += 1
      continue
    }

    if (/\d|\./.test(char)) {
      let end = index + 1
      while (end < expression.length && /[\d.]/.test(expression[end] ?? '')) {
        end += 1
      }

      const value = Number(expression.slice(index, end))
      if (!Number.isFinite(value)) {
        throw new Error('Invalid number.')
      }

      tokens.push(value)
      index = end
      continue
    }

    throw new Error('Only arithmetic expressions are allowed.')
  }

  return tokens
}

export function evaluateArithmetic(expression: string): number {
  const tokens = tokenize(expression)
  let position = 0

  function peek(): Token | undefined {
    return tokens[position]
  }

  function consume(): Token | undefined {
    const token = tokens[position]
    position += 1
    return token
  }

  function parsePrimary(): number {
    const token = consume()

    if (typeof token === 'number') {
      return token
    }

    if (token === '-') {
      return -parsePrimary()
    }

    if (token === '(') {
      const value = parseExpression()
      if (consume() !== ')') {
        throw new Error('Missing closing parenthesis.')
      }
      return value
    }

    throw new Error('Expected a number or expression.')
  }

  function parseFactor(): number {
    let value = parsePrimary()

    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = consume()
      const right = parsePrimary()

      if (operator === '*') value *= right
      if (operator === '/') value /= right
      if (operator === '%') value %= right
    }

    return value
  }

  function parseExpression(): number {
    let value = parseFactor()

    while (peek() === '+' || peek() === '-') {
      const operator = consume()
      const right = parseFactor()
      value = operator === '+' ? value + right : value - right
    }

    return value
  }

  const result = parseExpression()

  if (position !== tokens.length) {
    throw new Error('Unexpected trailing token.')
  }

  if (!Number.isFinite(result)) {
    throw new Error('Expression did not return a finite number.')
  }

  return result
}
