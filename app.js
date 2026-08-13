/* ============================================================
   GLOBAL CHARTS
============================================================ */

let visitsChart;
let pageLoadChart;
let r2Chart;


/* ============================================================
   THEME HELPER
============================================================ */

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}


/* ============================================================
   MOCK DATA HELPERS
============================================================ */

function buildHours() {
  return Array.from(
    { length: 24 },
    (_, hour) => `${String(hour).padStart(2, "0")}:00`
  );
}


function buildR2Labels() {
  return Array.from(
    { length: 48 },
    (_, index) => {
      const minutes = index * 30;
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;

      return (
        `${String(hour).padStart(2, "0")}:` +
        `${String(minute).padStart(2, "0")}`
      );
    }
  );
}


/* ============================================================
   MOCK DATA
============================================================ */

const mockData = {
  generated: new Date().toISOString(),

  latest: {
    frontend: {
      status: "UP",
      ms: 22
    },

    database: {
      status: "UP",
      ms: 55
    },

    storage: {
      status: "UNSTABLE",
      ms: 882,
      worst: 2301
    },

    analytics: {
      visits: 23,
      pageLoad: 486
    },

    storageInfo: {
      gb: 12.83,
      objects: 399
    }
  },

  visits: {
    labels: buildHours(),

    values: [
      0, 0, 0, 1,
      0, 0, 1, 2,
      1, 3, 2, 1,
      2, 3, 1, 0,
      2, 1, 0, 1,
      0, 1, 1, 0
    ]
  },

  pageLoad: {
    labels: buildHours(),

    values: [
      440, 421, 405, 398,
      430, 451, 412, 389,
      401, 440, 478, 510,
      493, 455, 431, 418,
      423, 460, 501, 483,
      472, 495, 486, 486
    ]
  },

  r2History: {
    labels: buildR2Labels(),
    average: [],
    worst: []
  },

  samples: [
    { name: "Sample 1", ms: 84 },
    { name: "Sample 2", ms: 103 },
    { name: "Sample 3", ms: 129 },
    { name: "Sample 4", ms: 341 },
    { name: "Sample 5", ms: 882 }
  ]
};


/* ============================================================
   GENERATE MOCK R2 HISTORY
============================================================ */

for (let i = 0; i < mockData.r2History.labels.length; i++) {
  let average =
    95 +
    Math.sin(i / 3) * 22 +
    Math.random() * 30;

  let worst =
    average +
    30 +
    Math.random() * 80;

  /* Add a few spikes so the graph looks realistic. */

  if (i === 17) {
    average = 530;
    worst = 1260;
  }

  if (i === 31) {
    average = 420;
    worst = 970;
  }

  if (i === 46) {
    average = 882;
    worst = 2301;
  }

  mockData.r2History.average.push(
    Math.round(average)
  );

  mockData.r2History.worst.push(
    Math.round(worst)
  );
}


/* ============================================================
   CHART DEFAULT OPTIONS
============================================================ */

