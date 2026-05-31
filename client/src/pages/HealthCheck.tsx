import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet } from "../api/client";

type OverviewKpi = {
  title: string;
  value: string;
  deltaPct: number;
  deltaText: string;
  positive: boolean;
  spark: number[];
};

type OverviewResponse = {
  kpis: OverviewKpi[];
  chart: {
    labels: string[];
    series: Array<{
      name: string;
      values: number[];
      color: "blue" | "orange";
    }>;
  };
};

export function HealthCheck() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  type OverviewQueryPeriod = "1d" | "7d" | "1m" | "3m" | "6m" | "1y" | "3y" | "5y";
  const periodOptions: Array<OverviewQueryPeriod> = ["1d", "7d", "1m", "3m", "6m", "1y", "3y", "5y"];
  const [period, setPeriod] = useState<OverviewQueryPeriod>("1m");
  const [chartType, setChartType] = useState<"out" | "in" | "both">("both");
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);
  const [showDatesPanel, setShowDatesPanel] = useState(false);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [selectedMetricTitles, setSelectedMetricTitles] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [appliedStartIso, setAppliedStartIso] = useState<string | null>(null);
  const [appliedEndIso, setAppliedEndIso] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    qs.set("period", period);
    qs.set("chart_types", chartType);
    if (appliedStartIso && appliedEndIso) {
      qs.set("start", appliedStartIso);
      qs.set("end", appliedEndIso);
    }
    apiGet<OverviewResponse>(`/api/v1/overview?${qs.toString()}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to load overview");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [period, chartType, appliedStartIso, appliedEndIso]);

  useEffect(() => {
    if (!data?.kpis?.length) return;
    if (selectedMetricTitles.length) return;
    setSelectedMetricTitles(data.kpis.map((k) => k.title));
  }, [data, selectedMetricTitles.length]);

  const chart = data?.chart;
  const maxChartValue = useMemo(() => {
    if (!chart) return 1;
    const all = chart.series.flatMap((s) => s.values);
    const max = Math.max(0, ...all);
    return max > 0 ? max : 1;
  }, [chart]);

  function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
    const w = 74;
    const h = 26;
    if (!values.length) return <svg className="overview__spark-svg" width={w} height={h} />;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = w / Math.max(1, values.length - 1);
    const points = values
      .map((v, idx) => {
        const x = idx * step;
        const y = h - ((v - min) / span) * (h - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const stroke = positive ? "#10b981" : "#ef4444";
    return (
      <svg className="overview__spark-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  const visibleKpis =
    data?.kpis.filter((k) => selectedMetricTitles.includes(k.title)) ?? [];

  return (
    <section className="overview">
      <div className="overview__toolbar">
        <div className="overview__periods">
          {periodOptions.map((item) => (
            <button
              key={item}
              type="button"
              className={`overview__chip${item === period ? " active" : ""}`}
              onClick={() => setPeriod(item)}
            >
              {item.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="overview__actions">
          <button
            type="button"
            className="overview__action-btn"
            onClick={() => {
              setShowMetricsPanel((v) => !v);
              setShowDatesPanel(false);
              setShowFiltersPanel(false);
            }}
          >
            + Add Metrics
          </button>
          <button
            type="button"
            className="overview__action-btn"
            onClick={() => {
              setShowDatesPanel((v) => !v);
              setShowMetricsPanel(false);
              setShowFiltersPanel(false);
            }}
          >
            Select dates
          </button>
          <button
            type="button"
            className="overview__action-btn"
            onClick={() => {
              setShowFiltersPanel((v) => !v);
              setShowMetricsPanel(false);
              setShowDatesPanel(false);
            }}
          >
            Filters
          </button>
        </div>
      </div>

      {showMetricsPanel && (
        <section className="panel overview__control-panel">
          <h3>Choose Metrics</h3>
          <div className="overview__check-grid">
            {(data?.kpis ?? []).map((kpi) => (
              <label key={kpi.title} className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedMetricTitles.includes(kpi.title)}
                  onChange={(e) => {
                    setSelectedMetricTitles((prev) => {
                      if (e.target.checked) return [...prev, kpi.title];
                      if (prev.length <= 1) return prev;
                      return prev.filter((t) => t !== kpi.title);
                    });
                  }}
                />
                {kpi.title}
              </label>
            ))}
          </div>
        </section>
      )}

      {showDatesPanel && (
        <section className="panel overview__control-panel">
          <h3>Select Date Range</h3>
          <div className="overview__date-row">
            <label className="field">
              <span>From</span>
              <input type="datetime-local" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="datetime-local" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </label>
            <div className="users-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!rangeStart || !rangeEnd) return;
                  setAppliedStartIso(new Date(rangeStart).toISOString());
                  setAppliedEndIso(new Date(rangeEnd).toISOString());
                  setShowDatesPanel(false);
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setRangeStart("");
                  setRangeEnd("");
                  setAppliedStartIso(null);
                  setAppliedEndIso(null);
                  setShowDatesPanel(false);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </section>
      )}

      {showFiltersPanel && (
        <section className="panel overview__control-panel">
          <h3>Chart Filters</h3>
          <div className="overview__check-grid">
            <label className="checkbox">
              <input
                type="radio"
                name="chartType"
                checked={chartType === "both"}
                onChange={() => setChartType("both")}
              />
              Show both series
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="chartType"
                checked={chartType === "out"}
                onChange={() => setChartType("out")}
              />
              Gross Sales Revenue only
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="chartType"
                checked={chartType === "in"}
                onChange={() => setChartType("in")}
              />
              Inventory Moved only
            </label>
          </div>
        </section>
      )}

      <div className="overview__kpis">
        {visibleKpis.map((kpi) => (
          <article key={kpi.title} className="panel overview__kpi-card">
            <p className="overview__kpi-title">{kpi.title}</p>
            <p className="overview__kpi-value">{kpi.value}</p>
            <p className={`overview__kpi-delta ${kpi.positive ? "positive" : "negative"}`}>
              {kpi.positive ? "↑" : "↓"} {kpi.deltaText.replace(/[()]/g, "")}
            </p>
            <div className="overview__spark">
              <Sparkline values={kpi.spark} positive={kpi.positive} />
            </div>
          </article>
        ))}
        {!data && !error && (
          <>
            {Array.from({ length: 6 }).map((_, idx) => (
              <article key={idx} className="panel overview__kpi-card">
                <p className="overview__kpi-title">Loading…</p>
              </article>
            ))}
          </>
        )}
      </div>

      <section className="panel overview__chart-panel">
        <div className="overview__chart-head">
          <h2>Monthly Sales Vs Inventory Analysis</h2>
          <span className="text-muted">^</span>
        </div>
        <div className="overview__legend">
          {(chartType === "both" || chartType === "out") && <span><i className="dot blue" /> Gross Sales Revenue</span>}
          {(chartType === "both" || chartType === "in") && <span><i className="dot orange" /> Inventory Moved</span>}
        </div>
        <div
          className="overview__bars"
          style={{
            gridTemplateColumns: `repeat(${chart?.labels?.length ?? 14}, minmax(0, 1fr))`,
          }}
        >
          {chart?.labels?.map((_, idx) => {
            const outIdx = chart.series.find((s) => s.color === "blue")?.values[idx] ?? 0;
            const inIdx = chart.series.find((s) => s.color === "orange")?.values[idx] ?? 0;
            const outPct = (outIdx / maxChartValue) * 100;
            const inPct = (inIdx / maxChartValue) * 100;
            return (
              <div key={idx} className="overview__bar-col">
                <div className="overview__bar-stack">
                  <span
                    className="overview__bar-seg overview__bar-seg--blue"
                    style={{ height: `${outPct}%` }}
                  />
                  <span
                    className="overview__bar-seg overview__bar-seg--orange"
                    style={{ height: `${inPct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!chart && !error && (
            <>
              {Array.from({ length: 14 }).map((_, idx) => (
                <div key={idx} className="overview__bar-col" />
              ))}
            </>
          )}
        </div>
      </section>

      {error && <p className="text-error">{error}</p>}
      {!data && !error && (
        <p className="text-muted overview__health-note">Loading dashboard data…</p>
      )}
    </section>
  );
}
