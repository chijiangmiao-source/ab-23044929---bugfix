import { describe, expect, it } from 'vitest';
import {
  applyInversion,
  encodeState,
  encodeToken,
  formatBigIntDecimal,
  validatePermutation,
} from './permutation';
import { type InversionStep, solve } from './solver';

function tokensOf(values: number[]) {
  return values.map(encodeToken);
}

function signedOf(tokens: ReturnType<typeof tokensOf>) {
  return tokens.map((t) => ((t & 1) === 0 ? (t >> 1) + 1 : -(((t >> 1) + 1))));
}

/** 独立的暴力 DFS：枚举全部最短倒位序列，用于交叉验证。 */
function bruteForce(values: number[]): {
  distance: number;
  total: number;
  lexicographicMin: InversionStep[];
} {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));

  // BFS 求最短距离
  const dist = new Map<number, number>([[encodeState(start), 0]]);
  const queue = [encodeState(start)];
  let goal = -1;
  for (let head = 0; head < queue.length; head += 1) {
    const code = queue[head];
    if (code === goalCode) {
      goal = dist.get(code)!;
      break;
    }
    const d = dist.get(code)!;
    const cur: number[] = [];
    for (let k = 0; k < n; k += 1) cur.push(((code >>> (4 * k)) & 0x0f) - 1);
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = encodeState(applyInversion(cur, i, j));
        if (!dist.has(nx)) {
          dist.set(nx, d + 1);
          queue.push(nx);
        }
      }
    }
  }
  const distance = goal;

  // DFS 只走能保持最短性的边，枚举全部最短方案（n<=3 时规模很小）
  let total = 0;
  let lexicographicMin: InversionStep[] | null = null;
  const walk = (tokens: number[], d: number[], path: InversionStep[]) => {
    const code = encodeState(tokens);
    if (code === goalCode) {
      total += 1;
      if (
        lexicographicMin === null ||
        lexicographicLess(path, lexicographicMin)
      ) {
        lexicographicMin = path.slice();
      }
      return;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = applyInversion(tokens, i, j);
        const nxCode = encodeState(nx);
        if (dist.get(nxCode) === dist.get(code)! + 1 && dist.get(nxCode)! <= distance) {
          path.push({ start: i + 1, end: j + 1 });
          walk(nx, d, path);
          path.pop();
        }
      }
    }
  };
  walk(start, [], []);
  return { distance, total, lexicographicMin: lexicographicMin! };
}

function lexicographicLess(a: InversionStep[], b: InversionStep[]) {
  for (let k = 0; k < Math.max(a.length, b.length); k += 1) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) return true;
    if (y === undefined) return false;
    if (x.start !== y.start) return x.start < y.start;
    if (x.end !== y.end) return x.end < y.end;
  }
  return false;
}

/** 独立枚举全部最短倒位序列（按字典序返回），用于锁定完整方案集合。 */
function allShortestPaths(values: number[]): InversionStep[][] {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(
    tokensOf(Array.from({ length: n }, (_, k) => k + 1)),
  );

  const dist = new Map<number, number>([[encodeState(start), 0]]);
  const queue = [encodeState(start)];
  for (let head = 0; head < queue.length; head += 1) {
    const code = queue[head];
    const d = dist.get(code)!;
    if (dist.has(goalCode) && d >= dist.get(goalCode)!) break;
    const cur: number[] = [];
    for (let k = 0; k < n; k += 1) cur.push(((code >>> (4 * k)) & 0x0f) - 1);
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = encodeState(applyInversion(cur, i, j));
        if (!dist.has(nx)) {
          dist.set(nx, d + 1);
          queue.push(nx);
        }
      }
    }
  }

  const paths: InversionStep[][] = [];
  const walk = (tokens: number[], path: InversionStep[]) => {
    const code = encodeState(tokens);
    if (code === goalCode) {
      paths.push(path.slice());
      return;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = applyInversion(tokens, i, j);
        if (dist.get(encodeState(nx)) === dist.get(code)! + 1) {
          path.push({ start: i + 1, end: j + 1 });
          walk(nx, path);
          path.pop();
        }
      }
    }
  };
  walk(start, []);
  return paths.sort((a, b) =>
    lexicographicLess(a, b) ? -1 : lexicographicLess(b, a) ? 1 : 0,
  );
}

describe('倒位操作语义', () => {
  it('反转区间次序并同时翻转每个符号', () => {
    // [1,-3,-2,4] 倒位 [2,3] -> [1, 2, 3, 4]
    const got = applyInversion(tokensOf([1, -3, -2, 4]), 1, 2);
    expect(signedOf(got)).toEqual([1, 2, 3, 4]);
  });

  it('单点区间只翻转该符号', () => {
    const got = applyInversion(tokensOf([1, 2, 3]), 1, 1);
    expect(signedOf(got)).toEqual([1, -2, 3]);
  });
});

