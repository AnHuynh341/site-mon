/* ============================================================
   Chart globals
============================================================ */

let visitsChart;
let pageLoadChart;
let r2Chart;


/* ============================================================
   Demo data

   This is temporary.
   Later this function will fetch latest.json/history.json from R2.
============================================================ */

async function getDashboardData() {

  const hours = [
    "00:00",
    "01:00",
    "02:00",
    "03:00",
    "04:00",
    "05:00",
    "06:00",
    "07:00",
    "08:00",
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
    "21:00",
    "22:00",
    "23:00"
  ];


  return {

    generated: new Date().toISOString(),

    latest: {

      frontend: {
        status: "UP",
        response_ms: 22
      },

      database: {
        status: "UP",
        response_ms: 55
      },

      storage: {
        status: "UNSTABLE",
        response_ms: 882,
        worst_ms: 2301,
        successful_objects: 3,
        total_objects: 3
      },

      analytics: {
        visits_today: 23,
        page_load_ms: 486
      },

      r2: {
        stored_gb: 12.83,
        objects: 399
      }

    },


    visits: {

      labels: hours,

      values: [
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        2,
        1,
        3,
        2,
        1,
        2,
        3,
        1,
        0,
        2,
        1,
        0,
        1,
        0,
        1,
        1,
        0
      ]

    },


    pageLoad: {

      labels: hours,

      values: [
        440,
        421,
        405,
        398,
        430,
        451,
        412,
        389,
        401,
        440,
        478,
        510,
        493,
        455,
        431,
        418,
        423,
        460,
        501,
        483,
        472,
        495,
        486,
        486
      ]

    },


    r2: {

      labels: [
        "18:00",
        "18:30",
        "19:00",
        "19:30",
        "20:00",
        "20:30",
        "21:00",
        "21:30",
        "22:00",
        "22:30",
        "23:00",
        "23:05"
      ],

      average: [
        91,
        87,
        95,
        102,
        89,
        110,
        94,
        101,
        126,
        108,
        117,
        882
      ],

      worst: [
        131,
        119,
        143,
        156,
        126,
        181,
        145,
        160,
        244,
        173,
        209,
        2301
      ]

    }

  };

}


/* ============================================================
   Helpers
============================================================ */

function cssVariable(name) {

  return getComputedStyle(
    document.documentElement
  )
    .getPropertyValue(name)
    .trim();

}


function formatTime(dateString) {

  const date = new Date(dateString);

  return date.toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  );

}


function statusClass(status) {

  switch (status) {

    case "UP":
      return "status-up";

    case "UNSTABLE":
      return "status-unstable";

    default:
      return "status-down";

  }

}


/* ============================================================
   Gauges
============================================================ */

function updateGauge(
  gaugeId,
  value,
  max,
  status
) {

  const gauge =
    document.getElementById(gaugeId);

  if (!gauge) {
    return;
  }


  const needle =
    gauge.querySelector(".gauge-needle");

  const fill =
    gauge.querySelector(".gauge-fill");


  const clamped =
    Math.min(
      Math.max(value, 0),
      max
    );


  const ratio =
    clamped / max;


  /* -90° = far left
      90° = far right
  */

  const angle =
    -90 + ratio * 180;


  needle.style.transform =
    `rotate(${angle}deg)`;


  const arcLength = 235.62;

  fill.style.strokeDashoffset =
    arcLength * (1 - ratio);


  if (status === "DOWN") {

    fill.style.stroke =
      cssVariable("--red");

  }

  else if (status === "UNSTABLE") {

    fill.style.stroke =
      cssVariable("--yellow");

  }

  else {

    fill.style.stroke =
      cssVariable("--green");

  }

}


function updateStatusPill(
  id,
  status
) {

  const element =
    document.getElementById(id);


  element.textContent =
    status;


  element.classList.remove(
    "status-up",
    "status-unstable",
    "status-down"
  );


  element.classList.add(
    statusClass(status)
  );

}


/* ============================================================
   Chart defaults
============================================================ */

function commonChartOptions() {

  return {

    responsive: true,

    maintainAspectRatio: false,

    interaction: {
      mode: "index",
      intersect: false
    },

    animation: {
      duration: 450
    },

    plugins: {

      legend: {
        display: false
      },

      tooltip: {

        backgroundColor:
          "#151731",

        borderColor:
          "rgba(255,255,255,.10)",

        borderWidth: 1,

        titleColor:
          "#f4f5ff",

        bodyColor:
          "#c5c7dc",

        padding: 11,

        displayColors: true

      }

    },

    scales: {

      x: {

        grid: {
          display: false
        },

        border: {
          display: false
        },

        ticks: {

          color:
            "#878aa7",

          maxRotation: 0,

          autoSkip: true,

          maxTicksLimit: 12

        }

      },

      y: {

        beginAtZero: true,

        grid: {

          color:
            "rgba(255,255,255,.055)"

        },

        border: {
          display: false
        },

        ticks: {

          color:
            "#878aa7",

          padding: 10

        }

      }

    }

  };

}


/* ============================================================
   Visits chart
============================================================ */

