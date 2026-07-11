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

กลุ่ม LINE พ่อค้าแม่ค้า:

```bash
set LINE_VENDOR_TARGET_ID=your-vendor-group-id
```

ถ้ายังไม่รู้ group id ให้เชิญ LINE bot เข้ากลุ่มพ่อค้าแม่ค้า แล้วส่งข้อความ `vendor` ในกลุ่ม 1 ครั้ง
ระบบจะบันทึกเป็น `vendor_target_id` ใน `line_alert_config.json` ให้อัตโนมัติ

ถ้าต้องการให้ระบบจำ target id จาก webhook ให้ตั้ง webhook URL ใน LINE Developers เป็น:

```text
https://xxxx-xx-xx-xx.ngrok-free.app/api/line/webhook
```

จากนั้นส่งข้อความหา bot หนึ่งครั้ง ระบบจะบันทึก target ลง `line_alert_config.json`

เมื่อกล้องนับคนได้มากกว่าค่า `limit` ของกล้อง ระบบจะส่ง LINE อัตโนมัติไปทั้งกลุ่มเจ้าหน้าที่และกลุ่มพ่อค้าแม่ค้า โดยข้อความจะระบุ:

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

## Supabase PostgreSQL

For a more professional visitor history store, set `DATABASE_URL` to your Supabase PostgreSQL connection string.
When `DATABASE_URL` is set, the backend writes visitor counts to PostgreSQL and still keeps `visitor_history_log.csv`
as a local backup.

The backend automatically creates this table on startup:

```sql
CREATE TABLE IF NOT EXISTS visitor_counts (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zone_id TEXT NOT NULL,
  zone_name TEXT,
  people_count INTEGER NOT NULL,
  limit_count INTEGER,
  density TEXT,
  online BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Set the database URL in `.env`:

```env
DATABASE_URL=postgresql://postgres.your-project-ref:your-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Migrate old CSV history into Supabase:

```powershell
python scripts/migrate_visitor_csv_to_postgres.py
```

Check the active storage mode:

```text
http://localhost:8000/healthz
```

`database` will show `postgresql` when Supabase is connected, otherwise `csv`.

เมื่อกล้องส่งจำนวนคนใหม่ ระบบจะบันทึกจำนวนลง PostgreSQL ถ้าตั้ง `DATABASE_URL` ไว้ และยังบันทึกลง CSV เป็น backup แล้ว dashboard จะใช้ข้อมูลนี้ทำกราฟ:

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
