#!/usr/bin/env python3
"""
BHOOMI hub SMS service: Raspberry Pi 4 + 4G LTE modem (SIM7600 / A7670).

Both features are ON:
  1. Ask any time: a registered farmer texts HI (or STATUS, SOIL, POND, ALERTS,
     HELP) to the hub's SIM number and gets the live farm report back.
  2. Daily report: every morning at sms.daily_report_time (default 07:00) the
     hub sends the report to every number in sms.daily_report_numbers.
  Plus: a new CRITICAL alert is sent by SMS to all registered numbers.

Language: sms.language = en (plain SMS, 160 characters) or te / hi / ta / kn
(Unicode SMS, 70 characters each). The words come from the dashboard's own
translations, so screen, voice and SMS say the same thing.

Safety: SMS is read-only. Nobody can switch an aerator or pump by SMS.
Messages from unregistered numbers are ignored (no reply, no cost).

Data:   GET {hub_url}/api/state   (the same snapshot the dashboard shows)
Status: served for the dashboard at http://<pi>:{sms.status_port}/sms/status
        POST /sms/test {"number": "+91..."} sends a test SMS to a registered number

Run:  python3 sms_service.py --config /etc/bhoomi/hub.json
Test: python3 sms_service.py --dry-run --sample ../sample/state.alerts.sample.json [--lang ta]
"""
import argparse
import datetime as dt
import json
import logging
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bhoomi_common as bc

log = logging.getLogger("bhoomi-sms")
CTRL_Z = "\x1a"
COMMANDS = {"HI": "STATUS", "HII": "STATUS", "HELLO": "STATUS", "STATUS": "STATUS", "DATA": "STATUS",
            "LIVE": "STATUS", "REPORT": "STATUS", "VANAKKAM": "STATUS", "NAMASTE": "STATUS",
            "SOIL": "SOIL", "FIELD": "SOIL", "POND": "POND", "WATER": "POND",
            "ALERT": "ALERTS", "ALERTS": "ALERTS", "HELP": "HELP"}
MOIST = {"ok": "st_ok", "dry": "st_dry", "wet": "st_wet"}
DOST = {"ok": "st_ok", "watch": "st_watch", "low": "st_low", "critical": "st_critical", "invalid": "st_invalid"}
HELP_TEXT = ("BHOOMI: send HI for the full report, or SOIL, POND, ALERTS. "
             "REPORT ON / REPORT OFF = daily morning SMS.")


# ------------------------------------------------------------------ text
def parse_command(text):
    t = re.sub(r"[^A-Z ]", " ", (text or "").upper()).split()
    if len(t) >= 2 and t[0] == "REPORT" and t[1] in ("ON", "OFF"):
        return "REPORT_" + t[1]
    if t and t[0] == "STOP":
        return "REPORT_OFF"
    return COMMANDS.get(t[0], "STATUS") if t else "STATUS"   # anything else: full report


def stamp(state):
    ts = state.get("now") or time.time()
    return dt.datetime.fromtimestamp(ts, dt.timezone(dt.timedelta(hours=5, minutes=30))).strftime("%H:%M %d-%b")


def f1(v, d=1):
    return "-" if not isinstance(v, (int, float)) else f"{v:.{d}f}"


def pond_lines(state, L):
    out = []
    for n in (state.get("nodes") or {}).values():
        if n.get("type") != "POND":
            continue
        d, a = n.get("data") or {}, n.get("analysis") or {}
        if not n.get("online"):
            out.append(f"{bc.short(n['name'])}: {bc.t('offline_n', L)}")
            continue
        aer = bc.t("on" if d.get("AER") else "off", L)
        out.append(f"{bc.short(n['name'])} {bc.t('pond', L)}: DO {f1(d.get('DO'))} pH {f1(d.get('PH'))} "
                   f"{f1(d.get('WT'), 0)}C {bc.t('aerator', L)} {aer}/{bc.t(str(d.get('MODE', 'AUTO')).lower(), L)} "
                   f"{bc.t(DOST.get(a.get('do_status'), 'st_ok'), L)}")
    return out


def soil_lines(state, L):
    out = []
    for n in (state.get("nodes") or {}).values():
        if n.get("type") != "SOIL":
            continue
        a = n.get("analysis") or {}
        crop = bc.t("c_" + (n.get("crop") or "default"), L)
        if not n.get("online"):
            out.append(f"{bc.short(n['name'])} {crop}: {bc.t('offline_n', L)}")
            continue
        out.append(f"{bc.short(n['name'])} {crop}: {f1(a.get('root_moisture'), 0)}% "
                   f"{bc.t(MOIST.get(a.get('moist_status'), 'st_ok'), L)}")
    return out


