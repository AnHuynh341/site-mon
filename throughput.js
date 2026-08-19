/* ============================================================
   W41IT VIDEO THROUGHPUT OVERLAY

   The normal five-minute video probes measure short-range latency.
   This companion dataset comes from one larger hourly range fetch so
   a fast TTFB cannot hide a painfully slow sustained transfer.
============================================================ */

const VIDEO_THROUGHPUT_URL =
  "https://pub-f93da3b792414f4f956efd99de4dcc0a.r2.dev/site-monitor/live/video-throughput.json";

const VIDEO_THROUGHPUT_REFRESH_MS = 60_000;


function throughputCssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}


function installThroughputUi() {
  const panel =
    document.querySelector(
      ".video-fetch-panel"
    );

  if (!panel) {
    return;
  }

  const heading =
    panel.querySelector("h2");

  if (heading) {
    heading.textContent =
      "Latency & sustained throughput — last 24 hours";
  }

  const legend =
    panel.querySelector(
      ".legend"
    );

  if (
    legend &&
    !document.getElementById(
      "video-throughput-legend"
    )
  ) {
    const item =
      document.createElement(
        "span"
      );

    item.id =
      "video-throughput-legend";

    item.innerHTML = `
      <i
        class="legend-dot"
        style="background: var(--green)"
      ></i>
      Throughput
    `;

    legend.appendChild(item);
  }

  const meta =
    panel.querySelector(
      ".delivery-panel-meta"
    );

  if (
    meta &&
    !document.getElementById(
      "video-throughput-now"
    )
  ) {
    const metric =
      document.createElement(
        "div"
      );

    metric.className =
      "big-number delivery-average";

    metric.id =
      "video-throughput-metric";

    metric.innerHTML = `
      <strong id="video-throughput-now">—</strong>
      <span>MiB/s sustained</span>
    `;

    meta.appendChild(metric);
  }
}


function ensureThroughputDataset(chart) {
  if (!chart) {
    return null;
  }

  chart.options.scales.yThroughput = {
    type: "linear",
    position: "right",
    beginAtZero: true,
    border: {
      display: false
    },
    grid: {
      drawOnChartArea: false
    },
    ticks: {
      color: "#b8bfd1",
      font: {
        size: 11,
        weight: "500"
      },
      padding: 6,
      callback(value) {
        return `${value} MiB/s`;
      }
    }
  };

  let dataset =
    chart.data.datasets.find(
      item =>
        item.w41itThroughput === true
    );

  if (!dataset) {
    dataset = {
      label: "Throughput",
      data: [],
      yAxisID: "yThroughput",
      borderColor:
        throughputCssVar(
          "--green"
        ),
      backgroundColor:
        throughputCssVar(
          "--green"
        ),
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      tension: 0.25,
      spanGaps: true,
      w41itThroughput: true
    };

    chart.data.datasets.push(
      dataset
    );
  }

  chart.options.plugins.tooltip.callbacks = {
    label(context) {
      const value =
        context.parsed?.y;

      if (!Number.isFinite(value)) {
        return `${context.dataset.label}: —`;
      }

      if (
        context.dataset.w41itThroughput ===
        true
      ) {
        return (
          `Throughput: ${value.toFixed(2)} MiB/s`
        );
      }

      return (
        `${context.dataset.label}: ${Math.round(value)} ms`
      );
    }
  };

  return dataset;
}


function updateThroughputMetric(latest) {
  const valueElement =
    document.getElementById(
      "video-throughput-now"
    );

  const metric =
    document.getElementById(
      "video-throughput-metric"
    );

  if (!valueElement || !metric) {
    return;
  }

  const mibps =
    Number(latest?.mibps);

  const status =
    String(
      latest?.status ??
      "UNKNOWN"
    ).toUpperCase();

  valueElement.textContent =
    Number.isFinite(mibps)
      ? mibps.toFixed(
          mibps < 1 ? 2 : 1
        )
      : "—";

  let color =
    throughputCssVar(
      "--muted"
    );

  if (status === "GOOD") {
    color = throughputCssVar(
      "--green"
    );
  }
  else if (status === "SLOW") {
    color = throughputCssVar(
      "--yellow"
    );
  }
  else if (status === "UNSTABLE") {
    color = throughputCssVar(
      "--red"
    );
  }

  valueElement.style.color =
    color;

  const mbps =
    Number(latest?.mbps);

  const ttfbMs =
    Number(latest?.ttfbMs);

  const durationMs =
    Number(latest?.durationMs);

  const details = [
    status,
    Number.isFinite(mbps)
      ? `${mbps.toFixed(2)} Mbps`
      : null,
    Number.isFinite(ttfbMs)
      ? `TTFB ${Math.round(ttfbMs)} ms`
      : null,
    Number.isFinite(durationMs)
      ? `sample ${(durationMs / 1000).toFixed(1)} s`
      : null,
    latest?.path || null
  ].filter(Boolean);

  metric.title =
    details.join(" · ");
}


function alignThroughputHistory(
  chart,
  history
) {
  const byLabel =
    new Map();

  for (const item of history) {
    const label =
      item?.label;

    const value =
      Number(item?.mibps);

    if (
      typeof label === "string" &&
      Number.isFinite(value)
    ) {
      byLabel.set(
        label,
        value
      );
    }
  }

  return chart.data.labels.map(
    label =>
      byLabel.has(label)
        ? byLabel.get(label)
        : null
  );
}


async function fetchVideoThroughput() {
  installThroughputUi();

  const chart =
    Chart.getChart(
      "video-fetch-chart"
    );

  if (!chart) {
    return;
  }

  try {
    const response =
      await fetch(
        `${VIDEO_THROUGHPUT_URL}?t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    const history =
      Array.isArray(
        payload?.history
      )
        ? payload.history
        : [];

    const dataset =
      ensureThroughputDataset(
        chart
      );

    if (!dataset) {
      return;
    }

    dataset.data =
      alignThroughputHistory(
        chart,
        history
      );

    updateThroughputMetric(
      payload?.latest ?? {}
    );

    chart.update();
  }
  catch (error) {
    console.error(
      "W41IT video throughput refresh failed:",
      error
    );
  }
}


installThroughputUi();

setTimeout(
  fetchVideoThroughput,
  1500
);

setInterval(
  fetchVideoThroughput,
  VIDEO_THROUGHPUT_REFRESH_MS
);
