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
 *
 * 算法（全部为精确的最短路径 DAG 计算，无任何贪心近似）：
 *   1) 前向 BFS（标准 FIFO 队列，邻居按 (start,end) 字典序枚举）：
 *      首次到达即最短距离 distF；每个状态的首条父边构成字典序最小的
 *      最短方案树，沿目标态回溯即规范方案；
 *   2) 反向 BFS（倒位自逆，枚举相同）：只保留位于某条最短路径上的状态
 *      （distF(u) + distR(u) === distance），得到 distR；
 *   3) 在最短路径 DAG 上分层做双向 DP（bigint）：
 *      waysFromStart(u) = 初始态到 u 的最短方案数，
 *      waysToGoal(v)    = v 到目标态的最短方案数；
 *   4) 深度×区间矩阵：DAG 边 (u,v) 在深度 d 的方案数为
 *      waysFromStart(u) × waysToGoal(v)，按区间聚合到矩阵格。
 *      每行各格之和恰为方案总数；多条最短前缀汇入同一状态时，
 *      其方案数在 waysFromStart 中自然累加，后续各层计数随之精确。
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
   * 1) 前向 BFS：distF（初始态 -> 各态的最短距离）与规范父边。
   *    标准 FIFO 队列按层推进；邻居按 (start,end) 字典序枚举，
   *    首次到达的父边即字典序最早者，沿它回溯得到规范方案。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  {
    const queue: number[] = [startCode];
    distF.set(startCode, 0);
    for (let head = 0; head < queue.length; head += 1) {
      const code = queue[head];
      if (code === goalCode) break; // 按层出队，目标出队时其所在层已全部发现
      const d = distF.get(code)!;
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (!distF.has(nextCode)) {
          distF.set(nextCode, d + 1);
          parent.set(nextCode, { code, start, end });
          queue.push(nextCode);
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向 BFS（倒位自逆，邻居枚举相同），只保留位于某条最短路径上
   *    的状态：distF(u) + distR(u) === distance。
   *    （distF 已是最短距离，distF(u)+distR(u) 不可能小于 distance，
   *    故筛选条件恰好圈出全部最短路径 DAG 上的状态。）
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  {
    const queue: number[] = [goalCode];
    distR.set(goalCode, 0);
    for (let head = 0; head < queue.length; head += 1) {
      const code = queue[head];
      const d = distR.get(code)!;
      eachNeighbor(code, n, (nextCode) => {
        if (distR.has(nextCode)) return;
        const df = distF.get(nextCode);
        if (df === undefined || df + d + 1 > distance) return;
        distR.set(nextCode, d + 1);
        queue.push(nextCode);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 3) 最短路径 DAG 分层：byLayer[d] 为 distF = d 的 DAG 状态
   *    （按前向 BFS 发现序，天然满足层间拓扑序）。
   * ------------------------------------------------------------------ */
  const byLayer: number[][] = [];
  for (let d = 0; d <= distance; d += 1) byLayer.push([]);
  for (const [code, d] of distF) {
    if (distR.has(code)) byLayer[d].push(code);
  }

  /* ------------------------------------------------------------------ *
   * 4) 前向分层 DP：waysFromStart(u) = 初始态到 u 的最短方案数。
   *    多条最短前缀汇入同一状态时在此自然累加。
   * ------------------------------------------------------------------ */
  const waysFromStart = new Map<number, bigint>();
  waysFromStart.set(startCode, 1n);
  for (let d = 0; d < distance; d += 1) {
    for (const code of byLayer[d]) {
      const ways = waysFromStart.get(code) ?? 0n;
      if (ways === 0n) continue;
      eachNeighbor(code, n, (nextCode) => {
        if (distF.get(nextCode) === d + 1 && distR.has(nextCode)) {
          waysFromStart.set(
            nextCode,
            (waysFromStart.get(nextCode) ?? 0n) + ways,
          );
        }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 5) 反向分层 DP：waysToGoal(v) = v 到目标态的最短方案数。
   * ------------------------------------------------------------------ */
  const waysToGoal = new Map<number, bigint>();
  waysToGoal.set(goalCode, 1n);
  for (let d = distance; d > 0; d -= 1) {
    for (const code of byLayer[d]) {
      const ways = waysToGoal.get(code) ?? 0n;
      if (ways === 0n) continue;
      eachNeighbor(code, n, (nextCode) => {
        if (distF.get(nextCode) === d - 1 && distR.has(nextCode)) {
          waysToGoal.set(
            nextCode,
            (waysToGoal.get(nextCode) ?? 0n) + ways,
          );
        }
      });
    }
  }

  const totalPaths = waysFromStart.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 6) 逐层枚举最短 DAG 边 (u,v)：distF[u]=d、distF[v]=d+1。
   *    边方案数 = waysFromStart(u) × waysToGoal(v)，按区间聚合到矩阵格；
   *    每行各格之和恰为方案总数。
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
    for (const code of byLayer[d]) {
      const prefix = waysFromStart.get(code) ?? 0n;
      if (prefix === 0n) continue;
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1 || !distR.has(nextCode)) return;
        const suffix = waysToGoal.get(nextCode) ?? 0n;
        if (suffix === 0n) return;
        const key = `${start}:${end}`;
        counts.set(key, (counts.get(key) ?? 0n) + prefix * suffix);
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`) ?? 0n;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, intervals });
  }

  /* ------------------------------------------------------------------ *
   * 7) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
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
