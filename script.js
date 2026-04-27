
const tabs = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");
const treatmentItems = document.querySelectorAll(".tx-item");

// Map state
let mapInitialized = false;
let countyLookup = {};   // through 5-digit FIPS string
let stateAvgMap = {};    // through state abbreviation
let mapSvg, mapGroup, pathGen, zoomBehavior;
let countyPaths, statePaths;
let activeStateFips = null;
let cachedTopology = null;
let barChartInstance = null;
let selectedMeasure = "OBESITY";

//  2-digit state FIPS codes to abbreviations
const STATE_FIPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY"
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

// Each measure defines its label, color scale, and axis range for the map and chart
const MEASURES = {
  OBESITY: {
    label: "Obesity",
    shortLabel: "Obesity rate",
    domain: [20, 50],
    colorInterpolator: d3.interpolateYlOrRd,
    legend: ["20%", "35%", "50%"]
  },
  LPA: {
    label: "Physical inactivity",
    shortLabel: "Physical inactivity",
    domain: [10, 40],
    colorInterpolator: d3.interpolatePuBu,
    legend: ["10%", "25%", "40%"]
  },
  DIABETES: {
    label: "Diabetes",
    shortLabel: "Diabetes rate",
    domain: [5, 20],
    colorInterpolator: d3.interpolateOranges,
    legend: ["5%", "12.5%", "20%"]
  },
  SLEEP: {
    label: "Short sleep",
    shortLabel: "Short sleep rate",
    domain: [20, 45],
    colorInterpolator: d3.interpolatePuRd,
    legend: ["20%", "32.5%", "45%"]
  },
  POVERTY: {
    label: "Poverty",
    shortLabel: "Poverty rate",
    domain: [5, 35],
    colorInterpolator: d3.interpolateBlues,
    legend: ["5%", "20%", "35%"]
  }
};

// Order that measures appear in the hover tooltip
const TOOLTIP_ORDER = ["OBESITY", "LPA", "DIABETES", "SLEEP", "POVERTY"];


//  TAB NAVIGATION 
tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");

    // Only load the map the first time the user visits that tab
    if (btn.dataset.tab === "map" && !mapInitialized) initMap();
  });
});


//  clicking logo goes home
const logoBtnEl = document.getElementById("logo-btn");

function goToAbout() {
  tabs.forEach((t) => t.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));
  document.querySelector('[data-tab="about"]').classList.add("active");
  document.getElementById("panel-about").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

logoBtnEl.addEventListener("click", goToAbout);
logoBtnEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToAbout(); }
});


//  TREATMENT EXPAND/COLLAPSE 
treatmentItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    if (event.target.closest(".tx-item-head")) item.classList.toggle("open");
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      item.classList.toggle("open");
    }
  });
});


//  MEASURE DROPDOWN 
document.getElementById("measure-select").addEventListener("change", (event) => {
  selectedMeasure = event.target.value;
  updateLegend();

  // Guard against the label element not existing
  const measureLabel = document.getElementById("selected-measure-label");
  if (measureLabel) measureLabel.textContent = MEASURES[selectedMeasure].label;

  if (mapInitialized) {
    repaintMap();
    renderBarChart();
  }
});


//  COLOR & TOOLTIP  

// Returns an RGB color for a given measure value using D3 color scales
function measureColor(measureKey, value) {
  if (value == null) return "#e8ddd0";
  const config = MEASURES[measureKey];
  const bounded = Math.max(config.domain[0], Math.min(config.domain[1], value));
  return d3.scaleSequential().domain(config.domain).interpolator(config.colorInterpolator)(bounded);
}

function formatValue(value) {
  return value == null || Number.isNaN(value) ? "N/A" : `${value.toFixed(1)}%`;
}

//  inner HTML for the hover tooltip
function buildTooltipHtml(title, metrics, countyCount = null) {
  const rows = TOOLTIP_ORDER.map((key) => {
    const activeClass = key === selectedMeasure ? " active" : "";
    return `<div class="tt-row${activeClass}"><span>${MEASURES[key].label}</span><span class="tt-val">${formatValue(metrics[key])}</span></div>`;
  }).join("");

  const countRow = countyCount
    ? `<div class="tt-row"><span>Counties</span><span class="tt-val">${countyCount}</span></div>`
    : "";

  return `<div class="tt-name">${title}</div>${rows}${countRow}`;
}

