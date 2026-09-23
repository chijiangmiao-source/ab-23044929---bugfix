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
 * 算法（两次严格按层的 BFS，绝不用启发式插队，否则距离与计数都会失真）：
 *   1) 前向 FIFO BFS（初始态出发）：distF 为精确最短距离；邻居按 (i,j)
 *      字典序枚举，首次到达的父边即字典序最早者；waysFromStart 随层累加
 *      （同一深度全部处理完后，下一层状态的方案数即最终确定）。
 *   2) 反向 FIFO BFS（目标态出发；倒位自逆、图无向）：distR / waysToGoal
 *      同样按层累加，深度超过 distance 的状态与最短方案无关、直接跳过。
 *      处理 v（distR = k）时，每条连向 distR = k+1 的边 (u,v) 若两端都落在
 *      某条最短路径上（distF + distR === distance），即一条“最短边”，
 *      其方案数 = waysFromStart(u) × waysToGoal(v)，按区间聚合进矩阵
 *      第 distF(u) 层；waysToGoal(v) 在 v 出队时已最终确定，计数精确。
 *   3) 规范方案：沿前向 BFS 的最早父边从目标回溯到初始态，再反序。
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
    // 区间掩码随 j 递增逐步扩展，避免内层重复计算。
    let mask = 0;
    for (let j = i; j < n; j += 1) {
      mask |= 0x0f << (4 * j);
      // 先把区间内各位清零（取区间外的 nibble），再按反转+翻转填回。
      let nextCode = code & ~mask;
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
   * 1) 前向 FIFO BFS：distF（初始态 -> 各态的精确最短距离）、规范父边、
   *    waysFromStart（初始态到各态的最短路径条数）。
   *    邻居按 (start,end) 字典序枚举，首次到达的父边即字典序最早者。
   *    目标态出队时，深度 <= distance 的状态已全部发现、其方案数已最终
   *    确定（FIFO 保证同深度节点全部处理后才会出队下一深度）。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const waysFromStart = new Map<number, bigint>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  const queueF: number[] = [startCode];
  distF.set(startCode, 0);
  waysFromStart.set(startCode, 1n);
  for (let head = 0; head < queueF.length; head += 1) {
    const code = queueF[head];
    if (code === goalCode) break; // 按层推进，目标出队即最短层
    const d = distF.get(code)!;
    const ways = waysFromStart.get(code)!;
    eachNeighbor(code, n, (nextCode, start, end) => {
      const known = distF.get(nextCode);
      if (known === undefined) {
        distF.set(nextCode, d + 1);
        waysFromStart.set(nextCode, ways);
        parent.set(nextCode, { code, start, end });
        queueF.push(nextCode);
      } else if (known === d + 1) {
        // 同层另一父边同样最短：累加方案数（更浅的已知态不可能再被更新）。
        waysFromStart.set(nextCode, waysFromStart.get(nextCode)! + ways);
      }
    });
  }

  const distance = distF.get(goalCode)!;
  const totalPaths = waysFromStart.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向 FIFO BFS（目标态出发）：distR / waysToGoal（各态到目标的最短
   *    路径条数），深度超过 distance 即停止扩展。
   *    同时在出队 v 时枚举“最短边”(u,v)：distR[u] = distR[v]+1 且两端
   *    distF + distR === distance。边方案数 = waysFromStart(u) ×
   *    waysToGoal(v)，按区间聚合到矩阵第 distF(u) 层。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  const waysToGoal = new Map<number, bigint>();
  const layerCounts: Map<string, bigint>[] = [];
  for (let d = 0; d < distance; d += 1) layerCounts.push(new Map());
  const queueR: number[] = [goalCode];
  distR.set(goalCode, 0);
  waysToGoal.set(goalCode, 1n);
  for (let head = 0; head < queueR.length; head += 1) {
    const code = queueR[head];
    const k = distR.get(code)!;
    if (k >= distance) continue; // 更深处不可能位于任何最短路径上
    const ways = waysToGoal.get(code)!;
    const distFHere = distF.get(code);
    const hereOnShortest = distFHere !== undefined && distFHere + k === distance;
    eachNeighbor(code, n, (nextCode, start, end) => {
      const known = distR.get(nextCode);
      if (known === undefined) {
        distR.set(nextCode, k + 1);
        waysToGoal.set(nextCode, ways);
        queueR.push(nextCode);
      } else if (known === k + 1) {
        waysToGoal.set(nextCode, waysToGoal.get(nextCode)! + ways);
      } else {
        return; // distR 未沿最短路递增：不是最短边
      }
      // 边 (nextCode, code) 落在某条最短路径上当且仅当两端都满足
      // distF + distR === distance；此时它的前向深度为 distF(nextCode)。
      if (!hereOnShortest) return;
      const distFNext = distF.get(nextCode);
      if (distFNext === undefined || distFNext + k + 1 !== distance) return;
      const key = `${start}:${end}`;
      const counts = layerCounts[distFNext];
      const edgePaths = waysFromStart.get(nextCode)! * ways;
      counts.set(key, (counts.get(key) ?? 0n) + edgePaths);
    });
  }

  /* ------------------------------------------------------------------ *
   * 3) 组装深度×区间矩阵：全部区间按 (start,end) 字典序预登记，
   *    任何最短方案都没用到的保持 none；每层计数之和恒等于 totalPaths。
   * ------------------------------------------------------------------ */
  const allIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      allIntervals.push({ start: i + 1, end: j + 1 });
    }
  }

  const matrix: AuditResult['matrix'] = layerCounts.map((counts, d) => ({
    depth: d,
    intervals: allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`) ?? 0n;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    }),
  }));

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
