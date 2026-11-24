#!/usr/bin/env python3
"""
BHOOMI hub alarm service: Raspberry Pi 4 GPIO lights, buzzer, siren and voice.

Reads GET {hub_url}/api/state every few seconds (the dashboard's snapshot) and drives:
  GPIO5  (pin 29) green LED   - all normal
  GPIO6  (pin 31) yellow LED  - warning, or hub software not answering (blinks)
  GPIO13 (pin 33) red LED     - critical (blinks)
  GPIO17 (pin 11) buzzer      - through a 2N2222 transistor, HIGH = on
  GPIO27 (pin 13) siren relay - set alarm.siren_active_high to match your relay board
  GPIO26 (pin 37) MUTE button - to GND, internal pull-up
  speaker (3.5 mm jack)       - spoken alerts with espeak-ng, in alarm.voice_language
  I2C OLED 0x3C               - optional status screen (python3-luma.oled)
GPIO21 (pin 40) safe shutdown is done by the gpio-shutdown overlay (config/config.txt.snippet).

Rules (docs/ALARM_LOGIC.md):
  normal    green on, quiet
  warning   yellow on, 2 short beeps every N minutes until MUTE, alert spoken once
  critical  red blinks, siren on (max M minutes), 3 beeps every 10 s, alert spoken
            again every few minutes, until MUTE. MUTE silences sound for
            mute_minutes; lights stay on. A NEW critical alert sounds again.
  hub lost  yellow blinks, 1 beep a minute (the hub software has a problem;
            the field nodes keep running on their own)
"info" alerts (for example "soil will be dry in 7 h") only show on screen.

Run:  python3 alarm_service.py --config /etc/bhoomi/hub.json
Test: python3 alarm_service.py --simulate --sample ../sample/state.alerts.sample.json
"""
import argparse
import logging
import shutil
import subprocess
import threading
import time

import bhoomi_common as bc

log = logging.getLogger("bhoomi-alarm")
VOICES = {"en": "en", "te": "te", "hi": "hi", "ta": "ta", "kn": "kn"}


class Hw:
    """Real GPIO through gpiozero, or printed actions with --simulate."""

    def __init__(self, cfg, simulate=False):
        self.sim = simulate
        if simulate:
            return
        from gpiozero import LED, Buzzer, OutputDevice, Button
        self.g, self.y, self.r = LED(5), LED(6), LED(13)
        self.buzz = Buzzer(17)
        self.siren = OutputDevice(27, active_high=cfg["alarm"].get("siren_active_high", False), initial_value=False)
        self.mute = Button(26, pull_up=True, bounce_time=0.05)

    def leds(self, g, y, r, blink=None):
        if self.sim:
            print(f"[leds] green={g} yellow={y} red={r} blink={blink}")
            return
        for led, on in ((self.g, g), (self.y, y), (self.r, r)):
            led.on() if on else led.off()
        if blink == "red":
            self.r.blink(0.4, 0.4)
        elif blink == "yellow":
            self.y.blink(0.8, 0.8)

    def beep(self, n=1, on=0.12, off=0.12):
        if self.sim:
            print(f"[buzzer] beep x{n}")
            return
        self.buzz.beep(on, off, n=n, background=True)

    def siren_set(self, on):
        if self.sim:
            print(f"[siren] {'ON' if on else 'OFF'}")
            return
        self.siren.on() if on else self.siren.off()


