const dgram = require("dgram");
const server = dgram.createSocket("udp4");

const PORT = 5000;
const PACKET_SIZE = 53;

server.on("message", (msg, rinfo) => {
  if (msg.length !== PACKET_SIZE) {
    console.warn("size mismatch:", msg.length);
    return;
  }

  let offset = 0;

  const stamp_ms = msg.readUInt16LE(offset); offset += 2;

  const sbus_data = [];
  for (let i = 0; i < 8; i++) {
    sbus_data.push(msg.readUInt16LE(offset));
    offset += 2;
  }

  const sbus_connection = msg.readUInt8(offset); offset += 1;

  const roll  = msg.readFloatLE(offset); offset += 4;
  const pitch = msg.readFloatLE(offset); offset += 4;
  const yaw   = msg.readFloatLE(offset); offset += 4;
  const ax   = msg.readFloatLE(offset); offset += 4;
  const ay   = msg.readFloatLE(offset); offset += 4;
  const az   = msg.readFloatLE(offset); offset += 4;

  const servo_aileron  = msg.readInt16LE(offset); offset += 2;
  const servo_elevator = msg.readInt16LE(offset); offset += 2;
  const servo_rudder   = msg.readInt16LE(offset); offset += 2;
  const servo_throttle = msg.readInt16LE(offset); offset += 2;
  const servo_gear     = msg.readInt16LE(offset); offset += 2;

  console.log({
    stamp_ms,
    sbus_data,
    sbus_connection: !!sbus_connection,
    roll,
    pitch,
    yaw,
    ax,
    ay,
    az,
    servo_aileron,
    servo_elevator,
    servo_rudder,
    servo_throttle,
    servo_gear
  });
});

server.bind(PORT, () => {
  console.log(`UDP listening on ${PORT}`);
});

function deg2rad(deg) {
  return deg * Math.PI / 180;
}