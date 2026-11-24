# Raspberry Pi 4 hub setup

1. **Flash** Raspberry Pi OS (64-bit, Bookworm, with desktop) to a 32 GB card. In Raspberry Pi Imager, set hostname
   `bhoomi`, a user, and Wi-Fi if needed. Phones can then open `http://bhoomi.local:<port>`.
2. **Wire** the hub using `images/02_pi4_pin_schematic.png` and `docs/PIN_MAP.md`. Leave the siren disconnected for the first test.
3. **Copy** this folder to the Pi and run `sudo bash software/setup/install.sh`.
4. **Boot settings:** add `software/setup/config.txt.snippet` to `/boot/firmware/config.txt`, then reboot.
   Check I2C with `i2cdetect -y 1` (you should see 3c, 68, and 42 with the UPS HAT).
5. **Settings:** edit `/etc/bhoomi/hub.json`:
   - `hub_url`: where `bhoomi_hub` serves `/api/state`
   - `sms.registered_numbers`, `sms.daily_report_numbers`, `sms.daily_report_time`, `sms.language`
   - `alarm.voice_language`, `alarm.siren_active_high` (most relay boards are active-LOW: keep `false`)

   Then run `sudo systemctl restart bhoomi-alarm bhoomi-sms`.
6. **Screen:** copy `software/setup/kiosk-autostart` to `~/.config/labwc/autostart`. The dashboard opens full-screen at boot.
   Set the display to 1280×800 or more.
7. **Modem:** insert the SIM, connect the antennas, check `ls -l /dev/bhoomi-modem`. Text **HI** from a registered
   number: you should get the report within about 10 s. Use the 4G pill on the dashboard to see the signal.
8. **Test the alarm:** run the dashboard demo `#aer` scenario on the hub, or unplug the pond node and wait.
   Check the red LED, buzzer and voice. Then connect the siren and test again. Press MUTE.
9. **Safe shutdown:** hold the shutdown button for 3 s. Don't pull the power while the Pi is on.

Logs: `journalctl -u bhoomi-alarm -f` and `journalctl -u bhoomi-sms -f`.
