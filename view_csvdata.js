const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const CSV_HEADERS = [
  "timestamp_iso", "stamp_ms",
  "sbus_1", "sbus_2", "sbus_3", "sbus_4", "sbus_5", "sbus_6", "sbus_7", "sbus_8",
  "flight_state", "roll", "pitch", "yaw", "ax", "ay", "az",
  "servo_aileron", "servo_elevator", "servo_rudder", "servo_throttle", "servo_gear"
];

const NUMERIC_KEYS = new Set([
  "stamp_ms", "sbus_1", "sbus_2", "sbus_3", "sbus_4", "sbus_5", "sbus_6", "sbus_7", "sbus_8",
  "flight_state", "roll", "pitch", "yaw", "ax", "ay", "az",
  "servo_aileron", "servo_elevator", "servo_rudder", "servo_throttle", "servo_gear"
]);

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((h, j) => {
      let val = values[j] === undefined || values[j] === "" ? null : values[j];
      if (NUMERIC_KEYS.has(h) && val !== null) {
        const n = Number(val);
        row[h] = Number.isFinite(n) ? n : null;
      } else {
        row[h] = val;
      }
    });
    rows.push(row);
  }
  return { headers, rows };
}

function buildHtml(csvPath, rows) {
  const labels = rows.map((_, i) => i + 1);
  const timestamps = rows.map((r) => r.timestamp_iso ?? "");
  const roll = rows.map((r) => r.roll ?? null);
  const pitch = rows.map((r) => r.pitch ?? null);
  const yaw = rows.map((r) => r.yaw ?? null);
  const ax = rows.map((r) => r.ax ?? null);
  const ay = rows.map((r) => r.ay ?? null);
  const az = rows.map((r) => r.az ?? null);
  const sbus = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    rows.map((r) => r[`sbus_${i}`] ?? null)
  );
  const servoA = rows.map((r) => r.servo_aileron ?? null);
  const servoE = rows.map((r) => r.servo_elevator ?? null);
  const servoR = rows.map((r) => r.servo_rudder ?? null);
  const servoT = rows.map((r) => r.servo_throttle ?? null);
  const servoG = rows.map((r) => r.servo_gear ?? null);

  const title = path.basename(csvPath);
  const dataJson = JSON.stringify({
    labels,
    timestamps,
    roll,
    pitch,
    yaw,
    ax,
    ay,
    az,
    sbus,
    servoA,
    servoE,
    servoR,
    servoT,
    servoG
  });

  const firstTs = timestamps[0] || "";
  const lastTs = timestamps[timestamps.length - 1] || "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; background: #fff; color: #333; }
    h1 { font-size: 18px; margin-bottom: 12px; }
    .controls { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-end; margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px; border: 1px solid #ddd; }
    .control-group { display: flex; flex-direction: column; gap: 4px; }
    .control-group label { font-size: 12px; color: #555; }
    .control-group input { padding: 4px 8px; width: 180px; }
    .control-group button { padding: 6px 12px; cursor: pointer; }
    .chart-wrap { margin-bottom: 24px; }
    .chart-wrap canvas { max-width: 100%; }
    .chart-wrap.hidden { display: none; }
    #sliceStatus { font-size: 13px; color: #666; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h1>${escapeHtml(title)} (${rows.length} samples)</h1>
  <div class="controls">
    <div class="control-group">
      <label>表示するグラフ</label>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <label><input type="checkbox" id="cbRpy" checked> Roll/Pitch/Yaw</label>
        <label><input type="checkbox" id="cbAcc" checked> 加速度</label>
        <label><input type="checkbox" id="cbSbus" checked> SBUS</label>
        <label><input type="checkbox" id="cbServo" checked> サーボ</label>
      </div>
    </div>
    <div class="control-group">
      <label>タイムスタンプで切り出し（ISO形式）</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="fromTime" placeholder="開始 (例: ${firstTs.slice(0, 19)}" title="開始日時">
        <span>～</span>
        <input type="text" id="toTime" placeholder="終了 (例: ${lastTs.slice(0, 19)}" title="終了日時">
        <button type="button" id="btnApplyTime">適用</button>
      </div>
    </div>
    <div class="control-group">
      <label>サンプル番号で切り出し（1～${rows.length}）</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="number" id="fromIndex" min="1" max="${rows.length}" value="1" style="width: 80px;">
        <span>～</span>
        <input type="number" id="toIndex" min="1" max="${rows.length}" value="${rows.length}" style="width: 80px;">
        <button type="button" id="btnApplyIndex">適用</button>
      </div>
    </div>
    <button type="button" id="btnReset">全体を表示</button>
    <span id="sliceStatus"></span>
  </div>
  <div class="chart-wrap" id="wrapRpy" data-chart="rpy"><canvas id="rpyChart" width="800" height="220"></canvas></div>
  <div class="chart-wrap" id="wrapAcc" data-chart="acc"><canvas id="accChart" width="800" height="220"></canvas></div>
  <div class="chart-wrap" id="wrapSbus" data-chart="sbus"><canvas id="sbusChart" width="800" height="220"></canvas></div>
  <div class="chart-wrap" id="wrapServo" data-chart="servo"><canvas id="servoChart" width="800" height="220"></canvas></div>
  <script>
    const full = ${dataJson};
    const N = full.labels.length;
    let fromIdx = 0;
    let toIdx = N - 1;

    const opts = { animation: false, responsive: true, maintainAspectRatio: true };
    const scale = { y: { min: -180, max: 180 }, x: { display: true } };
    const sbusColors = ["#e63946","#f4a261","#2a9d8f","#264653","#e9c46a","#457b9d","#9b5de5","#00bbf9"];

    function sliceData() {
      const labels = full.labels.slice(fromIdx, toIdx + 1);
      return {
        labels,
        roll: full.roll.slice(fromIdx, toIdx + 1),
        pitch: full.pitch.slice(fromIdx, toIdx + 1),
        yaw: full.yaw.slice(fromIdx, toIdx + 1),
        ax: full.ax.slice(fromIdx, toIdx + 1),
        ay: full.ay.slice(fromIdx, toIdx + 1),
        az: full.az.slice(fromIdx, toIdx + 1),
        sbus: full.sbus.map(arr => arr.slice(fromIdx, toIdx + 1)),
        servoA: full.servoA.slice(fromIdx, toIdx + 1),
        servoE: full.servoE.slice(fromIdx, toIdx + 1),
        servoR: full.servoR.slice(fromIdx, toIdx + 1),
        servoT: full.servoT.slice(fromIdx, toIdx + 1),
        servoG: full.servoG.slice(fromIdx, toIdx + 1)
      };
    }

    function updateSliceStatus() {
      const el = document.getElementById("sliceStatus");
      if (fromIdx === 0 && toIdx === N - 1) {
        el.textContent = "全サンプル表示";
      } else {
        el.textContent = "表示: サンプル " + (fromIdx + 1) + " ～ " + (toIdx + 1) + " (" + (toIdx - fromIdx + 1) + " 件)";
      }
    }

    const charts = {};

    function updateCharts() {
      const d = sliceData();
      if (charts.rpy) {
        charts.rpy.data.labels = d.labels;
        charts.rpy.data.datasets[0].data = d.roll;
        charts.rpy.data.datasets[1].data = d.pitch;
        charts.rpy.data.datasets[2].data = d.yaw;
        charts.rpy.update("none");
      }
      if (charts.acc) {
        charts.acc.data.labels = d.labels;
        charts.acc.data.datasets[0].data = d.ax;
        charts.acc.data.datasets[1].data = d.ay;
        charts.acc.data.datasets[2].data = d.az;
        charts.acc.update("none");
      }
      if (charts.sbus) {
        charts.sbus.data.labels = d.labels;
        d.sbus.forEach((arr, i) => { charts.sbus.data.datasets[i].data = arr; });
        charts.sbus.update("none");
      }
      if (charts.servo) {
        charts.servo.data.labels = d.labels;
        charts.servo.data.datasets[0].data = d.servoA;
        charts.servo.data.datasets[1].data = d.servoE;
        charts.servo.data.datasets[2].data = d.servoR;
        charts.servo.data.datasets[3].data = d.servoT;
        charts.servo.data.datasets[4].data = d.servoG;
        charts.servo.update("none");
      }
      document.getElementById("fromIndex").value = fromIdx + 1;
      document.getElementById("toIndex").value = toIdx + 1;
      updateSliceStatus();
    }

    charts.rpy = new Chart(document.getElementById("rpyChart"), {
      type: "line",
      data: {
        labels: full.labels,
        datasets: [
          { label: "Roll",  data: full.roll,  borderColor: "#f94144", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Pitch", data: full.pitch, borderColor: "#43aa8b", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Yaw",   data: full.yaw,   borderColor: "#577590", fill: false, tension: 0.2, pointRadius: 0 }
        ]
      },
      options: { ...opts, scales: { ...scale, y: { ...scale.y, title: { display: true, text: "deg" } } } }
    });
    charts.acc = new Chart(document.getElementById("accChart"), {
      type: "line",
      data: {
        labels: full.labels,
        datasets: [
          { label: "ax", data: full.ax, borderColor: "#f94144", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "ay", data: full.ay, borderColor: "#43aa8b", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "az", data: full.az, borderColor: "#577590", fill: false, tension: 0.2, pointRadius: 0 }
        ]
      },
      options: { ...opts, scales: { y: { min: -20, max: 20 }, x: { display: true } } }
    });
    charts.sbus = new Chart(document.getElementById("sbusChart"), {
      type: "line",
      data: {
        labels: full.labels,
        datasets: full.sbus.map((arr, i) => ({
          label: "CH" + (i+1),
          data: arr,
          borderColor: sbusColors[i],
          fill: false,
          tension: 0.2,
          pointRadius: 0
        }))
      },
      options: { ...opts, scales: { y: { min: 0, max: 2048 }, x: { display: true } } }
    });
    charts.servo = new Chart(document.getElementById("servoChart"), {
      type: "line",
      data: {
        labels: full.labels,
        datasets: [
          { label: "Aileron",  data: full.servoA, borderColor: "#f94144", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Elevator", data: full.servoE, borderColor: "#43aa8b", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Rudder",   data: full.servoR, borderColor: "#577590", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Throttle", data: full.servoT, borderColor: "#f9c74f", fill: false, tension: 0.2, pointRadius: 0 },
          { label: "Gear",     data: full.servoG, borderColor: "#90be6d", fill: false, tension: 0.2, pointRadius: 0 }
        ]
      },
      options: { ...opts, scales: { y: { min: 0, max: 180 }, x: { display: true } } }
    });

    document.getElementById("cbRpy").addEventListener("change", function() {
      document.getElementById("wrapRpy").classList.toggle("hidden", !this.checked);
    });
    document.getElementById("cbAcc").addEventListener("change", function() {
      document.getElementById("wrapAcc").classList.toggle("hidden", !this.checked);
    });
    document.getElementById("cbSbus").addEventListener("change", function() {
      document.getElementById("wrapSbus").classList.toggle("hidden", !this.checked);
    });
    document.getElementById("cbServo").addEventListener("change", function() {
      document.getElementById("wrapServo").classList.toggle("hidden", !this.checked);
    });

    function findIndexByTime(isoStr) {
      if (!isoStr || !isoStr.trim()) return -1;
      const t = new Date(isoStr.trim()).getTime();
      if (Number.isNaN(t)) return -1;
      for (let i = 0; i < full.timestamps.length; i++) {
        const ti = new Date(full.timestamps[i]).getTime();
        if (ti >= t) return i;
      }
      return full.timestamps.length - 1;
    }
    function findLastIndexByTime(isoStr) {
      if (!isoStr || !isoStr.trim()) return -1;
      const t = new Date(isoStr.trim()).getTime();
      if (Number.isNaN(t)) return -1;
      for (let i = full.timestamps.length - 1; i >= 0; i--) {
        const ti = new Date(full.timestamps[i]).getTime();
        if (ti <= t) return i;
      }
      return 0;
    }

    document.getElementById("btnApplyTime").addEventListener("click", function() {
      const fromStr = document.getElementById("fromTime").value.trim();
      const toStr = document.getElementById("toTime").value.trim();
      const i0 = fromStr ? findIndexByTime(fromStr) : 0;
      const i1 = toStr ? findLastIndexByTime(toStr) : N - 1;
      if (i0 < 0 || i1 < 0) {
        document.getElementById("sliceStatus").textContent = "無効な日時です。";
        return;
      }
      fromIdx = Math.max(0, Math.min(i0, i1));
      toIdx = Math.min(N - 1, Math.max(i0, i1));
      updateCharts();
    });

    document.getElementById("btnApplyIndex").addEventListener("click", function() {
      const a = parseInt(document.getElementById("fromIndex").value, 10);
      const b = parseInt(document.getElementById("toIndex").value, 10);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return;
      fromIdx = Math.max(0, Math.min(a, b) - 1);
      toIdx = Math.min(N - 1, Math.max(a, b) - 1);
      updateCharts();
    });

    document.getElementById("btnReset").addEventListener("click", function() {
      fromIdx = 0;
      toIdx = N - 1;
      document.getElementById("fromTime").value = "";
      document.getElementById("toTime").value = "";
      updateCharts();
    });

    updateSliceStatus();
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openBrowser(filePath) {
  const p = path.resolve(filePath);
  const cmd =
    process.platform === "win32"
      ? `start "" "${p}"`
      : process.platform === "darwin"
        ? `open "${p}"`
        : `xdg-open "${p}"`;
  exec(cmd, (err) => {
    if (err) console.warn("Could not open browser:", err.message);
  });
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node view_csvdata.js <path-to-csv>");
    console.error("Example: node view_csvdata.js logs/telemetry_2026-02-28T12-30-00.csv");
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error("File not found:", resolved);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, "utf8");
  const { rows } = parseCsv(content);
  if (rows.length === 0) {
    console.error("No data rows in CSV.");
    process.exit(1);
  }

  const outPath = path.join(
    path.dirname(resolved),
    path.basename(resolved, path.extname(resolved)) + "_view.html"
  );
  const html = buildHtml(resolved, rows);
  fs.writeFileSync(outPath, html, "utf8");
  console.log("Wrote:", outPath);
  console.log("Samples:", rows.length);
  openBrowser(outPath);
}

main();