// Updates the legend bar gradient and labels to match the selected measure
function updateLegend() {
  const config = MEASURES[selectedMeasure];
  document.getElementById("legend-title").textContent = config.shortLabel;
  document.getElementById("legend-min").textContent   = config.legend[0];
  document.getElementById("legend-mid").textContent   = config.legend[1];
  document.getElementById("legend-max").textContent   = config.legend[2];
  document.getElementById("legend-bar").style.background =
    `linear-gradient(to right, ${config.colorInterpolator(0.15)}, ${config.colorInterpolator(0.5)}, ${config.colorInterpolator(0.85)})`;
}


//  data fetching map

async function initMap() {
  mapInitialized = true;
  updateLegend();

  try {
    const cdcMeasures = ["OBESITY", "LPA", "DIABETES", "SLEEP"];

    // One GET request for CDC measure — all run in parallel with Promise.all
    const cdcRequests = cdcMeasures.map((measure) =>
      axios.get("https://data.cdc.gov/resource/swc5-untb.json", {
        params: { measureid: measure, $limit: 5000 }
      })
    );

    // Poverty comes from the Census ACS API (different source than CDC)
    const censusRequest = axios.get(
      "https://api.census.gov/data/2023/acs/acs5/subject?get=NAME,S1701_C03_001E&for=county:*&in=state:*"
    );

    // Fetch map topology and all API data at the same time
    const [topology, ...responses] = await Promise.all([
      d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"),
      ...cdcRequests,
      censusRequest
    ]);

    cachedTopology = topology;
    countyLookup   = {};
    stateAvgMap    = {};

    // Build countyLookup from CDC PLACES responses
    cdcMeasures.forEach((measure, index) => {
      responses[index].data.forEach((row) => {
        const numericId = parseInt(row.locationid, 10);

        // County FIPS codes as integers are always >= 1000; state-level rows are 1–56 — skip those
        if (Number.isNaN(numericId) || numericId < 1000) return;

        const fips = String(numericId).padStart(5, "0");

        if (!countyLookup[fips]) {
          countyLookup[fips] = { name: row.locationname || "Unknown", state: row.stateabbr || "", metrics: {} };
        }

        const value = parseFloat(row.data_value);
        countyLookup[fips].metrics[measure] = Number.isNaN(value) ? null : value;
      });
    });

    // Merge Census poverty data into the same countyLookup
    const povertyRows = responses[responses.length - 1].data.slice(1); // slice(1) skips the header row
    povertyRows.forEach((row) => {
      const povertyValue = parseFloat(row[1]);
      const fips = `${row[2]}${row[3]}`;

      if (!countyLookup[fips]) {
        countyLookup[fips] = { name: row[0]?.split(",")[0] || "Unknown", state: STATE_FIPS[row[2]] || "", metrics: {} };
      }
      countyLookup[fips].metrics.POVERTY = Number.isNaN(povertyValue) ? null : povertyValue;
    });

    computeStateAverages();

    document.getElementById("map-loading").style.display = "none";
    document.getElementById("map-svg").style.display     = "block";

    renderMap(topology);
    renderBarChart();

  } catch (error) {
    document.getElementById("map-loading").innerHTML =
      `<p style="color:#c0392b; padding:2rem; text-align:center;">Could not load live data. Error: ${error.message}</p>`;
  }
}

// Averages each measure's county values up to the state level for the national view
function computeStateAverages() {
  const stateBuckets = {};

  Object.values(countyLookup).forEach((county) => {
    if (!county.state) return;
    if (!stateBuckets[county.state]) stateBuckets[county.state] = { count: 0, metrics: {} };

    stateBuckets[county.state].count += 1;

    TOOLTIP_ORDER.forEach((measure) => {
      const value = county.metrics[measure];
      if (value == null) return;
      if (!stateBuckets[county.state].metrics[measure]) stateBuckets[county.state].metrics[measure] = [];
      stateBuckets[county.state].metrics[measure].push(value);
    });
  });

  Object.entries(stateBuckets).forEach(([abbr, bucket]) => {
    stateAvgMap[abbr] = { count: bucket.count, metrics: {} };
    TOOLTIP_ORDER.forEach((measure) => {
      const values = bucket.metrics[measure] || [];
      stateAvgMap[abbr].metrics[measure] = values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : null;
    });
  });
}