def alert_lines(state, L, limit=4):
    al = [a for a in state.get("alerts", []) if a.get("level") in ("crit", "warn")]
    return [("!! " if a["level"] == "crit" else "! ") + bc.alert_text(state, a, L) for a in al[:limit]]


def advice_lines(state, L, limit=2):
    seen, out = set(), []
    for n in (state.get("nodes") or {}).values():
        adv = (n.get("analysis") or {}).get("advice")
        if adv and n.get("online"):
            txt = bc.advice_text(adv, L)
            if txt not in seen:
                seen.add(txt)
                out.append("> " + txt)
    return out[:limit]


def build_reply(cmd, state, L="en"):
    head = f"BHOOMI {stamp(state)}"
    if cmd == "POND":
        body = pond_lines(state, L)
    elif cmd == "SOIL":
        body = soil_lines(state, L)
    elif cmd == "ALERTS":
        body = alert_lines(state, L, 8) or [bc.t("all_ok", L)]
    else:
        body = pond_lines(state, L) + soil_lines(state, L) + (alert_lines(state, L) or [bc.t("all_ok", L)]) \
            + advice_lines(state, L)
    return "\n".join([head] + body)


ASCII_FIX = str.maketrans({"–": "-", "—": "-", "°": "", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", "·": "-"})


def plain(text):
    """Use plain characters so English SMS stays at 160 characters per part."""
    return text.translate(ASCII_FIX)


def is_gsm(text):
    return all(ord(c) < 128 for c in text)


def _wrap(line, room):
    out, cur = [], ""
    for w in line.split(" "):
        while len(w) > room:
            if cur:
                out.append(cur)
                cur = ""
            out.append(w[:room])
            w = w[room:]
        cand = f"{cur} {w}" if cur else w
        if len(cand) > room:
            out.append(cur)
            cur = w
        else:
            cur = cand
    if cur:
        out.append(cur)
    return out


def split_sms(text):
    """Split on line breaks into SMS parts: plain 160, Unicode 70 characters, numbered (1/3)."""
    if is_gsm(plain(text)):
        text = plain(text)
    room = (160 if is_gsm(text) else 70) - 7
    parts, cur = [], ""
    lines = [w for ln in text.split("\n") for w in (_wrap(ln, room) if len(ln) > room else [ln])]
    for ln in lines:
        cand = f"{cur}\n{ln}" if cur else ln
        if len(cand) > room:
            parts.append(cur)
            cur = ln
        else:
            cur = cand
    if cur:
        parts.append(cur)
    if len(parts) > 1:
        parts = [f"{p} ({i}/{len(parts)})" for i, p in enumerate(parts, 1)]
    return parts


def norm_number(n):
    d = re.sub(r"[^\d+]", "", n or "")
    if d.startswith("00"):
        d = "+" + d[2:]
    if len(d) == 10 and not d.startswith("+"):
        d = "+91" + d
    if len(d) == 12 and d.startswith("91"):
        d = "+" + d
    return d


def mask(n):
    return n[:6] + "***" + n[-2:] if len(n) > 8 else n


# ------------------------------------------------------------------ modem
class Modem:
    """Text-mode SMS over AT commands, plain (GSM) and Unicode (UCS2)."""

    def __init__(self, port, baud):
        import serial  # sudo apt install python3-serial
        self.ser = serial.Serial(port, baud, timeout=1)
        self.lock = threading.Lock()

    def _read_until(self, wait, timeout):
        end, buf = time.time() + timeout, ""
        while time.time() < end:
            buf += self.ser.read(self.ser.in_waiting or 1).decode(errors="replace")
            if wait in buf or "ERROR" in buf:
                break
        return buf

    def cmd(self, c, wait="OK", timeout=5.0):
        self.ser.reset_input_buffer()
        self.ser.write((c + "\r").encode())
        return self._read_until(wait, timeout)

    def setup(self):
        with self.lock:
            for c in ("AT", "ATE0", "AT+CMGF=1", 'AT+CSCS="GSM"', "AT+CSMP=17,167,0,0",
                      'AT+CPMS="SM","SM","SM"', "AT+CNMI=2,1,0,0,0"):
                log.debug("%s -> %s", c, self.cmd(c).strip())
            return "OK" in self.cmd("AT")

    def signal(self):
        with self.lock:
            m = re.search(r"\+CSQ:\s*(\d+),", self.cmd("AT+CSQ"))
        return None if not m or m.group(1) == "99" else -113 + 2 * int(m.group(1))

    def registered(self):
        with self.lock:
            r = self.cmd("AT+CREG?") + self.cmd("AT+CEREG?")
        return bool(re.search(r"\+C?E?REG:\s*\d+,(1|5)", r))

    def unread(self):
        with self.lock:
            r = self.cmd('AT+CMGL="REC UNREAD"', timeout=8)
        msgs, lines = [], r.splitlines()
        for i, ln in enumerate(lines):
            m = re.match(r'\+CMGL:\s*(\d+),"[^"]*","([^"]+)"', ln)
            if m:
                msgs.append((int(m.group(1)), m.group(2), (lines[i + 1] if i + 1 < len(lines) else "").strip()))
        return msgs

    def delete(self, idx):
        with self.lock:
            self.cmd(f"AT+CMGD={idx}")

    def send(self, number, text):
        with self.lock:
            uni = not is_gsm(text)
            if uni:
                self.cmd('AT+CSCS="UCS2"')
                self.cmd("AT+CSMP=17,167,0,8")
                number_x, text_x = number.encode("utf-16-be").hex().upper(), text.encode("utf-16-be").hex().upper()
            else:
                number_x, text_x = number, text
            try:
                self.ser.reset_input_buffer()
                self.ser.write(f'AT+CMGS="{number_x}"\r'.encode())
                if ">" not in self._read_until(">", 10):
                    return False
                self.ser.write((text_x + CTRL_Z).encode())
                return "+CMGS" in self._read_until("OK", 60)
            finally:
                if uni:
                    self.cmd('AT+CSCS="GSM"')
                    self.cmd("AT+CSMP=17,167,0,0")


# ------------------------------------------------------------------ service
class SmsService:
    def __init__(self, cfg, modem=None, sample=None, dry=False, lang=None):
        self.cfg, self.s = cfg, cfg["sms"]
        self.modem, self.sample, self.dry = modem, sample, dry
        self.L = lang or self.s.get("language", "en")
        valid = lambda ns: {norm_number(n) for n in ns if len(norm_number(n)) >= 12}  # skips +91XXXXXXXXXX placeholders
        self.registered = valid(self.s.get("registered_numbers", []))
        self.daily = valid(self.s.get("daily_report_numbers", []))
        self.sent_today, self.day = 0, dt.date.today()
        self.alerted = set()
        self.test_queue = []
        self.last_daily = self._saved_last_daily()
        self.status = {"modem": "starting", "signal_dbm": None, "language": self.L,
                       "daily_report_time": self.s.get("daily_report_time", "07:00"),
                       "last_daily": None, "last_daily_date": self.last_daily.isoformat() if self.last_daily else None,
                       "last_request": None, "last_reply": None, "registered": len(self.registered),
                       "daily_numbers": len(self.daily), "sent_today": 0}

    def _saved_last_daily(self):
        try:
            with open(self.s.get("status_file", "")) as f:
                d = json.load(f).get("last_daily_date")
            return dt.date.fromisoformat(d) if d else None
        except (OSError, ValueError, TypeError):
            return None

    def _write_status(self):
        path = self.s.get("status_file")
        if not path or self.dry:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "w") as f:
            json.dump(self.status, f)
        os.replace(path + ".tmp", path)

    def state(self):
        return bc.fetch_state(self.cfg.get("hub_url", "http://localhost:8080"), self.sample)

    def send(self, number, text):
        if dt.date.today() != self.day:
            self.day, self.sent_today = dt.date.today(), 0
        parts = split_sms(text)
        if self.sent_today + len(parts) > self.s.get("max_sms_per_day", 60):
            log.warning("daily SMS limit reached; not sending to %s", mask(number))
            return False
        ok = True
        for p in parts:
            if self.dry:
                print(f"--- SMS to {mask(number)} ({len(p)} chars, {'plain' if is_gsm(p) else 'Unicode'}) ---\n{p}\n")
            else:
                ok = self.modem.send(number, p) and ok
                time.sleep(2)
            self.sent_today += 1
        self.status["sent_today"] = self.sent_today
        return ok

    # feature 1: ask any time
    def handle(self, number, body):
        num, cmd = norm_number(number), parse_command(body)
        now = time.strftime("%H:%M")
        self.status["last_request"] = f"{mask(num)} {cmd} {now}"
        if num not in self.registered:
            log.info("ignored SMS from unregistered %s", mask(num))
            return
        if cmd == "HELP":
            text = HELP_TEXT
        elif cmd in ("REPORT_ON", "REPORT_OFF"):
            (self.daily.add if cmd == "REPORT_ON" else self.daily.discard)(num)
            self.status["daily_numbers"] = len(self.daily)
            text = f"BHOOMI: daily report {'ON' if cmd == 'REPORT_ON' else 'OFF'} for this number."
        else:
            try:
                text = build_reply(cmd, self.state(), self.L)
            except Exception as e:
                log.error("hub not answering: %s", e)
                text = "BHOOMI hub: live data not available right now. Field nodes keep working. Try again in 5 min."
        self.send(num, text)
        self.status["last_reply"] = now

    # feature 2: daily report (once a day, inside a 60-minute window after the set time)
    def maybe_daily(self, now=None):
        now = now or dt.datetime.now()
        hh, mm = map(int, self.s.get("daily_report_time", "07:00").split(":"))
        due = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if not (due <= now < due + dt.timedelta(minutes=60)) or self.last_daily == now.date():
            return
        self.last_daily = now.date()
        try:
            text = build_reply("STATUS", self.state(), self.L)
        except Exception as e:
            log.error("hub not answering: %s", e)
            text = "BHOOMI daily report: the hub could not read live data this morning. Please check the hub."
        for n in sorted(self.daily):
            self.send(n, text)
        self.status["last_daily"] = now.strftime("%d-%b %H:%M")
        self.status["last_daily_date"] = now.date().isoformat()

    # critical alerts by SMS (each alert once while it stays active)
    def maybe_alerts(self, state):
        levels = set(self.s.get("alert_sms_levels", ["crit"]))
        live, new = set(), []
        for a in state.get("alerts", []):
            k = bc.alert_key(a)
            live.add(k)
            if a.get("level") in levels and k not in self.alerted:
                self.alerted.add(k)
                new.append(bc.alert_text(state, a, self.L))
        if new:  # all new alerts in one message
            text = "\n".join([f"BHOOMI ALERT {stamp(state)}"] + ["!! " + x for x in new])
            for n in sorted(self.registered):
                self.send(n, text)
        self.alerted &= live

    def loop(self):
        while True:
            try:
                self.status["signal_dbm"] = self.modem.signal()
                self.status["modem"] = "registered" if self.modem.registered() else "no network"
                for idx, num, body in self.modem.unread():
                    self.handle(num, body)
                    self.modem.delete(idx)
                while self.test_queue:
                    self.send(self.test_queue.pop(0), "BHOOMI test SMS: the hub modem is working.")
                self.maybe_daily()
                try:
                    self.maybe_alerts(self.state())
                except Exception as e:
                    log.debug("state: %s", e)
            except Exception as e:
                log.exception("loop error: %s", e)
                self.status["modem"] = "error"
            self._write_status()
            time.sleep(5)


def serve_status(svc, port):
    """Tiny HTTP endpoint so the dashboard can show SMS status and send a test SMS."""

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            raw = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self._send(204, {})

        def do_GET(self):
            if self.path.startswith("/sms/status"):
                return self._send(200, svc.status)
            self._send(404, {})

        def do_POST(self):
            if not self.path.startswith("/sms/test"):
                return self._send(404, {})
            n = int(self.headers.get("Content-Length") or 0)
            try:
                num = norm_number(json.loads(self.rfile.read(min(n, 2000)) or b"{}").get("number", ""))
            except ValueError:
                num = ""
            if num not in svc.registered:
                return self._send(400, {"ok": False, "error": "number is not registered"})
            svc.test_queue.append(num)
            self._send(200, {"ok": True})

    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log.info("SMS status on http://0.0.0.0:%s/sms/status", port)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="/etc/bhoomi/hub.json")
    ap.add_argument("--dry-run", action="store_true", help="print the SMS instead of sending")
    ap.add_argument("--sample", help="use a saved /api/state JSON instead of the hub")
    ap.add_argument("--lang", help="override sms.language (en, te, hi, ta, kn)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = bc.load_config(a.config)
    if a.dry_run:
        svc = SmsService(cfg, sample=a.sample, dry=True, lang=a.lang)
        num = "+919800000012"
        svc.registered.add(num)
        for msg in ("Hi", "pond", "help"):
            print(f"=== farmer texts {msg!r}")
            svc.handle(num, msg)
        print("=== daily morning report")
        svc.daily, svc.last_daily = {num}, None
        hh, mm = map(int, svc.s.get("daily_report_time", "07:00").split(":"))
        svc.maybe_daily(dt.datetime.now().replace(hour=hh, minute=mm, second=5))
        print("=== new critical alerts")
        svc.maybe_alerts(svc.state())
        return
    modem = Modem(cfg["sms"]["modem_port"], cfg["sms"].get("baud", 115200))
    if not modem.setup():
        log.error("modem not answering on %s", cfg["sms"]["modem_port"])
        sys.exit(1)
    svc = SmsService(cfg, modem=modem)
    serve_status(svc, cfg["sms"].get("status_port", 8091))
    svc.loop()


if __name__ == "__main__":
    main()
