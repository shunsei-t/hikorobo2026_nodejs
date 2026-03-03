# install
```
npm install
```

# run

```
node server.js
```

# CSV Log

UDP で受信したテレメトリを CSV に保存できます。

- 画面の「CSV Log」で **Start** を押すと記録開始（`logs/telemetry_YYYY-MM-DDTHH-mm-ss.csv` に保存）
- **Stop** で記録停止
- API: `GET /api/csv/status`、`POST /api/csv/start`（body: `{ "dir": "logs" }`）、`POST /api/csv/stop`

# CSV の可視化

保存した CSV をグラフ表示する:

```
node view_csvdata.js logs/telemetry_2026-02-28T12-30-00.csv
```

同じフォルダに `*_view.html` が生成され、既定のブラウザで開きます。Roll/Pitch/Yaw・加速度・SBUS・サーボの 4 つのグラフを表示します。

# data protcol

## ESP32
```
struct UDPSendDataStruct {
  uint16_t stamp_ms;
  uint16_t sbus_data[8];
  uint8_t flight_state;
  float roll, pitch, yaw;
  float ax, ay, az;
  int16_t servo_aileron, servo_elevator, servo_rudder, servo_throttle, servo_gear;
} __attribute__((packed));
```

```
struct UDPReceiveDataStruct {
  uint16_t enable_stream;
  float roll_kp;
  float roll_ki;
  float roll_kd;
  float pitch_kp;
  float pitch_ki;
  float pitch_kd;
  float target_roll, target_pitch;
} __attribute__((packed));
```