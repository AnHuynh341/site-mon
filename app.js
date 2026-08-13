/* ============================================================
   W41IT MONITOR — REAL DATA FRONTEND
============================================================ */

const DASHBOARD_URL =
  "https://pub-f93da3b792414f4f956efd99de4dcc0a.r2.dev/site-monitor/live/dashboard.json";

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 10 * 60_000;

let visitsChart;
let pageLoadChart;
let r2Chart;
let lastGoodData = null;


/* ============================================================
   HELPERS
============================================================ */

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}


function setText(id, value) {
  const element =
    document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}


function formatMs(value) {
  return Number.isFinite(value)
    ? `${Math.round(value)} ms`
    : "—";
}


function formatNumber(value) {
  return Number.isFinite(value)
    ? value.toLocaleString()
    : "—";
}


function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function relativeAge(date) {
  if (!date) {
    return "unknown";
  }

  const seconds = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        date.getTime()
      ) / 1000
    )
  );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  return `${hours}h ago`;
}


function statusColor(status) {
  switch (status) {
    case "UP":
      return cssVar(
        "--green"
      );

    case "UNSTABLE":
      return cssVar(
        "--yellow"
      );

    case "DOWN":
      return cssVar(
        "--red"
      );

    default:
      return cssVar(
        "--muted"
      );
  }
}


/* ============================================================
   CHART OPTIONS
============================================================ */

function chartOptions() {
  return {
    responsive: true,

    maintainAspectRatio: false,

    animation: {
      duration: 300
    },

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {
      legend: {
        display: false
      },

      tooltip: {
        backgroundColor:
          "#080b13",

        borderColor:
          "rgba(255,255,255,.15)",

        borderWidth: 1,

        titleColor:
          "#ffffff",

        bodyColor:
          "#e0e4ef",

        padding: 10,

        displayColors: true,

        /*
         * Keep the threshold line,
         * but don't show it in
         * the hover popup.
         */
        filter(context) {
          return (
            context.dataset.label !==
            "Unstable threshold"
          );
        }
      }
    },

    scales: {
      x: {
        border: {
          display: false
        },

        grid: {
          display: false
        },

        ticks: {
          color:
            "#b8bfd1",

          font: {
            size: 11,
            weight: "500"
          },

          maxRotation: 0,

          autoSkip: true,

          maxTicksLimit: 8
        }
      },

      y: {
        beginAtZero: true,

        border: {
          display: false
        },

        grid: {
          color:
            "rgba(255,255,255,.07)"
        },

        ticks: {
          color:
            "#b8bfd1",

          font: {
            size: 11,
            weight: "500"
          },

          padding: 6
        }
      }
    }
  };
}


/* ============================================================
   VISITS CHART
============================================================ */

function buildVisitsChart() {
  const options =
    chartOptions();

  /*
   * You cannot have
   * 0.5 of a visit.
   */
  options.scales.y.ticks.stepSize = 1;
  options.scales.y.ticks.precision = 0;

  visitsChart =
    new Chart(
      document.getElementById(
        "visits-chart"
      ),

      {
        type: "line",

        data: {
          labels: [],

          datasets: [
            {
              label:
                "Visits",

              data: [],

              borderColor:
                cssVar(
                  "--cyan"
                ),

              backgroundColor:
                "rgba(42,221,255,.14)",

              fill: true,

              tension: 0.28,

              pointRadius: 2,

              pointHoverRadius: 5,

              borderWidth: 2
            }
          ]
        },

        options
      }
    );
}


/* ============================================================
   PAGE LOAD CHART
============================================================ */

function buildPageLoadChart() {
  const options =
    chartOptions();

  options.scales.y.ticks.callback =
    value =>
      `${value}ms`;

  pageLoadChart =
    new Chart(
      document.getElementById(
        "page-load-chart"
      ),

      {
        type: "line",

        data: {
          labels: [],

          datasets: [
            {
              label:
                "Average page load",

              data: [],

              borderColor:
                cssVar(
                  "--purple"
                ),

              backgroundColor:
                "rgba(209,108,255,.11)",

              fill: true,

              tension: 0.28,

              borderWidth: 2,

              pointRadius: 2,

              pointHoverRadius: 5,

              /*
               * Missing analytics
               * measurements remain
               * visible as gaps.
               */
              spanGaps: false
            }
          ]
        },

        options
      }
    );
}


/* ============================================================
   R2 HISTORY CHART
============================================================ */

