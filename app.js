let visitsChart;
let pageLoadChart;
let r2Chart;


/* ============================================================
   Theme helpers
============================================================ */

function cssVar(name) {
  return getComputedStyle(
    document.documentElement
  )
    .getPropertyValue(name)
    .trim();
}


/* ============================================================
   Mock data
============================================================ */

function buildHours() {

  return Array.from(
    { length: 24 },
    (_, hour) =>
      `${String(hour).padStart(2, "0")}:00`
  );

}


function buildR2Labels() {

  return Array.from(
    { length: 48 },
    (_, index) => {

      const minutes =
        index * 30;

      const hour =
        Math.floor(minutes / 60);

      const minute =
        minutes % 60;

      return (
        `${String(hour).padStart(2, "0")}:` +
        `${String(minute).padStart(2, "0")}`
      );

    }
  );

}


const mockData = {

  generated:
    new Date().toISOString(),

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
      0, 0, 0, 1, 0, 0,
      1, 2, 1, 3, 2, 1,
      2, 3, 1, 0, 2, 1,
      0, 1, 0, 1, 1, 0
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
    { name: "File 1", ms: 84 },
    { name: "File 2", ms: 103 },
    { name: "File 3", ms: 129 },
    { name: "File 4", ms: 341 },
    { name: "File 5", ms: 882 }
  ]

};


/* ============================================================
   Generate mock R2 history
============================================================ */

for (
  let i = 0;
  i < mockData.r2History.labels.length;
  i++
) {

  let avg =
    95 +
    Math.sin(i / 3) * 22 +
    Math.random() * 30;


  let worst =
    avg +
    30 +
    Math.random() * 80;


  /*
   * Throw in some ugly spikes so the graph
   * doesn't look suspiciously perfect.
   */

  if (i === 17) {
    avg = 530;
    worst = 1260;
  }


  if (i === 31) {
    avg = 420;
    worst = 970;
  }


  if (i === 46) {
    avg = 882;
    worst = 2301;
  }


  mockData.r2History.average.push(
    Math.round(avg)
  );


  mockData.r2History.worst.push(
    Math.round(worst)
  );

}


/* ============================================================
   Chart options
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

        backgroundColor:
          "#080b13",

        borderColor:
          "rgba(255,255,255,.12)",

        borderWidth: 1,

        titleColor:
          "#ffffff",

        bodyColor:
          "#c8ccda",

        padding: 9

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
            "#7f869b",

          font: {
            size: 9
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
            "rgba(255,255,255,.055)"

        },

        ticks: {

          color:
            "#7f869b",

          font: {
            size: 9
          },

          padding: 5

        }

      }

    }

  };

}


/* ============================================================
   Visits
============================================================ */

function buildVisitsChart() {

  const options =
    chartOptions();


  /*
   * Visits cannot be fractional people.
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

              data:
                mockData.visits.values,

              borderColor:
                cssVar("--cyan"),

              backgroundColor:
                "rgba(33,213,255,.12)",

              fill: true,

              tension: 0.28,

              pointRadius: 1,

              pointHoverRadius: 4,

              borderWidth: 2

            }

          ]

        },

        options

      }
    );

}


/* ============================================================
   Page load
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

              data:
                mockData.pageLoad.values,

              borderColor:
                cssVar("--purple"),

              backgroundColor:
                "rgba(198,92,255,.09)",

              fill: true,

              tension: 0.28,

              borderWidth: 2,

              pointRadius: 1,

              pointHoverRadius: 4

            }

          ]

        },

        options

      }
    );

}


/* ============================================================
   R2 history
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

              pointHoverRadius: 4,

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

              pointHoverRadius: 4,

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

              borderDash: [7, 6],

              pointRadius: 0,

              tension: 0

            }

          ]

        },

        options

      }
    );

}


/* ============================================================
   Health
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


  if (status === "UNSTABLE") {

    color =
      cssVar("--yellow");

  }


  if (status === "DOWN") {

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
   R2 sample bars
============================================================ */

function updateSampleBars(samples) {

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
       * Relative performance:
       *
       * fastest = green (120°)
       * slowest = red   (0°)
       */

      const ratio =
        range === 0
          ? 0
          : (
              sample.ms - min
            ) / range;


      const hue =
        120 * (1 - ratio);


      const color =
        `hsl(${hue}, 78%, 50%)`;


      /*
       * Bar length represents latency.
       */

      const width =
        Math.max(
          7,
          sample.ms / max * 100
        );


      const row =
        document.createElement("div");


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
   Dashboard numbers
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
    "storage-worst"
  ).textContent =
    `${latest.storage.worst} ms`;


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


  document.getElementById(
    "sample-success"
  ).textContent =
    `${mockData.samples.length} / ${mockData.samples.length}`;

}


/* ============================================================
   Fake live updates

   Purely for frontend testing.
   Backend will replace this later.
============================================================ */

function simulateLiveUpdate() {

  const randomBetween =
    (min, max) =>
      Math.round(
        min +
        Math.random() *
        (max - min)
      );


  /*
   * Small current-value movements.
   */

  mockData.latest.frontend.ms =
    randomBetween(
      18,
      40
    );


  mockData.latest.database.ms =
    randomBetween(
      40,
      100
    );


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
         * Occasionally spike one sample.
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


  const average =
    Math.round(
      samples.reduce(
        (sum, sample) =>
          sum + sample.ms,
        0
      ) /
      samples.length
    );


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


  mockData.latest.storage.status =
    worst >= 1500
      ? "UNSTABLE"
      : "UP";


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
   Start
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
   * Later this becomes the real R2 JSON refresh.
   */

  setInterval(
    simulateLiveUpdate,
    5000
  );

}


init();
