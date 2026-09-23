import { useCallback, useRef, useState } from 'react';
import {
  formatBigIntDecimal,
  tokenToSigned,
  validatePermutation,
  type Token,
} from './lib/permutation';
import {
  fromDTO,
  solve,
  toDTO,
  type AuditResult,
  type AuditResultDTO,
  type IntervalCell,
} from './lib/solver';
import type { AuditRequest } from './audit.worker';

const EXAMPLES = [
  '1,-3,-2,4',
  '-1,-2,-3',
  '3,2,1',
  '-7,6,-5,4,-3,2,-1',
];

interface SelectedCell {
  depth: number;
  start: number;
  end: number;
}

export function App() {
  const [input, setInput] = useState('1,-3,-2,4');
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [computing, setComputing] = useState(false);
  // 当前查看的深度（0 表示尚未执行任何倒位）。
  const [activeDepth, setActiveDepth] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const runAudit = useCallback(() => {
    const { tokens, errors: validationErrors } = validatePermutation(input);
    // 无论合法与否，输入文本都原样保留；错误合并为一次反馈。
    setErrors(validationErrors);
    if (!tokens) {
      setResult(null);
      return;
    }

    setComputing(true);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);

    const finish = (dto: AuditResultDTO) => {
      setResult(fromDTO(dto));
      setComputing(false);
    };

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('./audit.worker.ts', import.meta.url),
          { type: 'module' },
        );
      }
      const worker = workerRef.current;
      worker.onmessage = (event: MessageEvent<AuditResultDTO>) =>
        finish(event.data);
      const message: AuditRequest = { tokens };
      worker.postMessage(message);
    } catch {
      // Worker 不可用时退回主线程求解（功能不降级，仅可能短暂阻塞）。
      finish(toDTO(solve(tokens)));
    }
  }, [input]);

  return (
    <main className="page">
      <header className="header">
        <h1>带符号标记排列 · 规范倒位审计</h1>
        <p className="subtitle">
          浏览器内对全部最短方案做精确枚举：最少步数、任意精度方案总数、
          按每步 <code>[起,止]</code> 下标对字典序选出的规范方案，
          以及逐深度区间出现矩阵。所有计算均在本机完成，无后端、无网络请求。
        </p>
      </header>

      <section className="card" aria-label="排列输入">
        <label className="field-label" htmlFor="perm-input">
          带符号排列（3 至 7 个标记，绝对值须恰好为 1 至 n 且互异）
        </label>
        <textarea
          id="perm-input"
          className="perm-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder="例如：1,-3,-2,4"
        />
        <div className="examples">
          <span className="muted">示例：</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => setInput(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={runAudit}
            disabled={computing}
          >
            {computing ? '审计进行中…' : '启动审计'}
          </button>
          {computing && <span className="muted">n=7 最坏情况约需数秒</span>}
        </div>
        {errors.length > 0 && (
          <div className="alert" role="alert">
            <strong>输入不合法，请一并修正：</strong>
            <ul>
              {errors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {result && <ResultView result={result} activeDepth={activeDepth} setActiveDepth={setActiveDepth} selected={selected} setSelected={setSelected} />}

      <footer className="footer muted">
        倒位语义：选取闭区间 [i,j]，反转区间内标记次序并同时翻转每个符号。
      </footer>
    </main>
  );
}

function ResultView({
  result,
  activeDepth,
  setActiveDepth,
  selected,
  setSelected,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
  setSelected: (s: SelectedCell | null) => void;
}) {
  const { distance, totalPaths, canonical, matrix } = result;

  const currentStep =
    activeDepth < distance ? canonical.steps[activeDepth] : null;

  const jumpToDepth = useCallback(
    (cell: IntervalCell, depth: number) => {
      setActiveDepth(depth);
      setSelected({ depth, start: cell.start, end: cell.end });
    },
    [setActiveDepth, setSelected],
  );

  return (
    <>
      <section className="card summary" aria-label="审计结论">
        <div className="stat">
          <div className="stat-value">{distance}</div>
          <div className="stat-label">最少倒位步数</div>
        </div>
        <div className="stat">
          <div className="stat-value big" title={totalPaths.toString()}>
            {formatBigIntDecimal(totalPaths)}
          </div>
          <div className="stat-label">最短方案总数（精确十进制）</div>
        </div>
        <div className="stat">
          <div className="stat-value">{result.n}</div>
          <div className="stat-label">标记数 n</div>
        </div>
      </section>

      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {distance === 0
            ? '输入已是全正顺序，无需倒位。'
            : '在全部最短方案中，按每步 (起, 止) 下标对序列的字典序选出。可单步查看：'}
        </p>

        {distance > 0 && (
          <Trajectory
            result={result}
            activeDepth={activeDepth}
            setActiveDepth={(d) => {
              // 手动浏览深度时清除矩阵选中，避免高亮仍指向旧深度。
              setSelected(null);
              setActiveDepth(d);
            }}
          />
        )}

        {currentStep && (
          <p className="step-hint">
            第 {activeDepth + 1} 步：对闭区间{' '}
            <strong>
              [{currentStep.start}, {currentStep.end}]
            </strong>{' '}
            执行倒位（反转次序并翻转符号）。
          </p>
        )}
      </section>

      {distance > 0 && (
        <section className="card" aria-label="深度区间矩阵">
          <h2>深度 × 区间出现矩阵</h2>
          <Legend selected={selected} canonicalAtDepth={selected ? canonical.steps[selected.depth] ?? null : null} />
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">深度 ＼ 区间</th>
                  {matrix[0].intervals.map((cell) => (
                    <th key={`${cell.start}-${cell.end}`}>
                      {cell.start}-{cell.end}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((layer) => {
                  const canon = canonical.steps[layer.depth];
                  return (
                    <tr key={layer.depth}>
                      <th scope="row" className="rowhead">
                        第 {layer.depth + 1} 步
                      </th>
                      {layer.intervals.map((cell) => {
                        const isCanonical =
                          canon.start === cell.start && canon.end === cell.end;
                        const isSelected =
                          selected?.depth === layer.depth &&
                          selected.start === cell.start &&
                          selected.end === cell.end;
                        const dimmed =
                          selected !== null && !isSelected && !isCanonical;
                        return (
                          <td key={`${cell.start}-${cell.end}`}>
                            <button
                              type="button"
                              className={[
                                'cell',
                                `cell-${cell.presence}`,
                                isCanonical ? 'cell-canonical' : '',
                                isSelected ? 'cell-selected' : '',
                                dimmed ? 'cell-dimmed' : '',
                              ].join(' ')}
                              onClick={() => jumpToDepth(cell, layer.depth)}
                              title={cellTitle(cell)}
                            >
                              <span className="cell-count">
                                {formatBigIntDecimal(cell.pathCount)}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            每格数字为：在该深度选择该区间的最短方案数量（bigint 精确计数）；
            每行之和等于方案总数。加粗描边格为规范方案在该深度的选择；
            点击任意格，轨迹视图联动跳转到对应深度。
          </p>
        </section>
      )}
    </>
  );
}

function cellTitle(cell: IntervalCell): string {
  const scope =
    cell.presence === 'all'
      ? '全部最短方案'
      : cell.presence === 'some'
        ? '部分最短方案'
        : '任何最短方案中均未出现';
  return `区间 [${cell.start}, ${cell.end}]：${scope}，出现于 ${cell.pathCount} 个最短方案`;
}

function Legend({
  selected,
  canonicalAtDepth,
}: {
  selected: SelectedCell | null;
  canonicalAtDepth: { start: number; end: number } | null;
}) {
  return (
    <div className="legend">
      <span className="legend-item">
        <i className="swatch swatch-all" /> 全部方案均出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-some" /> 仅部分方案出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-none" /> 任何最短方案均未出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-canonical" /> 规范方案选择
      </span>
      {selected && (
        <span className="legend-note" role="status">
          已选第 {selected.depth + 1} 步区间 [{selected.start}, {selected.end}]
          {canonicalAtDepth &&
          canonicalAtDepth.start === selected.start &&
          canonicalAtDepth.end === selected.end
            ? '，正是规范轨迹上的倒位。'
            : '，该倒位不在规范轨迹上（规范选择见描边格）。'}
        </span>
      )}
    </div>
  );
}

function Trajectory({
  result,
  activeDepth,
  setActiveDepth,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
}) {
  const { canonical, distance } = result;
  const states = canonical.states;
  const current = states[activeDepth];
  const next = activeDepth < distance ? states[activeDepth + 1] : null;
  const step = activeDepth < distance ? canonical.steps[activeDepth] : null;

  const positions = new Set<number>();
  if (step) {
    // 当前态中哪些位置落在本步倒位区间内（倒位后位置不变，仅次序与符号变）
    for (let k = step.start - 1; k <= step.end - 1; k += 1) positions.add(k);
  }

  return (
    <div>
      <div className="stepper">
        <button
          type="button"
          onClick={() => setActiveDepth(Math.max(0, activeDepth - 1))}
          disabled={activeDepth === 0}
        >
          ← 上一步
        </button>
        <span className="stepper-pos">
          深度 {activeDepth} / {distance}
        </span>
        <button
          type="button"
          onClick={() => setActiveDepth(Math.min(distance, activeDepth + 1))}
          disabled={activeDepth === distance}
        >
          下一步 →
        </button>
      </div>

      <div className="states">
        <StateRow tokens={current} marks={positions} caption={`深度 ${activeDepth}（执行前）`} />
        {step && (
          <div className="arrow" aria-hidden="true">
            → [{step.start},{step.end}]
          </div>
        )}
        {next && (
          <StateRow tokens={next} marks={positions} caption={`深度 ${activeDepth + 1}（执行后）`} muted />
        )}
      </div>

      <input
        className="scrub"
        type="range"
        min={0}
        max={distance}
        value={activeDepth}
        onChange={(e) => setActiveDepth(Number(e.target.value))}
        aria-label="选择查看的深度"
      />
    </div>
  );
}

function StateRow({
  tokens,
  marks,
  caption,
  muted = false,
}: {
  tokens: Token[];
  marks: Set<number>;
  caption: string;
  muted?: boolean;
}) {
  return (
    <div className={`state-row ${muted ? 'state-next' : ''}`}>
      <div className="state-caption muted">{caption}</div>
      <div className="markers">
        {tokens.map((t, idx) => {
          const value = tokenToSigned(t);
          return (
            <span
              key={idx}
              className={[
                'marker',
                value < 0 ? 'marker-neg' : 'marker-pos',
                marks.has(idx) ? 'marker-hit' : '',
              ].join(' ')}
            >
              {value > 0 ? `+${value}` : value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
