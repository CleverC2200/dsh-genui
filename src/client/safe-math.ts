export interface SafeMathOptions {

  vars?: Record<string, number>

  allowImplicitVariables?: boolean

  allowUnboundVariables?: boolean
}

export interface SafeMathProgram {

  evaluate: (x: number) => number

  variables: string[]
}

export const SAFE_MATH_LIMITS = {
  maxExpressionLength: 512,
  maxDepth: 32,
} as const

export function parseDecimalNumber(value: string): number | undefined {
  const normalized = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, cbrt: Math.cbrt,
  exp: Math.exp, log: Math.log10, ln: Math.log,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max,
  pow: (a, b) => Math.pow(a, b),
}

class ParseError extends Error {
  constructor(message: string, readonly pos: number) {
    super(`SafeMath parse error at ${pos}: ${message}`)
  }
}

class SafeMathParser {
  private i = 0
  private depth = 0
  private readonly variables = new Set<string>()
  constructor(
    private readonly src: string,
    private readonly vars: Record<string, number>,
    private readonly allowImplicitVariables: boolean,
    private readonly allowUnboundVariables: boolean,
  ) {}

  parse(): SafeMathProgram {
    const node = this.parseExpr()
    this.skipWs()
    if (this.i < this.src.length) throw new ParseError('unexpected trailing input', this.i)
    return { evaluate: this.evalNode(node), variables: [...this.variables] }
  }

  private evalNode(node: number | ((x: number) => number)): (x: number) => number {
    if (typeof node === 'number') return () => node
    return node
  }

  private parseExpr(): number | ((x: number) => number) {
    let left = this.parseTerm()
    for (;;) {
      this.skipWs()
      const c = this.peek()
      if (c === '+' || c === '-') {
        this.i++
        const right = this.parseTerm()
        const op = c
        const prev = left
        left = op === '+'
          ? (x) => this.asNum(prev, x) + this.asNum(right, x)
          : (x) => this.asNum(prev, x) - this.asNum(right, x)
      } else return left
    }
  }

  private parseTerm(): number | ((x: number) => number) {
    let left = this.parseUnary()
    for (;;) {
      this.skipWs()
      const c = this.peek()
      if (c === '*' || c === '/' || c === '%') {
        this.i++
        const right = this.parseUnary()
        const op = c
        const prev = left
        left = op === '*'
          ? (x) => this.asNum(prev, x) * this.asNum(right, x)
          : op === '/'
            ? (x) => this.asNum(prev, x) / this.asNum(right, x)
            : (x) => this.asNum(prev, x) % this.asNum(right, x)
      } else return left
    }
  }

  private parseUnary(): number | ((x: number) => number) {
    this.skipWs()
    const c = this.char()
    if (c === '-' || c === '+') {
      this.i++
      const operand = this.withDepth(() => this.parseUnary())
      return c === '-' ? (x) => -this.asNum(operand, x) : (x) => this.asNum(operand, x)
    }
    return this.parsePower()
  }

  private parsePower(): number | ((x: number) => number) {
    const base = this.parseAtom()
    this.skipWs()
    if (this.peek() === '^') {
      this.i++
      const exp = this.withDepth(() => this.parsePower())
      const prev = base
      return (x) => Math.pow(this.asNum(prev, x), this.asNum(exp, x))
    }
    return base
  }

  private parseAtom(): number | ((x: number) => number) {
    this.skipWs()
    const c = this.char()
    if (c === '(') {
      this.i++
      const inner = this.withDepth(() => this.parseExpr())
      this.skipWs()
      if (this.peek() !== ')') throw new ParseError('expected )', this.i)
      this.i++
      return inner
    }
    if (c >= '0' && c <= '9' || c === '.') return this.parseNumber()
    if (this.isIdentStart(c)) return this.parseIdent()
    throw new ParseError(`unexpected character '${c}'`, this.i)
  }

  private parseNumber(): number {
    const start = this.i
    let sawDigit = false

    while (this.i < this.src.length && /[0-9]/.test(this.src[this.i]!)) {
      sawDigit = true
      this.i++
    }

    if (this.peek() === '.') {
      this.i++
      while (this.i < this.src.length && /[0-9]/.test(this.src[this.i]!)) {
        sawDigit = true
        this.i++
      }
    }

    if (!sawDigit) {
      throw new ParseError(`invalid number '${this.src.slice(start, this.i)}'`, start)
    }

    if (this.peek() === 'e' || this.peek() === 'E') {
      this.i++
      if (this.peek() === '+' || this.peek() === '-') this.i++
      const exponentStart = this.i
      while (this.i < this.src.length && /[0-9]/.test(this.src[this.i]!)) this.i++
      if (this.i === exponentStart) {
        throw new ParseError(`invalid number '${this.src.slice(start, this.i)}'`, start)
      }
    }

    const text = this.src.slice(start, this.i)
    const value = Number(text)
    if (!Number.isFinite(value)) throw new ParseError(`invalid number '${text}'`, start)
    return value
  }