describe('需求用例 [1,-3,-2,4]', () => {
  it('最短步数为 1，规范倒位是 [2,3]，方案总数为 1', () => {
    const r = solve(tokensOf([1, -3, -2, 4]));
    expect(r.distance).toBe(1);
    expect(r.totalPaths).toBe(1n);
    expect(r.canonical.steps).toEqual([{ start: 2, end: 3 }]);
    expect(signedOf(r.canonical.states[1])).toEqual([1, 2, 3, 4]);
  });
});

describe('需求场景 [1,4,3,2]：恰两条最短方案', () => {
  const r = solve(tokensOf([1, 4, 3, 2]));

  it('距离 3、方案总数 2，规范轨迹依次 2-3 / 3-4 / 2-3', () => {
    expect(r.distance).toBe(3);
    expect(r.totalPaths).toBe(2n);
    expect(r.canonical.steps).toEqual([
      { start: 2, end: 3 },
      { start: 3, end: 4 },
      { start: 2, end: 3 },
    ]);
  });

  it('完整方案集合还包含同长替代轨迹 3-4 / 2-3 / 3-4', () => {
    expect(allShortestPaths([1, 4, 3, 2])).toEqual([
      [
        { start: 2, end: 3 },
        { start: 3, end: 4 },
        { start: 2, end: 3 },
      ],
      [
        { start: 3, end: 4 },
        { start: 2, end: 3 },
        { start: 3, end: 4 },
      ],
    ]);
  });

  it('每一层只有区间 2-3 与 3-4 各计 1（some），其余区间均为 none', () => {
    expect(r.matrix.length).toBe(3);
    for (const layer of r.matrix) {
      for (const cell of layer.intervals) {
        const used =
          (cell.start === 2 && cell.end === 3) ||
          (cell.start === 3 && cell.end === 4);
        if (used) {
          expect(cell.pathCount).toBe(1n);
          expect(cell.presence).toBe('some');
        } else {
          expect(cell.pathCount).toBe(0n);
          expect(cell.presence).toBe('none');
        }
      }
    }
  });
});

describe('需求场景 [3,-1,-4,2]：多条最短前缀汇入相同步骤', () => {
  const r = solve(tokensOf([3, -1, -4, 2]));

  it('距离 3、方案总数 2，规范轨迹依次 1-2 / 3-4 / 2-3', () => {
    expect(r.distance).toBe(3);
    expect(r.totalPaths).toBe(2n);
    expect(r.canonical.steps).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 2, end: 3 },
    ]);
  });

  it('完整方案集合还包含同长替代轨迹 3-4 / 1-2 / 2-3', () => {
    expect(allShortestPaths([3, -1, -4, 2])).toEqual([
      [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
        { start: 2, end: 3 },
      ],
      [
        { start: 3, end: 4 },
        { start: 1, end: 2 },
        { start: 2, end: 3 },
      ],
    ]);
  });

  it('第三层区间 2-3 计数为 2 且标 all；前两层 1-2 与 3-4 各计 1 标 some', () => {
    expect(r.matrix.length).toBe(3);
    for (const d of [0, 1]) {
      for (const cell of r.matrix[d].intervals) {
        const used =
          (cell.start === 1 && cell.end === 2) ||
          (cell.start === 3 && cell.end === 4);
        expect(cell.pathCount).toBe(used ? 1n : 0n);
        expect(cell.presence).toBe(used ? 'some' : 'none');
      }
    }
    for (const cell of r.matrix[2].intervals) {
      if (cell.start === 2 && cell.end === 3) {
        expect(cell.pathCount).toBe(2n);
        expect(cell.presence).toBe('all');
      } else {
        expect(cell.pathCount).toBe(0n);
        expect(cell.presence).toBe('none');
      }
    }
  });
});

describe('需求场景 [2,1,3,6,4,7,5]（七标记）', () => {
  it(
    '距离 8、最短方案总数 120174，矩阵每行计数之和均等于总数',
    { timeout: 60000 },
    () => {
      const r = solve(tokensOf([2, 1, 3, 6, 4, 7, 5]));
      expect(r.distance).toBe(8);
      expect(r.totalPaths).toBe(120174n);
      expect(r.matrix.length).toBe(8);
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.intervals) sum += cell.pathCount;
        expect(sum).toBe(r.totalPaths);
      }
      // 规范轨迹本身必须可执行并到达全正顺序
      let cur = tokensOf([2, 1, 3, 6, 4, 7, 5]);
      for (const s of r.canonical.steps) {
        cur = applyInversion(cur, s.start - 1, s.end - 1);
      }
      expect(signedOf(cur)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    },
  );
});

