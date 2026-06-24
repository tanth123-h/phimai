import os
import platform
import subprocess
import time
import threading
import logging

# กำหนดตัวสแตนดาร์ดล็อกเกอร์สำหรับโมดูล VPN
logger = logging.getLogger("smartflow.vpn")

class VPNManager:
    """
    คลาสสำหรับจัดการการเชื่อมต่อ VPN อัตโนมัติ (Automated VPN Connection)
    รองรับ WireGuard, OpenVPN, Tailscale และตรวจสอบสถานะกล้องผ่านการ Ping
    """
    def __init__(self):
        # โหลดค่าตั้งค่าจาก Environment Variables
        self.vpn_type = os.getenv("VPN_TYPE", "none").strip().lower()
        self.config_path = os.getenv("VPN_CONFIG_PATH", "").strip()
        self.check_ip = os.getenv("VPN_CHECK_IP", "").strip()
        self.auto_connect = os.getenv("VPN_AUTO_CONNECT", "true").strip().lower() in {"1", "true", "yes", "on"}
        
        try:
            self.check_interval = int(os.getenv("VPN_CHECK_INTERVAL_SECONDS", "10"))
        except ValueError:
            self.check_interval = 10

        # ตัวแปรสถานะภายในคลาส
        self.openvpn_process = None
        self.is_monitoring = False
        self.monitor_thread = None
        
        # ใช้ Event สำหรับควบคุมเธรดการทำงานของกล้อง (เมื่อ VPN ทำงานจะทำการ Set Event)
        self.connection_event = threading.Event()
        
        # หากปิดการใช้งาน VPN หรือเป็น 'none' ให้เปิดสถานะเชื่อมต่อเริ่มต้นไว้ตลอดเวลา
        if self.vpn_type == "none":
            self.connection_event.set()

    def ping_host(self, host: str) -> bool:
        """
        ตรวจเช็กว่าโฮสต์เป้าหมาย (เช่น IP กล้อง) เชื่อมต่อได้หรือไม่ผ่านการ Ping (ICMP)
        """
        # ปรับอาร์กิวเมนต์ตามระบบปฏิบัติการ Windows หรือ Linux
        is_windows = platform.system().lower() == "windows"
        param = "-n" if is_windows else "-c"
        timeout_param = "-w" if is_windows else "-W"
        timeout_val = "1000" if is_windows else "1"
        
        command = ["ping", param, "1", timeout_param, timeout_val, host]
        try:
            # รันคำสั่งเช็กและซ่อนเอาต์พุต
            result = subprocess.run(
                command, 
                stdout=subprocess.DEVNULL, 
                stderr=subprocess.DEVNULL
            )
            return result.returncode == 0
        except Exception as exc:
            logger.debug("Ping failed: %s", exc)
            return False

    def connect(self):
        """
        สั่งเริ่มเชื่อมต่อ VPN ตามประเภทที่เลือก
        """
        if self.vpn_type == "none":
            return
            
        logger.info("กำลังเรียกใช้คำสั่งเพื่อเชื่อมต่อ VPN (%s)...", self.vpn_type)
        is_windows = platform.system().lower() == "windows"
        
        try:
            if self.vpn_type == "wireguard":
                if is_windows:
                    # คำสั่งสำหรับ Windows: ใช้ wireguard.exe เพื่อเปิดใช้งานอุโมงค์ VPN (Tunnel)
                    # โดย config_path ในกรณีนี้จะระบุชื่ออุโมงค์ (Tunnel Name) เช่น wg0
                    cmd = ["wireguard.exe", "/activate-tunnel", self.config_path]
                else:
                    # คำสั่งสำหรับ Linux/macOS
                    cmd = ["wg-quick", "up", self.config_path]
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                logger.info("ส่งคำสั่งเชื่อมต่อ WireGuard แล้ว")

            elif self.vpn_type == "openvpn":
                # สำหรับ OpenVPN จะใช้วิธีเปิดโปรเซสทำงานเบื้องหลังด้วยไฟล์ .ovpn
                if not self.config_path:
                    logger.warning("ไม่ได้ระบุไฟล์คอนฟิก .ovpn ใน VPN_CONFIG_PATH")
                    return
                if self.openvpn_process is None or self.openvpn_process.poll() is not None:
                    cmd = ["openvpn", "--config", self.config_path]
                    self.openvpn_process = subprocess.Popen(
                        cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    logger.info("เริ่มรันโปรเซส OpenVPN ในเบื้องหลัง")

            elif self.vpn_type == "tailscale":
                # คำสั่งเปิดใช้งาน Tailscale
                cmd = ["tailscale", "up"]
                if self.config_path:
                    # หากมีอาร์กิวเมนต์เพิ่มเติมเช่น --authkey
                    cmd.extend(self.config_path.split())
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                logger.info("ส่งคำสั่ง Tailscale up แล้ว")
                
                # เพิ่ม Route พิเศษสำหรับชี้ไอพีกล้องตัวที่ 2 ไปยังอแดปเตอร์ Tailscale (ต้องการสิทธิ์ Admin)
                try:
                    ts_ip = "100.109.59.93"
                    try:
                        ts_ip_res = subprocess.run(["tailscale", "ip", "-4"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
                        if ts_ip_res.returncode == 0 and ts_ip_res.stdout.strip():
                            ts_ip = ts_ip_res.stdout.strip()
                    except Exception as ts_err:
                        logger.debug("ไม่สามารถหา Tailscale IP แบบไดนามิกได้: %s", ts_err)

                    subprocess.run(["route", "add", self.check_ip, "mask", "255.255.255.255", ts_ip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    logger.info("ระบบลองแอด Route ชี้ %s ไปยัง Tailscale (%s) สำเร็จ (หากมีสิทธิ์ Admin)", self.check_ip, ts_ip)
                except Exception as e:
                    logger.debug("ไม่สามารถแอด Route ได้: %s", e)
                
        except Exception as exc:
            logger.error("เกิดข้อผิดพลาดในการเชื่อมต่อ VPN: %s", exc)

    def disconnect(self):
        """
        สั่งตัดการเชื่อมต่อ VPN แบบมีระบบเคลียร์ขยะ (Graceful Shutdown)
        """
        if self.vpn_type == "none":
            return
            
        logger.info("กำลังตัดการเชื่อมต่อ VPN (%s)...", self.vpn_type)
        is_windows = platform.system().lower() == "windows"
        
        try:
            if self.vpn_type == "wireguard":
                if is_windows:
                    cmd = ["wireguard.exe", "/deactivate-tunnel", self.config_path]
                else:
                    cmd = ["wg-quick", "down", self.config_path]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                logger.info("ปิดการใช้งาน WireGuard สำเร็จ")

            elif self.vpn_type == "openvpn":
                if self.openvpn_process and self.openvpn_process.poll() is None:
                    self.openvpn_process.terminate()
                    self.openvpn_process.wait(timeout=5)
                    self.openvpn_process = None
                    logger.info("ปิดโปรเซส OpenVPN เรียบร้อย")

            elif self.vpn_type == "tailscale":
                # ลบ Route พิเศษออกเพื่อคืนค่าเดิม
                try:
                    subprocess.run(["route", "delete", self.check_ip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except:
                    pass
                cmd = ["tailscale", "down"]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                logger.info("ปิดการทำงาน Tailscale (down) สำเร็จ")
                
        except Exception as exc:
            logger.error("เกิดข้อผิดพลาดขณะตัดการเชื่อมต่อ VPN: %s", exc)

    def _monitor_loop(self):
        """
        ฟังก์ชันลูปการตรวจสอบที่ทำงานอยู่เบื้องหลัง (Thread Loop)
        """
        logger.info("เริ่มเธรดการตรวจสอบสถานะเชื่อมต่อของกล้อง (%s)...", self.check_ip)
        
        while self.is_monitoring:
            reachable = self.ping_host(self.check_ip)
            
            if reachable:
                if not self.connection_event.is_set():
                    logger.info("✅ VPN/เน็ตเวิร์ก เชื่อมต่อสำเร็จ! สามารถสื่อสารกับกล้อง %s ได้แล้ว", self.check_ip)
                    self.connection_event.set()
            else:
                if self.connection_event.is_set():
                    logger.warning("⚠️ ขาดการติดต่อกับกล้อง %s (VPN อาจหลุด)", self.check_ip)
                    self.connection_event.clear()
                
                if self.auto_connect and self.vpn_type != "none":
                    logger.info("🔄 กำลังพยายามเชื่อมต่อ VPN ใหม่...")
                    self.connect()
            
            # หน่วงเวลาเพื่อตรวจสอบตามระยะเวลาที่กำหนด
            for _ in range(self.check_interval):
                if not self.is_monitoring:
                    break
                time.sleep(1)

    def start_monitoring(self):
        """
        เปิดใช้งานระบบตรวจสอบเบื้องหลัง (เริ่ม Thread)
        """
        if self.vpn_type == "none":
            self.connection_event.set()
            logger.info("VPN_TYPE คือ none: ข้ามการรันระบบตรวจสอบ VPN")
            return

        if not self.check_ip:
            self.connection_event.set()
            logger.warning("VPN_CHECK_IP is empty; skipping VPN reachability monitor")
            return

        if self.is_monitoring:
            return
            
        self.is_monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("ระบบตรวจสอบความพร้อม VPN เริ่มต้นทำงานแล้ว")

    def stop_monitoring(self):
        """
        หยุดการทำงานของระบบตรวจสอบและตัดการเชื่อมต่อ VPN
        """
        logger.info("กำลังสั่งปิดระบบตรวจสอบ VPN...")
        self.is_monitoring = False
        
        if self.monitor_thread:
            self.monitor_thread.join(timeout=3)
            self.monitor_thread = None
            
        self.disconnect()
        self.connection_event.clear()
        
        # หากตั้งค่าเป็น none ให้เปิด Event กลับคืนเพื่อไม่บล็อกเธรดกล้องหลังปิดการทำงาน
        if self.vpn_type == "none":
            self.connection_event.set()
        logger.info("ระบบตรวจสอบ VPN หยุดทำงานสมบูรณ์")