function buildR2Chart() {
  const options =
    chartOptions();

  options.scales.y.ticks.callback =
    value =>
      `${value}ms`;

  r2Chart =
    new Chart(
      document.getElementById(
        "r2-chart"
      ),

      {
        type: "line",

        data: {
          labels: [],

          datasets: [
            {
              label:
                "Average",

              data: [],

              borderColor:
                cssVar(
                  "--cyan"
                ),

              borderWidth: 2,

              pointRadius: 0,

              pointHoverRadius: 5,

              tension: 0.25
            },

            {
              label:
                "Worst",

              data: [],

              borderColor:
                cssVar(
                  "--purple"
                ),

              borderWidth: 2,

              pointRadius: 0,

              pointHoverRadius: 5,

              tension: 0.25
            },

            {
              label:
                "Unstable threshold",

              data: [],

              borderColor:
                cssVar(
                  "--yellow"
                ),

              borderWidth: 1,

              borderDash:
                [7, 6],

              pointRadius: 0,

              pointHoverRadius: 0,

              tension: 0
            }
          ]
        },

        options
      }
    );
}


/* ============================================================
   SERVICE HEALTH
============================================================ */

function applyHealth(
  prefix,
  service
) {
  const status =
    service?.status ??
    "UNKNOWN";

  const ms =
    service?.ms;

  const color =
    statusColor(
      status
    );

  const statusElement =
    document.getElementById(
      `${prefix}-status`
    );

  const dot =
    document.getElementById(
      `${prefix}-dot`
    );


  if (statusElement) {
    statusElement.textContent =
      status;

    statusElement.style.color =
      color;
  }


  if (dot) {
    dot.style.background =
      color;

    dot.style.boxShadow =
      `0 0 8px ${color}`;
  }


  setText(
    `${prefix}-ms`,

    Number.isFinite(ms)
      ? Math.round(ms)
      : "—"
  );
}


/* ============================================================
   LIVE R2 SAMPLE BARS
============================================================ */

function updateSampleBars(
  samples
) {
  const container =
    document.getElementById(
      "sample-bars"
    );

  if (!container) {
    return;
  }

  container.innerHTML = "";


  const usable =
    samples.filter(
      sample =>
        Number.isFinite(
          sample?.ms
        )
    );


  if (!usable.length) {
    container.innerHTML = `
      <div class="sample-empty">
        No live probe data
      </div>
    `;

    return;
  }


  const times =
    usable.map(
      sample =>
        sample.ms
    );


  const min =
    Math.min(
      ...times
    );

  const max =
    Math.max(
      ...times
    );

  const range =
    max - min;


  samples.forEach(
    (
      sample,
      index
    ) => {

      const name =
        sample?.name ||
        `Sample ${index + 1}`;

      const ms =
        sample?.ms;

      const valid =
        Number.isFinite(
          ms
        );


      let width = 8;

      let color =
        cssVar(
          "--muted"
        );


      if (valid) {
        /*
         * Fastest sample:
         * green
         *
         * Slowest sample:
         * red
         */

        const ratio =
          range === 0
            ? 0
            : (
                ms - min
              ) / range;


        const hue =
          120 *
          (
            1 - ratio
          );


        color =
          `hsl(${hue}, 78%, 50%)`;


        /*
         * Bar length is latency
         * relative to current
         * slowest sample.
         */

        width =
          Math.max(
            8,

            (
              ms /
              Math.max(
                max,
                1
              )
            ) * 100
          );
      }


      const row =
        document.createElement(
          "div"
        );

      row.className =
        "sample-row";


      row.innerHTML = `
        <span class="sample-label">
          ${name}
        </span>

        <div class="sample-track">

          <div
            class="sample-fill"
            style="
              width: ${width}%;
              background-color: ${color};
            "
          ></div>

        </div>

        <span class="sample-ms">

          ${
            valid
              ? `${Math.round(ms)} ms`
              : "FAIL"
          }

        </span>
      `;


      container.appendChild(
        row
      );
    }
  );
}


/* ============================================================
   HEADER / STALE DATA DETECTION
============================================================ */

function updateFreshness(
  data
) {
  const element =
    document.getElementById(
      "last-update"
    );

  if (!element) {
    return;
  }


  const generated =
    parseTimestamp(
      data.generated
    );


  const age =
    generated
      ? (
          Date.now() -
          generated.getTime()
        )
      : Infinity;


  /*
   * If health data hasn't updated
   * for ten minutes, something in
   * the monitoring pipeline is
   * probably dead.
   */

  if (
    age >
    STALE_AFTER_MS
  ) {
    element.textContent =
      `⚠ DATA STALE · ${relativeAge(generated)}`;

    element.style.color =
      cssVar(
        "--yellow"
      );

    return;
  }


  element.textContent =
    `Last update ${relativeAge(generated)}`;

  element.style.color = "";
}


function showFetchError() {
  const element =
    document.getElementById(
      "last-update"
    );

  if (!element) {
    return;
  }


  if (lastGoodData) {
    const generated =
      parseTimestamp(
        lastGoodData.generated
      );

    element.textContent =
      `⚠ REFRESH FAILED · ${relativeAge(generated)}`;
  }

  else {
    element.textContent =
      "⚠ DATA UNAVAILABLE";
  }


  element.style.color =
    cssVar(
      "--red"
    );
}


/* ============================================================
   UPDATE CHARTS
============================================================ */

