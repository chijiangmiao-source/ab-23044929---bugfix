/**
 * 带符号排列的底层表示与校验。
 *
 * 标记 +k / -k 编码为 token：
 *   +k -> 2*(k-1)（偶数），-k -> 2*(k-1)+1（奇数）
 * 这样“翻转符号”就是 token ^ 1。
 *
 * 一个合法排列（绝对值恰为 1..n 且互异）可进一步压进一个整数作为 Map 键，
 * 以支撑浏览器内对全部最短方案的完整 BFS 计数（n<=7，token 占 4 位）。
 */

export type Token = number;

export function encodeToken(signed: number): Token {
  return signed > 0 ? (signed - 1) * 2 : -signed * 2 - 1;
}

export function flipToken(t: Token): Token {
  return t ^ 1;
}

export function tokenMagnitude(t: Token): number {
  return (t >> 1) + 1;
}

export function tokenSign(t: Token): 1 | -1 {
  return (t & 1) === 0 ? 1 : -1;
}

export function tokenToSigned(t: Token): number {
  return tokenSign(t) * tokenMagnitude(t);
}

/** 在 [i,j]（含端点，0 基）上执行一次倒位：反转次序并翻转每个符号。 */
export function applyInversion(tokens: Token[], i: number, j: number): Token[] {
  const next = tokens.slice();
  let a = i;
  let b = j;
  while (a < b) {
    const left = next[a];
    const right = next[b];
    next[a] = flipToken(right);
    next[b] = flipToken(left);
    a += 1;
    b -= 1;
  }
  if (a === b) {
    next[a] = flipToken(next[a]);
  }
  return next;
}

/** 将整个排列压缩为整数键（每个 token 占 4 位，存储值为 token+1 以区分前导 0）。 */
export function encodeState(tokens: Token[]): number {
  let code = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    code |= (tokens[k] + 1) << (4 * k);
  }
  return code;
}

export function decodeState(code: number, n: number): Token[] {
  const tokens: Token[] = new Array<number>(n);
  for (let k = 0; k < n; k += 1) {
    tokens[k] = ((code >>> (4 * k)) & 0x0f) - 1;
  }
  return tokens;
}

export interface ValidationResult {
  /** 校验通过时给出的 token 排列 */
  tokens?: Token[];
  /** 一次性合并给出的全部错误（输入始终保留在文本框中，由 UI 负责） */
  errors: string[];
}

const TOKEN_SPLIT = /[\s,，;；|/]+/;
const INTEGER = /^[+-]?\d+$/;

export function validatePermutation(raw: string): ValidationResult {
  const errors: string[] = [];
  const parts = raw
    .trim()
    .replace(/^\[+/, '')
    .replace(/\]+$/, '')
    .split(TOKEN_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const n = parts.length;
  if (n < 3 || n > 7) {
    errors.push(`标记数量必须在 3 至 7 个之间，当前为 ${n} 个。`);
    // 数量不合法时仍继续检查各项格式，尽量合并反馈。
  }

  const signed: number[] = [];
  for (const part of parts) {
    if (!INTEGER.test(part)) {
      errors.push(`“${part}” 不是整数标记。`);
      continue;
    }
    const value = Number(part);
    if (value === 0) {
      errors.push('标记不能为 0（允许的绝对值从 1 开始）。');
      continue;
    }
    if (n >= 3 && n <= 7 && (Math.abs(value) < 1 || Math.abs(value) > n)) {
      errors.push(`标记 ${value} 的绝对值超出范围，n=${n} 时只允许 1 至 ${n}。`);
    }
    signed.push(value);
  }

  if (n >= 3 && n <= 7 && signed.length > 0) {
    const seen = new Map<number, number>();
    const duplicateMagnitudes = new Set<number>();
    for (const value of signed) {
      const mag = Math.abs(value);
      if (mag < 1 || mag > n) continue; // 范围错误已反馈
      const prev = seen.get(mag);
      if (prev === undefined) {
        seen.set(mag, value);
      } else {
        duplicateMagnitudes.add(mag);
      }
    }
    if (duplicateMagnitudes.size > 0) {
      const list = [...duplicateMagnitudes].sort((a, b) => a - b).join('、');
      errors.push(`绝对值重复：${list} 各出现了不止一次（绝对值必须互异且恰为 1 至 ${n}）。`);
    }
  }

  if (errors.length === 0) {
    return { tokens: signed.map(encodeToken), errors };
  }
  return { errors };
}

/** bigint 方案总数的精确十进制展示，按千位分组但不损失任何精度。 */
export function formatBigIntDecimal(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