  private parseIdent(): number | ((x: number) => number) {
    const start = this.i
    while (this.i < this.src.length && this.isIdentChar(this.src[this.i]!)) this.i++
    const name = this.src.slice(start, this.i)
    this.skipWs()
    if (this.peek() === '(') {

      if (!Object.hasOwn(FUNCTIONS, name)) throw new ParseError(`unknown function '${name}'`, start)
      const fn = FUNCTIONS[name]!
      this.i++
      const args: Array<number | ((x: number) => number)> = []
      this.skipWs()
      if (this.peek() === ')') {
        this.i++
      } else {
        for (;;) {
          args.push(this.withDepth(() => this.parseExpr()))
          this.skipWs()
          const sep = this.peek()
          if (sep === ',') { this.i++; continue }
          if (sep === ')') { this.i++; break }
          throw new ParseError('expected , or ) in call', this.i)
        }
      }
      return (x) => fn(...args.map(a => this.asNum(a, x)))
    }

    if (!this.allowImplicitVariables && Object.hasOwn(this.vars, name)) {
      this.variables.add(name)
      const captured = this.vars[name]!
      return () => captured
    }
    if (Object.hasOwn(CONSTANTS, name) && this.allowImplicitVariables) return CONSTANTS[name]!
    if (this.allowImplicitVariables && name === 'x') {

      return (value: number) => value
    }
    if (Object.hasOwn(this.vars, name)) {
      this.variables.add(name)

      const captured = this.vars[name]!
      return () => captured
    }

    if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name]!
    if (this.allowImplicitVariables && /^[a-z]$/.test(name)) return () => 1
    if (this.allowUnboundVariables) {
      this.variables.add(name)
      return () => NaN
    }
    throw new ParseError(`unknown identifier '${name}'`, start)
  }

  private asNum(node: number | ((x: number) => number), x: number): number {
    return typeof node === 'number' ? node : node(x)
  }

  private withDepth<T>(read: () => T): T {
    this.depth += 1
    if (this.depth > SAFE_MATH_LIMITS.maxDepth) {
      this.depth -= 1
      throw new ParseError('expression nesting exceeds limit', this.i)
    }
    try {
      return read()
    } finally {
      this.depth -= 1
    }
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i++
  }

  private peek(): string | undefined {
    return this.src[this.i]
  }

  private char(): string {
    const c = this.peek()
    if (c === undefined) throw new ParseError('unexpected end of input', this.i)
    return c
  }

  private isIdentStart(c: string | undefined): boolean {
    return c !== undefined && /[a-zA-Z_]/.test(c)
  }

  private isIdentChar(c: string): boolean {
    return /[a-zA-Z0-9_]/.test(c)
  }
}

export function compileMathExpr(expr: string, options: SafeMathOptions = {}): ((x: number) => number) | null {
  return compileMathExprProgram(expr, options)?.evaluate ?? null
}

export function compileMathExprProgram(expr: string, options: SafeMathOptions = {}): SafeMathProgram | null {
  try {

    const vars: Record<string, number> = { ...options.vars }
    if (options.allowImplicitVariables !== false) delete vars.x
    if (expr.length > SAFE_MATH_LIMITS.maxExpressionLength
      || Object.values(vars).some(value => !Number.isFinite(value))) return null
    return new SafeMathParser(expr, vars, options.allowImplicitVariables !== false, options.allowUnboundVariables === true).parse()
  } catch {
    return null
  }
}

export function sampleExpr(
  expr: string,
  xMin: number,
  xMax: number,
  samples = 200,
  params: Record<string, number> = {},
): Array<[number, number]> {
  const fn = compileMathExpr(expr, { vars: params })
  if (fn === null) return []
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin || samples < 2) return []
  const points: Array<[number, number]> = []
  const step = (xMax - xMin) / (samples - 1)
  for (let i = 0; i < samples; i++) {
    const x = xMin + step * i
    const y = fn(x)
    if (Number.isFinite(y)) points.push([x, y])
  }
  return points
}
