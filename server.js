const dgram = require("dgram");
const express = require("express");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");

// ===== UDP =====
const UDP_PORT = 5000;
const PACKET_SIZE = 53;
const CONTROL_FIELDS = [
  { name: "enable_stream", type: "u16" },
  { name: "roll_kp", type: "f32" },
  { name: "roll_ki", type: "f32" },
  { name: "roll_kd", type: "f32" },
  { name: "pitch_kp", type: "f32" },
  { name: "pitch_ki", type: "f32" },
  { name: "pitch_kd", type: "f32" },
  { name: "target_roll", type: "f32" },
  { name: "target_pitch", type: "f32" }
];
// 2 bytes (u16) + 8 * 4 bytes (float)
const CONTROL_PACKET_SIZE = 2 + 8 * 4;

const udp = dgram.createSocket("udp4");
let lastTelemetrySender = null;
/** 最後にブロードキャストしたテレメトリJSON（新規WS接続時に送る） */
let lastTelemetryJson = null;

// ===== CSV Logging =====
const DEFAULT_CSV_DIR = "logs";
const CSV_HEADER =
  "timestamp_iso,stamp_ms,sbus_1,sbus_2,sbus_3,sbus_4,sbus_5,sbus_6,sbus_7,sbus_8," +
  "flight_state,roll,pitch,yaw,ax,ay,az," +
  "servo_aileron,servo_elevator,servo_rudder,servo_throttle,servo_gear";
let csvLoggingPath = null;

// ===== Web =====
const app = express();
const server = app.listen(3000, () => {
  console.log("HTTP http://localhost:3000");
});

app.use(express.json());
app.use(express.static("public"));

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  if (lastTelemetryJson && ws.readyState === WebSocket.OPEN) {
    ws.send(lastTelemetryJson);
  }
});

function dataToCsvRow(data) {
  const ts = new Date().toISOString();
  const sbus = Array.isArray(data.sbus_data) ? data.sbus_data : [];
  const sbusCols = Array.from({ length: 8 }, (_, i) => sbus[i] ?? "");
  const nums = [
    data.stamp_ms,
    ...sbusCols,
    data.flight_state,
    data.roll, data.pitch, data.yaw,
    data.ax, data.ay, data.az,
    data.servo_aileron, data.servo_elevator, data.servo_rudder,
    data.servo_throttle, data.servo_gear
  ];
  return ts + "," + nums.map(v => v === null || v === undefined ? "" : String(v)).join(",") + "\n";
}

function appendCsvRow(data) {
  if (!csvLoggingPath) return;
  const row = dataToCsvRow(data);
  fs.appendFile(csvLoggingPath, row, (err) => {
    if (err) console.error("CSV append failed:", err);
  });
}

function parseUDPSendData(buf) {
  let o = 0;

  const stamp_ms = buf.readUInt16LE(o); o += 2;

  const sbus_data = [];
  for (let i = 0; i < 8; i++) {
    sbus_data.push(buf.readUInt16LE(o));
    o += 2;
  }

  const flight_state = buf.readUInt8(o); o += 1;

  const roll  = buf.readFloatLE(o); o += 4;
  const pitch = buf.readFloatLE(o); o += 4;
  const yaw   = buf.readFloatLE(o); o += 4;
  const ax   = buf.readFloatLE(o); o += 4;
  const ay   = buf.readFloatLE(o); o += 4;
  const az   = buf.readFloatLE(o); o += 4;

  const servo_aileron  = buf.readInt16LE(o); o += 2;
  const servo_elevator = buf.readInt16LE(o); o += 2;
  const servo_rudder   = buf.readInt16LE(o); o += 2;
  const servo_throttle = buf.readInt16LE(o); o += 2;
  const servo_gear     = buf.readInt16LE(o); o += 2;

  const sanitize = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    stamp_ms,
    sbus_data,
    flight_state,
    roll: sanitize(roll),
    pitch: sanitize(pitch),
    yaw: sanitize(yaw),
    ax: sanitize(ax),
    ay: sanitize(ay),
    az: sanitize(az),
    servo_aileron,
    servo_elevator,
    servo_rudder,
    servo_throttle,
    servo_gear
  };
}

