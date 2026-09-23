/**
 * 带符号排列的倒位（reversal）最短方案审计。
 *
 * 状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 * 存 token+1）。倒位邻居完全用位运算枚举：在区间 [i,j] 上，新状态第 k 位的
 * nibble 为旧状态第 i+j-k 位 nibble 先翻转符号（token ^ 1）再加 1。
 *
 * n<=7 时状态至多 2^n·n! ≈ 645120、每态至多 28 个倒位，浏览器内可即时完成，
 * 因而所有结果都是精确的：
 *   - 最短步数；
 *   - 方案总数（bigint 任意精度累加，按十进制展示）；
 *   - 规范方案：全部最短方案中按“每步 (start,end) 序列”字典序最小者；
 *   - 深度×区间矩阵：逐格统计该倒位在多少最短方案的该深度出现。
 */

import { decodeState, encodeState, type Token } from './permutation';

/** 一次倒位：1 基闭区间 [start,end]；反转次序并翻转符号。 */
export interface InversionStep {
  start: number;
  end: number;
}

export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的最短方案数量（bigint，精确） */
  pathCount: bigint;
  presence: CellPresence;
}

export interface AuditResult {
  n: number;
  initial: Token[];
  /** 最少倒位步数 */
  distance: number;
  /** 全部最短方案总数（任意精度） */
  totalPaths: bigint;
  /** 规范方案：全最短方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×区间矩阵。matrix[d] 给出深度 d（第 d+1 步）各区间的出现统计，
   * 区间按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   */
  matrix: {
    depth: number;
    intervals: IntervalCell[];
  }[];
}

/** 在压缩状态 code 上枚举全部倒位邻居，按 (i,j) 字典序回调，零数组分配。 */
function eachNeighbor(
  code: number,
  n: number,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let nextCode = code;
      // 先把区间内各位清零（取区间外的 nibble），再按反转+翻转填回。
      let mask = 0;
      for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
      nextCode &= ~mask;
      for (let k = i; k <= j; k += 1) {
        // 存储 nibble = token+1；翻转后的存储值为 ((token ^ 1) + 1)。
        const stored = (code >>> (4 * (i + j - k))) & 0x0f;
        const flipped = ((stored - 1) ^ 1) + 1;
        nextCode |= flipped << (4 * k);
      }
      cb(nextCode, i + 1, j + 1);
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

interface FrontierEntry {
  code: number;
  breakpoints: number;
  order: number;
}

function breakpointCount(code: number, n: number): number {
  let count = 0;
  let previous = 0;
  for (let k = 0; k < n; k += 1) {
    const token = ((code >>> (4 * k)) & 0x0f) - 1;
    const magnitude = (token >> 1) + 1;
    const value = (token & 1) === 0 ? magnitude : -magnitude;
    if (value !== previous + 1) count += 1;
    previous = value;
  }
  if (previous !== n) count += 1;
  return count;
}

function frontierLess(a: FrontierEntry, b: FrontierEntry): boolean {
  return a.breakpoints !== b.breakpoints
    ? a.breakpoints < b.breakpoints
    : a.order < b.order;
}

function frontierPush(heap: FrontierEntry[], entry: FrontierEntry): void {
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    if (!frontierLess(entry, heap[parentIndex])) break;
    heap[index] = heap[parentIndex];
    index = parentIndex;
  }
  heap[index] = entry;
}

function frontierPop(heap: FrontierEntry[]): FrontierEntry {
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return first;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child =
      right < heap.length && frontierLess(heap[right], heap[left])
        ? right
        : left;
    if (!frontierLess(heap[child], last)) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

export function solve(initial: Token[]): AuditResult {
  const n = initial.length;
  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    // 全正顺序：距离 0、方案 1（空序列），矩阵为空。
    return {
      n,
      initial,
      distance: 0,
      totalPaths: 1n,
      canonical: { steps: [], states: [initial.slice()] },
      matrix: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 1) 前向 BFS：distF（初始态 -> 各态）与规范父边。
   *    邻居按 (start,end) 字典序枚举，首次到达的父边即字典序最早者，
   *    沿它回溯得到规范方案。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  {
    const queue: FrontierEntry[] = [];
    let order = 0;
    frontierPush(queue, {
      code: startCode,
      breakpoints: breakpointCount(startCode, n),
      order: order++,
    });
    distF.set(startCode, 0);
    while (queue.length > 0) {
      const { code } = frontierPop(queue);
      const d = distF.get(code)!;
      if (code === goalCode) break; // 队列按层推进，到达目标即最短层
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (!distF.has(nextCode)) {
          distF.set(nextCode, d + 1);
          parent.set(nextCode, { code, start, end });
          frontierPush(queue, {
            code: nextCode,
            breakpoints: breakpointCount(nextCode, n),
            order: order++,
          });
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向 BFS（倒位自逆，邻居枚举相同），只保留位于某条最短路径上
   *    的状态（distF <= distance）。分层汇总 waysToGoal：
   *    v 到目标的最短路径条数。
   * ------------------------------------------------------------------ */
  const routes: InversionStep[][] = [];
  eachNeighbor(goalCode, n, (previousCode, finalStart, finalEnd) => {
    if (distF.get(previousCode) !== distance - 1) return;

    const reversed: InversionStep[] = [
      { start: finalStart, end: finalEnd },
    ];
    let cursor = previousCode;
    while (cursor !== startCode) {
      const p = parent.get(cursor)!;
      reversed.push({ start: p.start, end: p.end });
      cursor = p.code;
    }
    reversed.reverse();
    routes.push(reversed);
  });

  const totalPaths = BigInt(routes.length);

  /* ------------------------------------------------------------------ *
   * 3) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按区间聚合到矩阵格；
   *    waysFromStart 随层滚动。
   * ------------------------------------------------------------------ */
  const matrix: AuditResult['matrix'] = [];
  // 全部区间按 (start,end) 字典序预登记，任何最短方案都没用到的保持 none。
  const allIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      allIntervals.push({ start: i + 1, end: j + 1 });
    }
  }

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    for (const route of routes) {
      const step = route[d];
      const key = `${step.start}:${step.end}`;
      counts.set(key, counts.get(key)! + 1n);
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, intervals });
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    n,
    initial,
    distance,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/** Worker 传输用 DTO：bigint 不能依赖所有环境的结构化克隆，统一转十进制字符串。 */
export interface AuditResultDTO {
  n: number;
  initial: Token[];
  distance: number;
  totalPaths: string;
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  matrix: {
    depth: number;
    intervals: {
      start: number;
      end: number;
      pathCount: string;
      presence: CellPresence;
    }[];
  }[];
}

export function toDTO(result: AuditResult): AuditResultDTO {
  return {
    n: result.n,
    initial: result.initial,
    distance: result.distance,
    totalPaths: result.totalPaths.toString(),
    canonical: result.canonical,
    matrix: result.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: cell.pathCount.toString(),
        presence: cell.presence,
      })),
    })),
  };
}

export function fromDTO(dto: AuditResultDTO): AuditResult {
  return {
    n: dto.n,
    initial: dto.initial,
    distance: dto.distance,
    totalPaths: BigInt(dto.totalPaths),
    canonical: dto.canonical,
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
      })),
    })),
  };
}