describe('校验：合并反馈且拒绝非法排列', () => {
  it('重复绝对值被拒绝', () => {
    const r = validatePermutation('1 1 3');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('重复绝对值（符号不同）被拒绝', () => {
    const r = validatePermutation('[1, -1, 2]');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('缺少某个绝对值（未恰好覆盖 1..n）被拒绝', () => {
    expect(validatePermutation('1 2 2').tokens).toBeUndefined();
    expect(validatePermutation('1 2 4').tokens).toBeUndefined();
  });

  it('数量越界、0、非整数与越界值合并为一次反馈', () => {
    const r = validatePermutation('1, 0, x, 9');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('合法排列通过校验并接受常见分隔符', () => {
    expect(validatePermutation('1 -2 3').tokens).toBeDefined();
    expect(validatePermutation('[1, -2, 3]').tokens).toBeDefined();
    expect(validatePermutation('1;-2;3').tokens).toBeDefined();
  });
});

describe('与暴力枚举交叉验证（n=3 全部排列，n=4 部分排列）', () => {
  const cases: number[][] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  for (const order of perms([1, 2, 3, 4]).slice(0, 24)) {
    cases.push(order.map((v) => (v % 2 === 0 ? -v : v)));
  }

  for (const c of cases) {
    it(`case ${JSON.stringify(c)}`, () => {
      const r = solve(tokensOf(c));
      const b = bruteForce(c);
      expect(r.distance).toBe(b.distance);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.canonical.steps).toEqual(b.lexicographicMin);

      // 规范路径本身必须可行且到达全正顺序
      let cur = tokensOf(c);
      for (const s of r.canonical.steps) {
        cur = applyInversion(cur, s.start - 1, s.end - 1);
      }
      expect(signedOf(cur)).toEqual(Array.from({ length: c.length }, (_, k) => k + 1));

      // 矩阵不变量：每层各区间出现方案数之和恰为总方案数
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.intervals) sum += cell.pathCount;
        expect(sum).toBe(r.totalPaths);
      }
    });
  }
});

describe('深度×区间矩阵', () => {
  it('未使用区间标 none，全部方案共用标 all，并给出精确出现数', () => {
    // [-1,2,3] 只有一条最短路径：单点翻转位置 1
    const r = solve(tokensOf([-1, 2, 3]));
    expect(r.distance).toBe(1);
    const layer = r.matrix[0];
    for (const cell of layer.intervals) {
      if (cell.start === 1 && cell.end === 1) {
        expect(cell.presence).toBe('all');
        expect(cell.pathCount).toBe(1n);
      } else {
        expect(cell.presence).toBe('none');
        expect(cell.pathCount).toBe(0n);
      }
    }
  });

  it('存在多种选择时标注 some 且计数精确', () => {
    // [-1,-2,-3]：三个单点倒位各需 3 步（顺序无关 => 6 条），也有更短路径。
    // 这里直接验证：some 格子计数严格介于 0 与总数之间，且层级计数自洽。
    const r = solve(tokensOf([-1, -2, -3]));
    expect(r.distance).toBeGreaterThan(0);
    for (const layer of r.matrix) {
      for (const cell of layer.intervals) {
        if (cell.presence === 'some') {
          expect(cell.pathCount > 0n).toBe(true);
          expect(cell.pathCount < r.totalPaths).toBe(true);
        }
      }
    }
  });
});

describe('边界与展示', () => {
  it('已是全正顺序时距离 0、方案 1、矩阵为空', () => {
    const r = solve(tokensOf([1, 2, 3]));
    expect(r.distance).toBe(0);
    expect(r.totalPaths).toBe(1n);
    expect(r.matrix).toEqual([]);
    expect(r.canonical.steps).toEqual([]);
  });

  it('n=7 可求解且大数以千分位完整输出', () => {
    const r = solve(tokensOf([-7, -6, -5, -4, -3, -2, -1]));
    expect(r.distance).toBeGreaterThan(0);
    expect(r.totalPaths > 0n).toBe(true);
    expect(formatBigIntDecimal(r.totalPaths)).toMatch(/^\d{1,3}(,\d{3})*$/);
    // 往返一致：去掉千分位仍是同一个整数
    expect(BigInt(formatBigIntDecimal(r.totalPaths).replace(/,/g, ''))).toBe(
      r.totalPaths,
    );
  });
});
