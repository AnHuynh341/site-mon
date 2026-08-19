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
      <span>MiB/s average</span>
    `;
    meta.appendChild(metric);
  }
}


function installSplitTooltipMode() {
  const modes = Chart?.Interaction?.modes;

  if (!modes || modes.w41itDeliverySplit) {
    return;
  }

  modes.w41itDeliverySplit = function(
    chart,
    event,
    options,
    useFinalPosition
  ) {
    // Throughput is intentionally sparse. Only open its tooltip when the
    // pointer is actually over one of the visible green sample points.
    const pointHits = modes.point(
      chart,
      event,
      {
        ...options,
        axis: "xy",
        intersect: true
      },
      useFinalPosition
    ).filter(item =>
      chart.data.datasets[item.datasetIndex]?.w41itThroughput === true
    );

    if (pointHits.length) {
      return [pointHits[0]];
    }

    // Everywhere else preserve the original latency behaviour: one tooltip
    // at the nearest time index containing Average + Worst together.
    return modes.index(
      chart,
      event,
      {
        ...options,
        axis: "x",
        intersect: false
      },
      useFinalPosition
    ).filter(item =>
      chart.data.datasets[item.datasetIndex]?.w41itThroughput !== true
    );
  };
}


function tooltipHasThroughput(context) {
  return Boolean(
    context?.tooltip?.dataPoints?.some(
      item => item.dataset?.w41itThroughput === true
    )
  );
}


function ensureThroughputDataset(chart) {
  if (!chart) {
    return null;
  }

  installSplitTooltipMode();

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
      pointHitRadius: 12,
      tension: 0.25,
      spanGaps: true,
      w41itThroughput: true
    };
    chart.data.datasets.push(dataset);
  }

  // Keep the latency tooltip working exactly as before, but give each green
  // throughput point its own single-series tooltip instead of mixing units.
  chart.options.plugins.tooltip.mode = "w41itDeliverySplit";
  chart.options.plugins.tooltip.intersect = false;
  chart.options.plugins.tooltip.position = "nearest";
  chart.options.plugins.tooltip.borderColor = context =>
    tooltipHasThroughput(context)
      ? throughputCssVar("--green")
      : "rgba(255,255,255,.72)";
  chart.options.plugins.tooltip.callbacks = {
    title(items) {
      const first = items[0];
      const label = first?.label ?? "";

      return first?.dataset?.w41itThroughput === true
        ? `Throughput · ${label}`
        : label;
    },

    label(context) {
      const value = context.parsed?.y;

      if (!Number.isFinite(value)) {
        return `${context.dataset.label}: —`;
      }

      if (context.dataset.w41itThroughput === true) {
        return `Average throughput: ${value.toFixed(2)} MiB/s`;
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


function throughputAverage(item) {
  const average = Number(item?.avgMibps);

  if (Number.isFinite(average)) {
    return average;
  }

  // Backward compatibility for older one-sample history entries.
  const legacy = Number(item?.mibps);
  return Number.isFinite(legacy) ? legacy : null;
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

  const average = throughputAverage(latest);
  valueElement.textContent = Number.isFinite(average)
    ? average.toFixed(average < 1 ? 2 : 1)
    : "—";
  valueElement.style.color =
    throughputStatusColor(latest?.status);

  const count = Number(latest?.sampleCount);

  metric.title = [
    String(latest?.status ?? "UNKNOWN").toUpperCase(),
    Number.isFinite(count) ? `${count} sampled files` : null,
    Number.isFinite(average)
      ? `${average.toFixed(2)} MiB/s average`
      : null
  ].filter(Boolean).join(" · ");
}


function alignThroughputHistory(chart, history) {
  const byLabel = new Map();

  for (const item of history) {
    const label = item?.label;
    const value = throughputAverage(item);

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


async function installRepoBuild() {
  const footerSpans = document.querySelectorAll(".footer > span");

  if (!footerSpans.length) {
    return;
  }

  footerSpans[0].textContent = "W41IT Monitor";

  const buildTarget = footerSpans[footerSpans.length - 1];
  buildTarget.textContent = "Build —";

  try {
    const response = await fetch(
      "https://api.github.com/repos/AnHuynh341/site-mon/commits/main",
      {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const sha = String(payload?.sha ?? "").trim();
    const committedAt =
      payload?.commit?.committer?.date ??
      payload?.commit?.author?.date;

    if (!sha || !committedAt) {
      throw new Error("Missing commit metadata");
    }

    const date = new Date(committedAt);

    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid commit date");
    }

    const formattedDate = new Intl.DateTimeFormat(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh"
      }
    ).format(date);

    buildTarget.textContent =
      `Build ${sha.slice(0, 7)} · ${formattedDate}`;
  }
  catch (error) {
    console.error("W41IT build metadata refresh failed:", error);
  }
}


for (const target of THROUGHPUT_TARGETS) {
  installThroughputUi(target);
}

installRepoBuild();
setTimeout(fetchAllThroughput, 1500);
setInterval(fetchAllThroughput, THROUGHPUT_REFRESH_MS);