function buildVisitsChart(data) {

  const ctx =
    document
      .getElementById("visits-chart")
      .getContext("2d");


  visitsChart =
    new Chart(
      ctx,
      {

        type: "line",

        data: {

          labels:
            data.labels,

          datasets: [

            {

              label:
                "Visits",

              data:
                data.values,

              borderColor:
                cssVariable("--cyan"),

              backgroundColor:
                "rgba(35,213,255,.11)",

              fill: true,

              pointRadius: 2,

              pointHoverRadius: 5,

              borderWidth: 2,

              tension: 0.35

            }

          ]

        },


        options:
          commonChartOptions()

      }
    );

}


/* ============================================================
   Page-load chart
============================================================ */

function buildPageLoadChart(data) {

  const ctx =
    document
      .getElementById("page-load-chart")
      .getContext("2d");


  const options =
    commonChartOptions();


  options.scales.y.ticks.callback =
    value => `${value} ms`;


  pageLoadChart =
    new Chart(
      ctx,
      {

        type: "line",

        data: {

          labels:
            data.labels,

          datasets: [

            {

              label:
                "Average page load",

              data:
                data.values,

              borderColor:
                cssVariable("--purple"),

              backgroundColor:
                "rgba(210,98,255,.08)",

              fill: true,

              borderWidth: 2,

              pointRadius: 1,

              pointHoverRadius: 5,

              tension: 0.32

            }

          ]

        },


        options

      }
    );

}


/* ============================================================
   R2 chart
============================================================ */

function buildR2Chart(data) {

  const ctx =
    document
      .getElementById("r2-chart")
      .getContext("2d");


  const options =
    commonChartOptions();


  options.scales.y.ticks.callback =
    value => `${value} ms`;


  r2Chart =
    new Chart(
      ctx,
      {

        type: "line",

        data: {

          labels:
            data.labels,

          datasets: [

            {

              label:
                "Average",

              data:
                data.average,

              borderColor:
                cssVariable("--cyan"),

              borderWidth:
                2,

              pointRadius:
                1,

              pointHoverRadius:
                5,

              tension:
                0.28

            },

            {

              label:
                "Worst",

              data:
                data.worst,

              borderColor:
                cssVariable("--purple"),

              borderWidth:
                2,

              pointRadius:
                1,

              pointHoverRadius:
                5,

              tension:
                0.28

            },

            {

              label:
                "Unstable threshold",

              data:
                data.labels.map(
                  () => 1500
                ),

              borderColor:
                cssVariable("--yellow"),

              borderDash:
                [7, 7],

              borderWidth:
                1,

              pointRadius:
                0,

              tension:
                0

            }

          ]

        },


        options

      }
    );

}


/* ============================================================
   Dashboard update
============================================================ */

function updateDashboard(data) {

  const latest =
    data.latest;


  /* Header */

  document
    .getElementById("last-update")
    .textContent =
      formatTime(data.generated);


  /* Frontend */

  document
    .getElementById("frontend-response")
    .textContent =
      latest.frontend.response_ms;


  updateStatusPill(
    "frontend-status",
    latest.frontend.status
  );


  updateGauge(
    "frontend-gauge",
    latest.frontend.response_ms,
    800,
    latest.frontend.status
  );


  /* Database */

  document
    .getElementById("database-response")
    .textContent =
      latest.database.response_ms;


  updateStatusPill(
    "database-status",
    latest.database.status
  );


  updateGauge(
    "database-gauge",
    latest.database.response_ms,
    800,
    latest.database.status
  );


  /* Storage */

  document
    .getElementById("storage-response")
    .textContent =
      latest.storage.response_ms;


  document
    .getElementById("storage-worst")
    .textContent =
      `${latest.storage.worst_ms} ms`;


  updateStatusPill(
    "storage-status",
    latest.storage.status
  );


  updateGauge(
    "storage-gauge",
    latest.storage.response_ms,
    1500,
    latest.storage.status
  );


  /* Analytics */

  document
    .getElementById("visits-total")
    .textContent =
      latest.analytics.visits_today;


  document
    .getElementById("page-load-current")
    .textContent =
      latest.analytics.page_load_ms;


  /* Summary */

  document
    .getElementById("data-stored")
    .textContent =
      `${latest.r2.stored_gb.toFixed(2)} GB`;


  document
    .getElementById("object-count")
    .textContent =
      latest.r2.objects;


  document
    .getElementById("summary-visits")
    .textContent =
      latest.analytics.visits_today;


  document
    .getElementById("summary-page-load")
    .textContent =
      `${latest.analytics.page_load_ms} ms`;

}


/* ============================================================
   Initialisation
============================================================ */

async function init() {

  try {

    const data =
      await getDashboardData();


    updateDashboard(data);


    buildVisitsChart(
      data.visits
    );


    buildPageLoadChart(
      data.pageLoad
    );


    buildR2Chart(
      data.r2
    );


  }

  catch (error) {

    console.error(
      "Dashboard failed to initialise:",
      error
    );


    const badge =
      document.getElementById(
        "live-badge"
      );


    badge.innerHTML =
      "<span class='live-dot'></span> DATA ERROR";


    badge.style.color =
      cssVariable("--red");

  }

}


init();