udp.on("message", (msg, rinfo) => {
  if (msg.length !== PACKET_SIZE) return;

  lastTelemetrySender = { address: rinfo.address, port: rinfo.port };

  const data = parseUDPSendData(msg);
  const json = JSON.stringify(data);
  lastTelemetryJson = json;

  appendCsvRow(data);

  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  });
});

udp.bind(UDP_PORT, () => {
  console.log("UDP listening on", UDP_PORT);
});

function isUint16(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function buildControlBuffer(payload) {
  const buf = Buffer.allocUnsafe(CONTROL_PACKET_SIZE);
  let offset = 0;
  CONTROL_FIELDS.forEach((field) => {
    if (field.type === "u16") {
      buf.writeUInt16LE(payload[field.name], offset);
      offset += 2;
    } else if (field.type === "f32") {
      buf.writeFloatLE(payload[field.name], offset);
      offset += 4;
    }
  });
  return buf;
}

function isValidPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffff;
}

function isValidIPv4(address) {
  if (typeof address !== "string") return false;
  const parts = address.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every(part => {
    if (part === "" || part.length > 3) return false;
    if (!/^[0-9]+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// ===== CSV Logging API =====
app.get("/api/csv/status", (req, res) => {
  res.json({
    logging: !!csvLoggingPath,
    path: csvLoggingPath
  });
});

app.post("/api/csv/start", (req, res) => {
  if (csvLoggingPath) {
    return res.status(400).json({ error: "CSV logging already started.", path: csvLoggingPath });
  }
  const dir = typeof req.body?.dir === "string" && req.body.dir.trim() !== ""
    ? req.body.dir.trim()
    : DEFAULT_CSV_DIR;
  const base = path.resolve(process.cwd(), dir);
  try {
    if (!fs.existsSync(base)) {
      fs.mkdirSync(base, { recursive: true });
    }
    const name = `telemetry_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    csvLoggingPath = path.join(base, name);
    fs.writeFileSync(csvLoggingPath, CSV_HEADER + "\n", "utf8");
    console.log("CSV logging started:", csvLoggingPath);
    res.json({ ok: true, path: csvLoggingPath });
  } catch (err) {
    console.error("CSV start failed:", err);
    res.status(500).json({ error: "Failed to start CSV logging.", message: err.message });
  }
});

app.post("/api/csv/stop", (req, res) => {
  if (!csvLoggingPath) {
    return res.status(400).json({ error: "CSV logging is not started." });
  }
  const stopped = csvLoggingPath;
  csvLoggingPath = null;
  console.log("CSV logging stopped:", stopped);
  res.json({ ok: true, path: stopped });
});

app.post("/api/control", (req, res) => {
  const payload = {};
  for (const field of CONTROL_FIELDS) {
    const raw = req.body[field.name];
    const value = Number(raw);
    if (field.type === "u16") {
      if (!isUint16(value)) {
        return res.status(400).json({ error: `Invalid value for ${field.name}` });
      }
    } else if (field.type === "f32") {
      if (!isFiniteNumber(value)) {
        return res.status(400).json({ error: `Invalid value for ${field.name}` });
      }
    }
    payload[field.name] = value;
  }

  const buffer = buildControlBuffer(payload);

  let targetAddress = typeof req.body.target_ip === "string" && req.body.target_ip.trim() !== ""
    ? req.body.target_ip.trim()
    : null;
  if (targetAddress && !isValidIPv4(targetAddress)) {
    return res.status(400).json({ error: "Invalid IPv4 address." });
  }

  const providedPort = req.body.target_port !== undefined ? Number(req.body.target_port) : null;
  if (providedPort !== null && !isValidPort(providedPort)) {
    return res.status(400).json({ error: "Invalid UDP port." });
  }

  let targetPort = providedPort;

  if (!targetAddress && lastTelemetrySender) {
    targetAddress = lastTelemetrySender.address;
  }
  if (targetPort === null && lastTelemetrySender) {
    targetPort = lastTelemetrySender.port;
  }

  if (!targetAddress || targetPort === null) {
    return res.status(400).json({ error: "No UDP target available." });
  }

  udp.send(
    buffer,
    0,
    buffer.length,
    targetPort,
    targetAddress,
    (err) => {
      if (err) {
        console.error("UDP send failed", err);
        return res.status(500).json({ error: "UDP send failed" });
      }
      res.json({ ok: true });
    }
  );
});