//  MAP loading

function renderMap(topology) {
  const container = document.getElementById("map-wrap");
  const width  = Math.max(container.clientWidth, 320);
  const height = Math.round(width * 0.62);

  mapSvg = d3.select("#map-svg").attr("width", width).attr("height", height);
  mapSvg.selectAll("*").remove();

  const projection = d3.geoAlbersUsa().scale(width * 1.22).translate([width / 2, height / 2]);
  pathGen  = d3.geoPath().projection(projection);
  mapGroup = mapSvg.append("g");

  const statesFeature   = topojson.feature(topology, topology.objects.states);
  const countiesFeature = topojson.feature(topology, topology.objects.counties);

  // State fills — colored by average obesity (or whichever measure is selected)
  statePaths = mapGroup.append("g")
    .attr("id", "states-layer")
    .selectAll("path")
    .data(statesFeature.features)
    .join("path")
    .attr("d", pathGen)
    .attr("fill", (d) => {
      const abbr = STATE_FIPS[String(d.id).padStart(2, "0")];
      const val  = abbr && stateAvgMap[abbr] ? stateAvgMap[abbr].metrics[selectedMeasure] : null;
      return measureColor(selectedMeasure, val);
    })
    .attr("stroke", "#fffaf4")
    .attr("stroke-width", 0.9)
    .style("cursor", "pointer")
    .on("mousemove", onStateHover)
    .on("mouseleave", hideTooltip)
    .on("click", onStateClick);

  // County paths are drawn but invisible until a state is clicked
  countyPaths = mapGroup.append("g")
    .attr("id", "counties-layer")
    .selectAll("path")
    .data(countiesFeature.features)
    .join("path")
    .attr("d", pathGen)
    .attr("fill", "none")
    .attr("stroke", "none")
    .attr("pointer-events", "none");

  // Thin border mesh drawn on top of state fills
  mapGroup.append("path")
    .datum(topojson.mesh(topology, topology.objects.states, (a, b) => a !== b))
    .attr("id", "state-mesh")
    .attr("fill", "none")
    .attr("stroke", "#fffaf4")
    .attr("stroke-width", 1)
    .attr("d", pathGen)
    .attr("pointer-events", "none");

  // D3 zoom — transforms the whole group so surrounding states stay visible when zoomed in
  zoomBehavior = d3.zoom()
    .scaleExtent([1, 20])
    .on("zoom", (event) => {
      const k = event.transform.k;
      mapGroup.attr("transform", event.transform);
      countyPaths.attr("stroke-width", 0.4 / k);
      mapGroup.select("#state-mesh").attr("stroke-width", 1 / k);
    });

  mapSvg.call(zoomBehavior);
}

// Repaints all state and county w corresponding color fills when the measure dropdown changes
function repaintMap() {
  if (!statePaths) return;

  statePaths.attr("fill", (d) => {
    const abbr = STATE_FIPS[String(d.id).padStart(2, "0")];
    const val  = abbr && stateAvgMap[abbr] ? stateAvgMap[abbr].metrics[selectedMeasure] : null;
    return measureColor(selectedMeasure, val);
  });

  // If a state is already zoomed into, repaint its counties too
  if (activeStateFips) {
    countyPaths.attr("fill", (countyDatum) => {
      const cfips = String(countyDatum.id).padStart(5, "0");
      if (!cfips.startsWith(activeStateFips)) return "none";
      const county = countyLookup[cfips];
      return county ? measureColor(selectedMeasure, county.metrics[selectedMeasure]) : "#e8ddd0";
    });
  }
}


// map zooming and clicking

