/* W41IT audio/video sustained-throughput overlay */

const THROUGHPUT_REFRESH_MS = 5 * 60_000;

const THROUGHPUT_TARGETS = [
  {
    kind: "audio",
    url: "https://pub-f93da3b792414f4f956efd99de4dcc0a.r2.dev/site-monitor/live/audio-throughput.json",
    panel: ".r2-history-panel",
    chart: "r2-chart"
  },
  {
    kind: "video",
    url: "https://pub-f93da3b792414f4f956efd99de4dcc0a.r2.dev/site-monitor/live/video-throughput.json",
    panel: ".video-fetch-panel",
    chart: "video-fetch-chart"
  }
];


function throughputCssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}


function installThroughputUi(target) {
  const panel = document.querySelector(target.panel);

  if (!panel) {
    return;
  }

  const heading = panel.querySelector("h2");

  if (heading) {
    heading.textContent =
      "Latency & sustained throughput — last 24 hours";
  }

  const legend = panel.querySelector(".legend");
  const legendId = `${target.kind}-throughput-legend`;

  if (legend && !document.getElementById(legendId)) {
    const item = document.createElement("span");
    item.id = legendId;
    item.innerHTML = `
      <i class="legend-dot" style="background: var(--green)"></i>
      Throughput
    `;
    legend.appendChild(item);
  }

  const meta = panel.querySelector(".delivery-panel-meta");
  const valueId = `${target.kind}-throughput-now`;

  if (meta && !document.getElementById(valueId)) {
    const metric = document.createElement("div");
    metric.className = "big-number delivery-average";
    metric.id = `${target.kind}-throughput-metric`;
    metric.innerHTML = `
      <strong id="${valueId}">—</strong>
      <span>MiB/s worst sample</span>
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
    border: { display: false },
    grid: { drawOnChartArea: false },
    ticks: {
      color: "#b8bfd1",
      font: { size: 11, weight: "500" },
      padding: 6,
      callback: value => `${value} MiB/s`
    }
  };

  let dataset = chart.data.datasets.find(
    item => item.w41itThroughput === true
  );

  if (!dataset) {
    dataset = {
      label: "Throughput",
      data: [],
      yAxisID: "yThroughput",
      borderColor: throughputCssVar("--green"),
      backgroundColor: throughputCssVar("--green"),
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 6,
      tension: 0.25,
      spanGaps: true,
      w41itThroughput: true
    };
    chart.data.datasets.push(dataset);
  }

  chart.options.plugins.tooltip.callbacks = {
    label(context) {
      const value = context.parsed?.y;

      if (!Number.isFinite(value)) {
        return `${context.dataset.label}: —`;
      }

      if (context.dataset.w41itThroughput === true) {
        return `Throughput: ${value.toFixed(2)} MiB/s`;
      }

      return `${context.dataset.label}: ${Math.round(value)} ms`;
    }
  };

  return dataset;
}


function throughputStatusColor(status) {
  switch (String(status ?? "UNKNOWN").toUpperCase()) {
    case "GOOD":
      return throughputCssVar("--green");
    case "SLOW":
      return throughputCssVar("--yellow");
    case "UNSTABLE":
      return throughputCssVar("--red");
    default:
      return throughputCssVar("--muted");
  }
}


function updateThroughputMetric(target, latest) {
  const valueElement = document.getElementById(
    `${target.kind}-throughput-now`
  );
  const metric = document.getElementById(
    `${target.kind}-throughput-metric`
  );

  if (!valueElement || !metric) {
    return;
  }

  const mibps = Number(latest?.mibps);
  valueElement.textContent = Number.isFinite(mibps)
    ? mibps.toFixed(mibps < 1 ? 2 : 1)
    : "—";
  valueElement.style.color =
    throughputStatusColor(latest?.status);

  const avg = Number(latest?.avgMibps);
  const mbps = Number(latest?.mbps);
  const ttfb = Number(latest?.ttfbMs);
  const duration = Number(latest?.durationMs);
  const count = Number(latest?.sampleCount);

  metric.title = [
    String(latest?.status ?? "UNKNOWN").toUpperCase(),
    Number.isFinite(count) ? `${count} sampled files` : null,
    Number.isFinite(avg) ? `average ${avg.toFixed(2)} MiB/s` : null,
    Number.isFinite(mbps) ? `worst ${mbps.toFixed(2)} Mbps` : null,
    Number.isFinite(ttfb) ? `worst TTFB ${Math.round(ttfb)} ms` : null,
    Number.isFinite(duration)
      ? `slowest sample ${(duration / 1000).toFixed(1)} s`
      : null
  ].filter(Boolean).join(" · ");
}


function alignThroughputHistory(chart, history) {
  const byLabel = new Map();

  for (const item of history) {
    const label = item?.label;
    const value = Number(item?.mibps);

    if (typeof label === "string" && Number.isFinite(value)) {
      byLabel.set(label, value);
    }
  }

  return chart.data.labels.map(
    label => byLabel.has(label) ? byLabel.get(label) : null
  );
}


async function fetchThroughput(target) {
  installThroughputUi(target);

  const chart = Chart.getChart(target.chart);

  if (!chart) {
    return;
  }

  try {
    const response = await fetch(
      `${target.url}?t=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const history = Array.isArray(payload?.history)
      ? payload.history
      : [];
    const dataset = ensureThroughputDataset(chart);

    if (!dataset) {
      return;
    }

    dataset.data = alignThroughputHistory(chart, history);
    updateThroughputMetric(target, payload?.latest ?? {});
    chart.update();
  }
  catch (error) {
    console.error(
      `W41IT ${target.kind} throughput refresh failed:`,
      error
    );
  }
}


function fetchAllThroughput() {
  for (const target of THROUGHPUT_TARGETS) {
    fetchThroughput(target);
  }
}


for (const target of THROUGHPUT_TARGETS) {
  installThroughputUi(target);
}

setTimeout(fetchAllThroughput, 1500);
setInterval(fetchAllThroughput, THROUGHPUT_REFRESH_MS);
