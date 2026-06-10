# Phimai SmartFlow AI

ระบบ FastAPI สำหรับรันบนเครื่อง local ที่เข้าถึงกล้อง RTSP ได้ แล้วเปิดลิงก์สาธารณะด้วย ngrok

## โครงสร้าง

```text
RTSP Cameras
  -> server.py บนเครื่อง local
  -> YOLO นับคน
  -> Dashboard + กราฟย้อนหลัง + LINE Notifications
  -> เปิดให้คนอื่นเข้าผ่าน ngrok
```

โหมดนี้ไม่ต้องใช้ Render, PostgreSQL, Blueprint, หรือ cloud deploy ใด ๆ

## ติดตั้ง

```bash
pip install -r requirements.txt
```

ต้องมีไฟล์โมเดล:

```text
yolov8m.pt
```

## ตั้งค่ากล้อง

วิธีที่ 1: ตั้งผ่าน environment variables

```bash
set CAMERA_MAIN_PRANG_RTSP_URL=rtsp://user:password@camera-ip:554/stream2
set CAMERA_SOUTH_GOPURA_RTSP_URL=rtsp://user:password@second-camera-ip:554/stream2
```

วิธีที่ 2: เปิดหน้า staff แล้วแก้ในแผง “ตั้งค่ากล้อง”

ระบบจะบันทึกลงไฟล์ local:

```text
camera_config.json
```

ถ้าเพิ่งแก้ RTSP URL แนะนำ restart `server.py` หนึ่งครั้งเพื่อให้ worker เปิดกล้องด้วยค่าใหม่

## รันเว็บ

```bash
python server.py
```

เปิดเว็บ:

```text
http://localhost:8000/
```

หน้าเจ้าหน้าที่:

```text
http://localhost:8000/staff/
```

หน้าดูกล้อง:

```text
http://localhost:8000/camera.html
```

รหัส staff เริ่มต้น:

```text
1234
```

## เปิดผ่าน ngrok

เปิด terminal อีกหน้าหนึ่ง:

```bash
ngrok http 8000
```

ngrok จะให้ URL เช่น:

```text
https://xxxx-xx-xx-xx.ngrok-free.app
```

เอา URL นี้ไปเปิด:

```text
https://xxxx-xx-xx-xx.ngrok-free.app/
https://xxxx-xx-xx-xx.ngrok-free.app/staff/
https://xxxx-xx-xx-xx.ngrok-free.app/camera.html
```

## LINE Notifications

ตั้งค่า token:

```bash
set LINE_CHANNEL_ACCESS_TOKEN=your-line-token
```

ถ้ารู้ target id แล้ว:

```bash
set LINE_TARGET_ID=your-group-or-user-id
```

ถ้าต้องการให้ระบบจำ target id จาก webhook ให้ตั้ง webhook URL ใน LINE Developers เป็น:

```text
https://xxxx-xx-xx-xx.ngrok-free.app/api/line/webhook
```

จากนั้นส่งข้อความหา bot หนึ่งครั้ง ระบบจะบันทึก target ลง `line_alert_config.json`

เมื่อกล้องนับคนได้มากกว่าหรือเท่ากับค่า `limit` ของกล้อง ระบบจะส่ง LINE อัตโนมัติ โดยข้อความจะระบุ:

- ชื่อกล้อง/จุดตรวจ
- จำนวนคนปัจจุบัน
- ขีดจำกัดที่ตั้งไว้
- เวลาแจ้งเตือน

ค่า `limit` แก้ได้จากหน้า staff ในแผง “ตั้งค่ากล้อง” ระบบมี cooldown กันส่งซ้ำถี่เกินไป ค่าเริ่มต้นคือ 300 วินาที:

```bash
set LINE_ALERT_COOLDOWN_SECONDS=300
```

ทดสอบว่า LINE ใช้ได้จากปุ่ม “ทดสอบ LINE” บนหน้า staff ได้เลย

## กราฟย้อนหลัง

ระบบอ่านจากไฟล์:

```text
visitor_history_log.csv
```

เมื่อกล้องส่งจำนวนคนใหม่ ระบบจะบันทึกจำนวนลง CSV แล้ว dashboard จะใช้ข้อมูลนี้ทำกราฟ:

- ราย 10 นาที
- รายชั่วโมง
- รายวัน
- รายเดือน
- รายปี

## ไฟล์ local ที่ไม่ควร commit

```text
camera_config.json
line_alert_config.json
line_last_webhook.json
visitor_history_log.csv
*.pt
```