function onStateClick(event, d) {
  event.stopPropagation();
  const fips = String(d.id).padStart(2, "0");
  const abbr = STATE_FIPS[fips] || "??";
  activeStateFips = fips;

  // Fit the clicked state into ~85% of the viewport while keeping neighbors visible
  const [[x0, y0], [x1, y1]] = pathGen.bounds(d);
  const width  = Number(mapSvg.attr("width"));
  const height = Number(mapSvg.attr("height"));
  const scale  = Math.min(8, 0.85 / Math.max((x1 - x0) / width, (y1 - y0) / height));
  const tx = width  / 2 - scale * (x0 + x1) / 2;
  const ty = height / 2 - scale * (y0 + y1) / 2;

  mapSvg.transition().duration(750).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );

  // Reveal county fills only for the clicked state
  countyPaths
    .attr("fill", (countyDatum) => {
      const cfips = String(countyDatum.id).padStart(5, "0");
      if (!cfips.startsWith(fips)) return "none";
      const county = countyLookup[cfips];
      return county ? measureColor(selectedMeasure, county.metrics[selectedMeasure]) : "#e8ddd0";
    })
    .attr("stroke", (countyDatum) =>
      String(countyDatum.id).padStart(5, "0").startsWith(fips) ? "#fffaf4" : "none"
    )
    .attr("pointer-events", (countyDatum) =>
      String(countyDatum.id).padStart(5, "0").startsWith(fips) ? "all" : "none"
    )
    .on("mousemove", onCountyHover)
    .on("mouseleave", hideTooltip);

  // Fade out other states so county detail is easier to read
  statePaths
    .attr("fill-opacity",   (sd) => String(sd.id).padStart(2, "0") === fips ? 0.18 : 1)
    .attr("stroke-opacity", (sd) => String(sd.id).padStart(2, "0") === fips ? 0.25 : 1);

  document.getElementById("back-btn").style.display      = "inline-flex";
  document.getElementById("state-label").textContent     = STATE_NAMES[abbr] || abbr;
  document.getElementById("view-mode-label").textContent = STATE_NAMES[abbr] || abbr;
  document.getElementById("map-hint").textContent        = "Hover over counties for local detail. Click back to return to the national view.";
  hideTooltip();
}

function resetZoom() {
  if (!mapSvg || !zoomBehavior || !countyPaths) return;

  activeStateFips = null;
  mapSvg.transition().duration(600).call(zoomBehavior.transform, d3.zoomIdentity);
  countyPaths.attr("fill", "none").attr("stroke", "none").attr("pointer-events", "none");

  if (statePaths) statePaths.attr("fill-opacity", 1).attr("stroke-opacity", 1);

  document.getElementById("back-btn").style.display      = "none";
  document.getElementById("state-label").textContent     = "";
  document.getElementById("view-mode-label").textContent = "Nationwide";
  document.getElementById("map-hint").textContent        = "Hover a state for details and click to zoom into counties.";
  hideTooltip();
}


// tool tip

function onStateHover(event, d) {
  const fips      = String(d.id).padStart(2, "0");
  const abbr      = STATE_FIPS[fips] || "??";
  const stateData = stateAvgMap[abbr];

  document.getElementById("tooltip").innerHTML = buildTooltipHtml(
    STATE_NAMES[abbr] || abbr,
    stateData ? stateData.metrics : {},
    stateData ? `${stateData.count} counties` : null
  );
  showTooltip(event);
}

function onCountyHover(event, d) {
  const fips   = String(d.id).padStart(5, "0");
  const county = countyLookup[fips];
  if (!county) return;

  const countyName = county.name.includes("County") ? county.name : `${county.name} County`;
  document.getElementById("tooltip").innerHTML = buildTooltipHtml(
    `${countyName}, ${county.state}`,
    county.metrics
  );
  showTooltip(event);
}

function showTooltip(event) {
  const tt = document.getElementById("tooltip");
  tt.classList.remove("hidden");
  tt.setAttribute("aria-hidden", "false");
  tt.style.left = `${event.clientX + 14}px`;
  tt.style.top  = `${event.clientY - 12}px`;
}

function hideTooltip() {
  const tt = document.getElementById("tooltip");
  tt.classList.add("hidden");
  tt.setAttribute("aria-hidden", "true");
}


// bar chart on bottom