function chartOptions() {
  return {
    responsive: true,

    maintainAspectRatio: false,

    animation: {
      duration: 350
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
        backgroundColor: "#080b13",

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
         * Keep the 1500 ms threshold line visible
         * but hide it from the hover tooltip.
         */
        filter: function (context) {
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
          color: "#b8bfd1",

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
          color: "#b8bfd1",

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
   * Visits must always be whole numbers.
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
          labels:
            mockData.visits.labels,

          datasets: [
            {
              label: "Visits",

              data:
                mockData.visits.values,

              borderColor:
                cssVar("--cyan"),

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
    value => `${value}ms`;

  pageLoadChart =
    new Chart(
      document.getElementById(
        "page-load-chart"
      ),

      {
        type: "line",

        data: {
          labels:
            mockData.pageLoad.labels,

          datasets: [
            {
              label:
                "Average page load",

              data:
                mockData.pageLoad.values,

              borderColor:
                cssVar("--purple"),

              backgroundColor:
                "rgba(209,108,255,.11)",

              fill: true,

              tension: 0.28,

              borderWidth: 2,

              pointRadius: 2,

              pointHoverRadius: 5
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
    value => `${value}ms`;

  r2Chart =
    new Chart(
      document.getElementById(
        "r2-chart"
      ),

      {
        type: "line",

        data: {
          labels:
            mockData.r2History.labels,

          datasets: [
            {
              label: "Average",

              data:
                mockData.r2History.average,

              borderColor:
                cssVar("--cyan"),

              borderWidth: 2,

              pointRadius: 0,

              pointHoverRadius: 5,

              tension: 0.25
            },

            {
              label: "Worst",

              data:
                mockData.r2History.worst,

              borderColor:
                cssVar("--purple"),

              borderWidth: 2,

              pointRadius: 0,

              pointHoverRadius: 5,

              tension: 0.25
            },

            {
              label:
                "Unstable threshold",

              data:
                mockData.r2History.labels.map(
                  () => 1500
                ),

              borderColor:
                cssVar("--yellow"),

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
    service.status;

  const statusElement =
    document.getElementById(
      `${prefix}-status`
    );

  const dot =
    document.getElementById(
      `${prefix}-dot`
    );

  statusElement.textContent =
    status;

  let color =
    cssVar("--green");

  if (
    status === "UNSTABLE"
  ) {
    color =
      cssVar("--yellow");
  }

  if (
    status === "DOWN"
  ) {
    color =
      cssVar("--red");
  }

  statusElement.style.color =
    color;

  dot.style.background =
    color;

  dot.style.boxShadow =
    `0 0 8px ${color}`;
}


/* ============================================================
   R2 SAMPLE BARS
============================================================ */

function updateSampleBars(
  samples
) {
  const container =
    document.getElementById(
      "sample-bars"
    );

  container.innerHTML = "";

  const times =
    samples.map(
      sample => sample.ms
    );

  const min =
    Math.min(...times);

  const max =
    Math.max(...times);

  const range =
    max - min;

  samples.forEach(
    sample => {
      /*
       * Relative colour:
       *
       * fastest -> green
       * middle  -> yellow/orange
       * slowest -> red
       */

      const ratio =
        range === 0
          ? 0
          : (
              sample.ms - min
            ) / range;

      const hue =
        120 *
        (1 - ratio);

      const color =
        `hsl(${hue}, 78%, 50%)`;

      /*
       * Bar length represents latency
       * relative to the slowest sample.
       */

      const width =
        Math.max(
          8,
          (
            sample.ms /
            max
          ) * 100
        );

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "sample-row";

      row.innerHTML = `
        <span class="sample-label">
          ${sample.name}
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
          ${sample.ms} ms
        </span>
      `;

      container.appendChild(
        row
      );
    }
  );
}


/* ============================================================
   DASHBOARD VALUES
============================================================ */

function updateNumbers() {
  const latest =
    mockData.latest;

  document.getElementById(
    "last-update"
  ).textContent =
    new Date(
      mockData.generated
    ).toLocaleTimeString();

  document.getElementById(
    "visits-today"
  ).textContent =
    latest.analytics.visits;

  document.getElementById(
    "page-load-now"
  ).textContent =
    latest.analytics.pageLoad;

  document.getElementById(
    "frontend-ms"
  ).textContent =
    latest.frontend.ms;

  document.getElementById(
    "database-ms"
  ).textContent =
    latest.database.ms;

  document.getElementById(
    "storage-ms"
  ).textContent =
    latest.storage.ms;

  document.getElementById(
    "stored-data"
  ).textContent =
    `${latest.storageInfo.gb.toFixed(2)} GB`;

  document.getElementById(
    "object-count"
  ).textContent =
    latest.storageInfo.objects;

  document.getElementById(
    "summary-visits"
  ).textContent =
    latest.analytics.visits;

  document.getElementById(
    "summary-page-load"
  ).textContent =
    `${latest.analytics.pageLoad} ms`;

  document.getElementById(
    "summary-r2"
  ).textContent =
    `${latest.storage.ms} ms`;

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
   MOCK LIVE UPDATES
============================================================ */

function randomBetween(
  min,
  max
) {
  return Math.round(
    min +
    Math.random() *
    (max - min)
  );
}


function simulateLiveUpdate() {
  /*
   * Frontend latency
   */

  mockData.latest.frontend.ms =
    randomBetween(
      18,
      40
    );

  /*
   * Database latency
   */

  mockData.latest.database.ms =
    randomBetween(
      40,
      100
    );

  /*
   * Change the five R2 samples slightly.
   */

  const samples =
    mockData.samples.map(
      (sample, index) => {
        let ms =
          sample.ms +
          randomBetween(
            -25,
            25
          );

        ms =
          Math.max(
            40,
            ms
          );

        /*
         * Occasionally create a bad spike
         * on sample 5.
         */

        if (
          index === 4 &&
          Math.random() < 0.25
        ) {
          ms =
            randomBetween(
              1100,
              2400
            );
        }

        return {
          ...sample,
          ms
        };
      }
    );

  mockData.samples =
    samples;

  /*
   * Calculate R2 average.
   */

  const average =
    Math.round(
      samples.reduce(
        (sum, sample) =>
          sum + sample.ms,
        0
      ) /
      samples.length
    );

  /*
   * Find worst probe.
   */

  const worst =
    Math.max(
      ...samples.map(
        sample => sample.ms
      )
    );

  mockData.latest.storage.ms =
    average;

  mockData.latest.storage.worst =
    worst;

  /*
   * Any sample >= 1500 ms
   * makes storage UNSTABLE.
   */

  mockData.latest.storage.status =
    worst >= 1500
      ? "UNSTABLE"
      : "UP";

  /*
   * Slight page-load changes.
   */

  mockData.latest.analytics.pageLoad =
    randomBetween(
      380,
      620
    );

  mockData.generated =
    new Date().toISOString();

  updateNumbers();

  updateSampleBars(
    mockData.samples
  );
}


/* ============================================================
   INITIALISE
============================================================ */

function init() {
  buildVisitsChart();

  buildPageLoadChart();

  buildR2Chart();

  updateNumbers();

  updateSampleBars(
    mockData.samples
  );

  /*
   * Mock refresh every 5 seconds.
   *
   * Later this becomes the real
   * R2 JSON refresh.
   */

  setInterval(
    simulateLiveUpdate,
    5000
  );
}


init();