def speak(text, lang, simulate=False):
    if not text:
        return
    if simulate:
        print(f"[voice:{lang}] {text}")
        return
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        log.info("voice (espeak-ng not installed): %s", text)
        return
    threading.Thread(target=subprocess.run, args=([exe, "-v", VOICES.get(lang, "en"), "-s", "140", text],),
                     kwargs={"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}, daemon=True).start()


class Oled:
    def __init__(self, enabled):
        self.dev = None
        if not enabled:
            return
        try:
            from luma.core.interface.serial import i2c
            from luma.oled.device import ssd1306
            self.dev = ssd1306(i2c(port=1, address=0x3C))
        except Exception as e:  # library or screen missing: run without it
            log.info("OLED off: %s", e)

    def show(self, lines):
        if not self.dev:
            return
        from luma.core.render import canvas
        with canvas(self.dev) as d:
            for i, ln in enumerate(lines[:5]):
                d.text((0, i * 12), ln[:21], fill="white")


class AlarmService:
    def __init__(self, cfg, hw, sample=None):
        self.cfg, self.a, self.hw, self.sample = cfg, cfg["alarm"], hw, sample
        self.lang = self.a.get("voice_language", "en")
        self.oled = Oled(self.a.get("oled", True) and not hw.sim)
        self.level = None
        self.muted_until = 0.0
        self.known_crit = set()
        self.siren_since = None
        self.last_beep = 0.0
        self.last_voice = 0.0
        self.spoken = set()
        self.last_ok = time.time()
        if not hw.sim:
            hw.mute.when_pressed = self.press_mute

    def press_mute(self, now=None):
        self.muted_until = (now or time.time()) + 60 * self.a.get("mute_minutes", 15)
        self.hw.siren_set(False)
        self.siren_since = None
        log.info("alarm muted for %s min", self.a.get("mute_minutes", 15))

    def step(self, s, now=None):
        """Apply one snapshot. Returns 0 normal / 1 warning / 2 critical."""
        now = now or time.time()
        lv = bc.top_level(s)
        crit = {bc.alert_key(a) for a in s.get("alerts", []) if a.get("level") == "crit"}
        if crit - self.known_crit:          # a NEW critical alert breaks the mute
            self.muted_until = 0
        self.known_crit = crit
        muted = now < self.muted_until

        if lv != self.level:
            log.info("level -> %s", ["normal", "warning", "critical"][lv])
            self.level = lv
            self.hw.leds(lv == 0, lv == 1, lv == 2, blink="red" if lv == 2 else None)

        if lv == 2 and not muted:
            if self.siren_since is None:
                self.siren_since = now
                self.hw.siren_set(True)
            elif now - self.siren_since > 60 * self.a.get("siren_max_on_minutes", 5) and self.siren_since > 0:
                self.hw.siren_set(False)     # siren capped; the buzzer keeps reminding
                self.siren_since = -1
            if now - self.last_beep > 10:
                self.hw.beep(3, 0.2, 0.1)
                self.last_beep = now
        else:
            if self.siren_since is not None:
                self.hw.siren_set(False)
                self.siren_since = None
            if lv == 1 and not muted and now - self.last_beep > 60 * self.a.get("warning_beep_every_minutes", 5):
                self.hw.beep(2)
                self.last_beep = now

        if self.a.get("voice", True) and not muted:
            for al in s.get("alerts", []):
                if al.get("level") not in ("crit", "warn"):
                    continue
                k = bc.alert_key(al)
                repeat = al["level"] == "crit" and now - self.last_voice > 60 * self.a.get("voice_repeat_critical_minutes", 2)
                if k not in self.spoken or repeat:
                    speak(bc.alert_text(s, al, self.lang), self.lang, self.hw.sim)
                    self.spoken.add(k)
                    self.last_voice = now
                    break
        self.spoken &= {bc.alert_key(a) for a in s.get("alerts", [])}

        nodes = list((s.get("nodes") or {}).values())
        self.oled.show(["BHOOMI HUB " + time.strftime("%H:%M"),
                        ["ALL OK", "WARNING", "CRITICAL"][lv] + (" (muted)" if muted else ""),
                        f"nodes {sum(1 for n in nodes if n.get('online'))}/{len(nodes)}",
                        f"alerts {len(s.get('alerts', []))}",
                        f"health {s.get('score', '-')}"])
        return lv

    def hub_lost(self, now):
        if self.level != -1:
            self.level = -1
            self.hw.leds(False, True, False, blink="yellow")
            self.hw.siren_set(False)
            self.siren_since = None
        if now - self.last_beep > 60:
            self.hw.beep(1)
            self.last_beep = now
        self.oled.show(["BHOOMI HUB", "HUB SOFTWARE", "NOT ANSWERING", "nodes keep working"])

    def loop(self):
        while True:
            now = time.time()
            try:
                self.step(bc.fetch_state(self.cfg.get("hub_url", "http://localhost:8080"), self.sample), now)
                self.last_ok = now
            except Exception as e:
                log.debug("state failed: %s", e)
                if now - self.last_ok > self.a.get("backend_lost_after_seconds", 60):
                    self.hub_lost(now)
            time.sleep(self.cfg.get("poll_seconds", 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="/etc/bhoomi/hub.json")
    ap.add_argument("--simulate", action="store_true", help="no GPIO: print what would happen")
    ap.add_argument("--sample", help="saved /api/state JSON instead of the hub")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = bc.load_config(a.config)
    svc = AlarmService(cfg, Hw(cfg, simulate=a.simulate), sample=a.sample)
    if a.simulate:
        svc.step(bc.fetch_state("", a.sample) if a.sample else {"alerts": [], "nodes": {}})
        return
    svc.loop()


if __name__ == "__main__":
    main()