function renderBarChart() {
  document.getElementById("chart-card").style.display = "block";
  document.getElementById("chart-title").textContent  = `Top 15 states by ${MEASURES[selectedMeasure].label.toLowerCase()}`;
  document.getElementById("chart-note").textContent   = `Updates to match the selected measure: ${MEASURES[selectedMeasure].label}.`;

  const sorted = Object.entries(stateAvgMap)
    .filter(([, data]) => data.metrics[selectedMeasure] != null)
    .sort((a, b) => b[1].metrics[selectedMeasure] - a[1].metrics[selectedMeasure])
    .slice(0, 15);

  const labels = sorted.map(([abbr]) => STATE_NAMES[abbr] || abbr);
  const values = sorted.map(([, data]) => Number(data.metrics[selectedMeasure].toFixed(1)));
  const colors = values.map((v) => measureColor(selectedMeasure, v));
  const domain = MEASURES[selectedMeasure].domain;

  const ctx = document.getElementById("bar-chart").getContext("2d");
  if (barChartInstance) barChartInstance.destroy();

  barChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: `${MEASURES[selectedMeasure].label} (%)`,
        data: values,
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${MEASURES[selectedMeasure].label}: ${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#736355", font: { family: "Outfit", size: 11 } }
        },
        y: {
          min: domain[0],
          max: domain[1],
          ticks: { color: "#736355", callback: (v) => `${v}%`, font: { family: "Outfit", size: 11 } },
          grid: { color: "rgba(118, 99, 85, 0.10)" }
        }
      }
    }
  });
}


// qualifer tool

// Highlight the selected BMI row
document.querySelectorAll(".bmi-opt input").forEach((input) => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".bmi-opt").forEach((o) => o.classList.remove("selected"));
    input.closest(".bmi-opt").classList.add("selected");
    updateResults();
  });
});

// Highlight checked comorbidity rows
document.querySelectorAll(".comorbid").forEach((input) => {
  input.addEventListener("change", () => {
    input.closest(".check-opt").classList.toggle("comorbid-checked", input.checked);
    updateResults();
  });
});

// Highlight checked contraindication rows
document.querySelectorAll(".check-opt.contra input").forEach((input) => {
  input.addEventListener("change", () => {
    input.closest(".check-opt").classList.toggle("contra-checked", input.checked);
    updateResults();
  });
});

// Highlight checked history rows
document.querySelectorAll(".check-opt.hist input").forEach((input) => {
  input.addEventListener("change", () => {
    input.closest(".check-opt").classList.toggle("hist-checked", input.checked);
    updateResults();
  });
});

function getFormState() {
  const bmiInput = document.querySelector(".bmi-opt input:checked");
  return {
    bmi:            bmiInput ? parseInt(bmiInput.value, 10) : null,
    comorbidCount:  document.querySelectorAll(".comorbid:checked").length,
    glpContra:      ["ci-mtc", "ci-men2", "ci-panc", "ci-preg"].some((id) => document.getElementById(id).checked),
    psychFlag:      document.getElementById("ci-psych").checked,
    triedLifestyle: document.getElementById("h-life").checked,
    clearedSurgery: document.getElementById("h-surg").checked
  };
}

