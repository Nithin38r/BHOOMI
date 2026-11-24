#!/usr/bin/env bash
# BHOOMI live dashboard monitor - one-time setup on Raspberry Pi 4 (Raspberry Pi OS Bookworm)
# Run from the folder that contains software/:   sudo bash software/setup/install.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== packages"
apt-get update
apt-get install -y python3-serial python3-gpiozero python3-luma.oled i2c-tools espeak-ng \
  fonts-noto-core fonts-noto-ui-core chromium-browser || \
apt-get install -y python3-serial python3-gpiozero i2c-tools espeak-ng fonts-noto-core chromium-browser

echo "== user and files"
id bhoomi >/dev/null 2>&1 || useradd -r -m -G gpio,i2c,audio,dialout bhoomi
mkdir -p /opt/bhoomi /etc/bhoomi
cp -r "$HERE/software" /opt/bhoomi/
[ -f /etc/bhoomi/hub.json ] || cp "$HERE/software/config/hub.example.json" /etc/bhoomi/hub.json

echo "== fixed USB names"
cp "$HERE/software/setup/99-bhoomi.rules" /etc/udev/rules.d/
udevadm control --reload && udevadm trigger

echo "== services"
cp "$HERE/software/setup/bhoomi-alarm.service" "$HERE/software/setup/bhoomi-sms.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bhoomi-alarm.service bhoomi-sms.service

echo "== Wi-Fi hotspot BHOOMI-HUB (phones open the dashboard with no internet)"
nmcli con show BHOOMI-HUB >/dev/null 2>&1 || \
  nmcli dev wifi hotspot ifname wlan0 con-name BHOOMI-HUB ssid BHOOMI-HUB password "ChangeMe123"
nmcli con modify BHOOMI-HUB connection.autoconnect yes

cat <<MSG

Done. Still to do by hand:
 1. Add software/setup/config.txt.snippet to /boot/firmware/config.txt and reboot.
 2. Edit /etc/bhoomi/hub.json: hub_url, phone numbers, report time, language, relay type.
 3. Copy software/setup/kiosk-autostart to ~/.config/labwc/autostart (desktop user).
 4. Change the hotspot password:  nmcli con modify BHOOMI-HUB wifi-sec.psk "YourPassword"
 5. Check:  systemctl status bhoomi-alarm bhoomi-sms   and   curl localhost:8091/sms/status
MSG
