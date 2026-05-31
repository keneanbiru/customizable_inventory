import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { AppError } from "../lib/AppError.js";

const overviewRouter = Router();
overviewRouter.use(requireAuth);

const periodSchema = z.enum(["1d", "7d", "1m", "3m", "6m", "1y", "3y", "5y"]);
type Period = z.infer<typeof periodSchema>;

const querySchema = z.object({
  period: periodSchema.optional().default("1m"),
  // Optional custom range (ISO strings). When provided, prev range length matches (end - start).
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  // Controls whether to compute/integrate "in" series in chart.
  chart_types: z.enum(["out", "in", "both"]).optional().default("both"),
});

function bucketForPeriod(period: Period): "hour" | "day" | "week" | "month" {
  switch (period) {
    case "1d":
      return "hour";
    case "7d":
      return "day";
    case "1m":
    case "3m":
      return "week";
    case "6m":
    case "1y":
    case "3y":
    case "5y":
      return "month";
    default: {
      const _exhaustive: never = period;
      return _exhaustive;
    }
  }
}

function clampPct(deltaPct: number): number {
  if (!Number.isFinite(deltaPct)) return 0;
  // Keep within reasonable bounds for UI.
  return Math.max(-999, Math.min(999, deltaPct));
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

type OverviewKpi = {
  title: string;
  value: string;
  deltaPct: number;
  deltaText: string;
  positive: boolean;
  spark: number[];
};

type OverviewSeries = {
  name: string;
  values: number[];
  color: "blue" | "orange";
};

type OverviewResponse = {
  kpis: OverviewKpi[];
  chart: {
    labels: string[];
    series: OverviewSeries[];
  };
};

overviewRouter.get("/overview", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const pool = getPool();

    const chartTypes = q.chart_types ?? "both";
    let start: Date;
    let end: Date;
    let prevStart: Date;
    let prevEnd: Date;
    let period: Period = q.period;

    if (q.start && q.end) {
      start = new Date(q.start);
      end = new Date(q.end);
      if (!(end.getTime() > start.getTime())) {
        throw new AppError("Invalid date range", 400);
      }
      const len = end.getTime() - start.getTime();
      prevEnd = start;
      prevStart = new Date(prevEnd.getTime() - len);
    } else {
      period = q.period;
      const now = new Date();
      // JS-side duration for deltas/sparks; for SQL we pass as timestamps anyway.
      // month/year are approximations, but this is fine for UI comparison windows.
      const approxMs: Record<Period, number> = {
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "1m": 30 * 24 * 60 * 60 * 1000,
        "3m": 90 * 24 * 60 * 60 * 1000,
        "6m": 180 * 24 * 60 * 60 * 1000,
        "1y": 365 * 24 * 60 * 60 * 1000,
        "3y": 3 * 365 * 24 * 60 * 60 * 1000,
        "5y": 5 * 365 * 24 * 60 * 60 * 1000,
      };
      const ms = approxMs[period];
      end = now;
      start = new Date(now.getTime() - ms);
      prevEnd = start;
      prevStart = new Date(prevEnd.getTime() - ms);
    }

    const bucketUnit = bucketForPeriod(period);

    // Chart + spark values (last period).
    const chartRows = await pool.query<{
      bucket: Date;
      out_qty: string;
      out_txn_count: string;
      in_qty: string;
      total_txn_count: string;
      out_value: string;
      out_cost: string;
    }>(
      `
      SELECT
        date_trunc($1::text, t.created_at) AS bucket,
        SUM(CASE WHEN t.transaction_type = 'out' THEN t.quantity ELSE 0 END)::text AS out_qty,
        COUNT(CASE WHEN t.transaction_type = 'out' THEN 1 END)::text AS out_txn_count,
        SUM(CASE WHEN t.transaction_type = 'in' THEN t.quantity ELSE 0 END)::text AS in_qty,
        COUNT(*)::text AS total_txn_count,
        SUM(
          CASE
            WHEN t.transaction_type = 'out' THEN t.quantity * COALESCE(p.selling_price, p.cost_price, 0)
            ELSE 0
          END
        )::text AS out_value,
        SUM(
          CASE
            WHEN t.transaction_type = 'out' THEN t.quantity * COALESCE(p.cost_price, 0)
            ELSE 0
          END
        )::text AS out_cost
      FROM inventory_transactions t
      JOIN products p ON p.id = t.product_id
      WHERE t.created_at >= $2::timestamptz
        AND t.created_at < $3::timestamptz
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [bucketUnit, start.toISOString(), end.toISOString()]
    );

    const chartRowsData = chartRows.rows;
    const bucketLabels: string[] = chartRowsData.map((r) => r.bucket.toISOString().slice(0, 10));
    const outQtyArr = chartRowsData.map((r) => Number(r.out_qty));
    const outTxnCountArr = chartRowsData.map((r) => Number(r.out_txn_count));
    const inQtyArrRaw = chartRowsData.map((r) => Number(r.in_qty));
    const inQtyArr = chartTypes === "out" ? inQtyArrRaw.map(() => 0) : inQtyArrRaw;
    const totalTxnCountArr = chartRowsData.map((r) => Number(r.total_txn_count));
    const outValueArr = chartRowsData.map((r) => Number(r.out_value));
    const outCostArr = chartRowsData.map((r) => Number(r.out_cost));
    const profitArr = outValueArr.map((v, idx) => v - outCostArr[idx]);
    const marginPctArr = outValueArr.map((v, idx) => {
      const profit = profitArr[idx];
      if (v <= 0) return 0;
      return (profit / v) * 100;
    });
    const avgOutQtyArr = outQtyArr.map((qty, idx) => {
      const c = outTxnCountArr[idx];
      return c > 0 ? qty / c : 0;
    });

    function fmtMoney(n: number): string {
      if (!Number.isFinite(n)) return "$0";
      const abs = Math.abs(n);
      if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
      if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
      return `$${n.toFixed(0)}`;
    }

    function fmtPct(n: number): string {
      if (!Number.isFinite(n)) return "0%";
      return `${n.toFixed(2)}%`;
    }

    // Metrics for deltas.
    const metricsQuery = async (a: Date, b: Date) => {
      const r = await pool.query<{
        total_txn_count: string;
        avg_out_qty: string;
        out_qty: string;
        in_qty: string;
        out_value: string;
        out_cost: string;
      }>(
        `
        SELECT
          COUNT(*)::text AS total_txn_count,
          COALESCE(AVG(CASE WHEN t.transaction_type='out' THEN t.quantity END), 0)::text AS avg_out_qty,
          SUM(CASE WHEN t.transaction_type='out' THEN t.quantity ELSE 0 END)::text AS out_qty,
          SUM(CASE WHEN t.transaction_type='in' THEN t.quantity ELSE 0 END)::text AS in_qty,
          SUM(CASE WHEN t.transaction_type='out' THEN t.quantity * COALESCE(p.selling_price, p.cost_price, 0) ELSE 0 END)::text AS out_value,
          SUM(CASE WHEN t.transaction_type='out' THEN t.quantity * COALESCE(p.cost_price, 0) ELSE 0 END)::text AS out_cost
        FROM inventory_transactions t
        JOIN products p ON p.id = t.product_id
        WHERE t.created_at >= $1::timestamptz
          AND t.created_at < $2::timestamptz
        `,
        [a.toISOString(), b.toISOString()]
      );
      const row = r.rows[0];
      return {
        totalTxn: Number(row.total_txn_count),
        avgOutQty: Number(row.avg_out_qty),
        outQty: Number(row.out_qty),
        inQty: Number(row.in_qty),
        outValue: Number(row.out_value),
        outCost: Number(row.out_cost),
      };
    };

    const last = await metricsQuery(start, end);
    const prev = await metricsQuery(prevStart, prevEnd);

    const lastProfit = last.outValue - last.outCost;
    const prevProfit = prev.outValue - prev.outCost;
    const lastMargin = last.outValue > 0 ? (lastProfit / last.outValue) * 100 : 0;
    const prevMargin = prev.outValue > 0 ? (prevProfit / prev.outValue) * 100 : 0;

    const kpis: OverviewKpi[] = [
      {
        title: "Average Order Volume",
        value: `${last.avgOutQty.toFixed(2)}`,
        deltaPct: clampPct(pctChange(last.avgOutQty, prev.avgOutQty)),
        deltaText: `(${clampPct(pctChange(last.avgOutQty, prev.avgOutQty)).toFixed(0)}% vs prev)`,
        positive: pctChange(last.avgOutQty, prev.avgOutQty) >= 0,
        spark: avgOutQtyArr,
      },
      {
        title: "Transaction Count (Orders)",
        value: `${Math.round(last.totalTxn)}`,
        deltaPct: clampPct(pctChange(last.totalTxn, prev.totalTxn)),
        deltaText: `(${clampPct(pctChange(last.totalTxn, prev.totalTxn)).toFixed(0)}% vs prev)`,
        positive: pctChange(last.totalTxn, prev.totalTxn) >= 0,
        spark: totalTxnCountArr,
      },
      {
        title: "Products Sold",
        value: `${Math.round(last.outQty)}`,
        deltaPct: clampPct(pctChange(last.outQty, prev.outQty)),
        deltaText: `(${clampPct(pctChange(last.outQty, prev.outQty)).toFixed(0)}% vs prev)`,
        positive: pctChange(last.outQty, prev.outQty) >= 0,
        spark: outQtyArr,
      },
      {
        title: "Gross Profit Margin",
        value: fmtPct(lastMargin),
        deltaPct: clampPct(pctChange(lastMargin, prevMargin)),
        deltaText: `(${clampPct(pctChange(lastMargin, prevMargin)).toFixed(0)}% vs prev)`,
        positive: pctChange(lastMargin, prevMargin) >= 0,
        spark: marginPctArr,
      },
      {
        title: "Gross Profit",
        value: fmtMoney(lastProfit),
        deltaPct: clampPct(pctChange(lastProfit, prevProfit)),
        deltaText: `(${clampPct(pctChange(lastProfit, prevProfit)).toFixed(0)}% vs prev)`,
        positive: pctChange(lastProfit, prevProfit) >= 0,
        spark: profitArr,
      },
      {
        title: "Total Net Revenue",
        value: fmtMoney(last.outValue),
        deltaPct: clampPct(pctChange(last.outValue, prev.outValue)),
        deltaText: `(${clampPct(pctChange(last.outValue, prev.outValue)).toFixed(0)}% vs prev)`,
        positive: pctChange(last.outValue, prev.outValue) >= 0,
        spark: outValueArr,
      },
    ];

    const chart: OverviewResponse["chart"] = {
      labels: bucketLabels,
      series: [
        {
          name: "Gross Sales Revenue",
          values: outValueArr,
          color: "blue",
        },
        {
          name: "Inventory Moved",
          values: inQtyArr,
          color: "orange",
        },
      ],
    };

    const response: OverviewResponse = { kpis, chart };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

export { overviewRouter };