// Re-evaluates all three result cards whenever any input changes
function updateResults() {
  const { bmi, comorbidCount, glpContra, psychFlag, triedLifestyle, clearedSurgery } = getFormState();
  if (bmi === null) return;

  // Lifestyle —-> indicated for everyone with BMI >= 25
  if (bmi >= 25) {
    setResult("r-lifestyle", "eligible", "Lifestyle medicine",
      "Recommended. Lifestyle treatment is an important part of obesity care.");
  } else {
    setResult("r-lifestyle", "not", "Lifestyle medicine",
      "Formal obesity treatment thresholds are not met, though healthy habits are still helpful.");
  }

  // Medications —-> BMI >= 30, or BMI >= 27 with at least one comorbidity
  const medicationEligible = bmi >= 30 || (bmi >= 27 && comorbidCount > 0);

  if (medicationEligible && glpContra) {
    setResult("r-meds", "contra", "Anti-obesity medication",
      "BMI criteria are met, but caution or contraindication flags are present for GLP-1-based therapy.");
  } else if (medicationEligible) {
    const reason = bmi >= 30
      ? "Eligible because BMI is 30 or above."
      : `Eligible because BMI is at least 27 and ${comorbidCount} comorbidity${comorbidCount === 1 ? "" : "ies"} are selected.`;
    setResult("r-meds", "eligible", "Anti-obesity medication", reason);
  } else if (bmi >= 27) {
    setResult("r-meds", "not", "Anti-obesity medication",
      "BMI is close to the medication threshold, but at least one obesity-related comorbidity is needed.");
  } else {
    setResult("r-meds", "not", "Anti-obesity medication", "Medication threshold is not met.");
  }

  // Surgery —> BMI >= 40, or BMI >= 35 with comorbidity, plus lifestyle attempt and clearance
  const surgeryEligibleByBmi = bmi >= 40 || (bmi >= 35 && comorbidCount > 0);

  if (surgeryEligibleByBmi && psychFlag) {
    setResult("r-surgery", "contra", "Bariatric surgery",
      "BMI criteria are met, but psychiatric stabilization or further review may be needed first.");
  } else if (surgeryEligibleByBmi && !triedLifestyle) {
    setResult("r-surgery", "not", "Bariatric surgery",
      "BMI criteria may be met, but a prior structured lifestyle attempt is expected before referral.");
  } else if (surgeryEligibleByBmi && triedLifestyle && !clearedSurgery) {
    setResult("r-surgery", "not", "Bariatric surgery",
      "BMI and treatment history fit, but surgical clearance is not yet marked.");
  } else if (surgeryEligibleByBmi && triedLifestyle && clearedSurgery) {
    setResult("r-surgery", "eligible", "Bariatric surgery",
      "All criteria in this educational checklist are met. Bariatric referral could be considered.");
  } else {
    setResult("r-surgery", "not", "Bariatric surgery", "Surgical threshold is not met in this checklist.");
  }
}

// Updates a result card's class, dot color, title, and the note
function setResult(id, type, title, note) {
  const el        = document.getElementById(id);
  const typeClass = type === "eligible" ? " result-eligible" : type === "contra" ? " result-contra" : "";
  const dotClass  = type === "eligible" ? "green" : type === "contra" ? "red" : "gray";
  el.className    = `result-item${typeClass}`;
  el.innerHTML    = `<div class="ri-head"><span class="ri-dot ${dotClass}"></span><span class="ri-name">${title}</span></div><p class="ri-note">${note}</p>`;
}

function resetQualifier() {
  document.querySelectorAll(".bmi-opt input, .comorbid, .check-opt.contra input, .check-opt.hist input")
    .forEach((input) => { input.checked = false; });

  document.querySelectorAll(".bmi-opt").forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll(".check-opt").forEach((el) =>
    el.classList.remove("comorbid-checked", "contra-checked", "hist-checked")
  );

  ["r-lifestyle", "r-meds", "r-surgery"].forEach((id) => {
    document.getElementById(id).className = "result-item";
  });

  document.getElementById("r-lifestyle").innerHTML = `<div class="ri-head"><span class="ri-dot gray"></span><span class="ri-name">Lifestyle medicine</span></div><p class="ri-note">Choose a BMI category to begin.</p>`;
  document.getElementById("r-meds").innerHTML      = `<div class="ri-head"><span class="ri-dot gray"></span><span class="ri-name">Anti-obesity medication</span></div><p class="ri-note">Medication guidance updates once BMI and comorbidities are selected.</p>`;
  document.getElementById("r-surgery").innerHTML   = `<div class="ri-head"><span class="ri-dot gray"></span><span class="ri-name">Bariatric surgery</span></div><p class="ri-note">Surgical guidance updates once BMI and history are selected.</p>`;
}

document.getElementById("reset-qualifier").addEventListener("click", resetQualifier);
document.getElementById("back-btn").addEventListener("click", resetZoom);


// resizing map

// Re-renders the map if the window is resized
window.addEventListener("resize", () => {
  if (!mapInitialized || !cachedTopology) return;
  renderMap(cachedTopology);
  repaintMap();

  // If a state was zoomed in, re-trigger that zoom at the new size
  if (activeStateFips && statePaths) {
    const targetDatum = statePaths.data().find(
      (sd) => String(sd.id).padStart(2, "0") === activeStateFips
    );
    if (targetDatum) { onStateClick({ stopPropagation() {} }, targetDatum); return; }
  }

  resetZoom();
});