function updateCharts(
  data
) {
  const visits =
    data.visits ?? {};

  const pageLoad =
    data.pageLoad ?? {};

  const r2History =
    data.r2History ?? {};


  /* ---------------- Visits ---------------- */

  visitsChart.data.labels =
    Array.isArray(
      visits.labels
    )
      ? visits.labels
      : [];


  visitsChart
    .data
    .datasets[0]
    .data =
      Array.isArray(
        visits.values
      )
        ? visits.values
        : [];


  visitsChart.update();


  /* ---------------- Page load ---------------- */

  pageLoadChart.data.labels =
    Array.isArray(
      pageLoad.labels
    )
      ? pageLoad.labels
      : [];


  pageLoadChart
    .data
    .datasets[0]
    .data =
      Array.isArray(
        pageLoad.values
      )
        ? pageLoad.values
        : [];


  pageLoadChart.update();


  /* ---------------- R2 history ---------------- */

  const r2Labels =
    Array.isArray(
      r2History.labels
    )
      ? r2History.labels
      : [];


  r2Chart.data.labels =
    r2Labels;


  r2Chart
    .data
    .datasets[0]
    .data =
      Array.isArray(
        r2History.average
      )
        ? r2History.average
        : [];


  r2Chart
    .data
    .datasets[1]
    .data =
      Array.isArray(
        r2History.worst
      )
        ? r2History.worst
        : [];


  /*
   * Generate the threshold
   * dynamically so it always has
   * the same number of points as
   * the history.
   */

  r2Chart
    .data
    .datasets[2]
    .data =
      r2Labels.map(
        () => 1500
      );


  r2Chart.update();
}


/* ============================================================
   UPDATE NUMBERS
============================================================ */

function updateNumbers(
  data
) {
  const latest =
    data.latest ?? {};

  const analytics =
    latest.analytics ?? {};

  const storageInfo =
    latest.storageInfo ?? {};


  const visitsToday =
    analytics.visits;

  const pageLoad =
    analytics.pageLoad;

  const r2Average =
    latest.storage?.ms;


  /* ---------------- Main panels ---------------- */

  setText(
    "visits-today",

    formatNumber(
      visitsToday
    )
  );


  setText(
    "page-load-now",

    Number.isFinite(
      pageLoad
    )
      ? Math.round(
          pageLoad
        )
      : "—"
  );


  /* ---------------- Storage summary ---------------- */

  setText(
    "stored-data",

    Number.isFinite(
      storageInfo.gb
    )
      ? `${storageInfo.gb.toFixed(2)} GB`
      : "—"
  );


  setText(
    "object-count",

    formatNumber(
      storageInfo.objects
    )
  );


  /* ---------------- Bottom summary ---------------- */

  setText(
    "summary-visits",

    formatNumber(
      visitsToday
    )
  );


  setText(
    "summary-page-load",

    formatMs(
      pageLoad
    )
  );


  setText(
    "summary-r2",

    formatMs(
      r2Average
    )
  );


  /* ---------------- Service health ---------------- */

  applyHealth(
    "frontend",
    latest.frontend
  );


  applyHealth(
    "database",
    latest.database
  );


  applyHealth(
    "storage",
    latest.storage
  );
}


/* ============================================================
   APPLY COMPLETE DASHBOARD PAYLOAD
============================================================ */

function applyDashboard(
  data
) {
  lastGoodData =
    data;


  updateNumbers(
    data
  );


  updateCharts(
    data
  );


  updateSampleBars(
    Array.isArray(
      data.samples
    )
      ? data.samples
      : []
  );


  updateFreshness(
    data
  );
}


/* ============================================================
   FETCH R2 DASHBOARD JSON
============================================================ */

async function fetchDashboard() {
  /*
   * Cache-buster + no-store:
   * we always want the newest R2
   * dashboard object.
   */

  const url =
    `${DASHBOARD_URL}?t=${Date.now()}`;


  try {
    const response =
      await fetch(
        url,
        {
          cache:
            "no-store"
        }
      );


    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    if (
      !data ||
      typeof data !==
        "object"
    ) {
      throw new Error(
        "Invalid dashboard payload"
      );
    }


    applyDashboard(
      data
    );
  }

  catch (error) {
    console.error(
      "W41IT dashboard refresh failed:",
      error
    );

    showFetchError();
  }
}


/* ============================================================
   INITIALISE
============================================================ */

function init() {
  buildVisitsChart();

  buildPageLoadChart();

  buildR2Chart();


  /*
   * Fetch immediately when the
   * page opens.
   */

  fetchDashboard();


  /*
   * Backend updates every five
   * minutes.
   *
   * Frontend checks every minute,
   * so a new backend update should
   * appear within ~60 seconds.
   */

  setInterval(
    fetchDashboard,
    REFRESH_MS
  );


  /*
   * Refresh the "x minutes ago"
   * display without downloading
   * anything.
   */

  setInterval(
    () => {
      if (lastGoodData) {
        updateFreshness(
          lastGoodData
        );
      }
    },

    15_000
  );
}


init();
