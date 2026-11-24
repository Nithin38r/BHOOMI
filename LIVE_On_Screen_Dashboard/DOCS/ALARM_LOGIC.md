# Alarm logic (alarm_service.py)

The alarm reads the hub snapshot (`/api/state`) every 3 seconds. Alert levels come from the hub: `crit`, `warn`, `info`.

| Situation | Lights | Sound | Voice |
|---|---|---|---|
| No warn/crit alerts | Green on | Quiet | — |
| Warning | Yellow on | 2 short beeps every 5 min | Each new warning spoken once |
| Critical | Red blinking | Siren ON (max 5 min), then 3 beeps every 10 s | Spoken, repeated every 2 min |
| Hub software not answering for 60 s | Yellow blinking | 1 beep a minute | — |
| `info` alerts (e.g. "soil will be dry in 7 h") | no change | Quiet | — (screen only) |

**MUTE button (GPIO26):** silences the siren, buzzer and voice for 15 minutes. The lights and the screen keep
showing the alert. **A new critical alert sounds again even while muted.**

**Shutdown button (GPIO21):** hold 3 s for a safe shutdown (protects the SD card).

**Voice:** `alarm.voice_language` = `en`, `te`, `hi`, `ta` or `kn`, using espeak-ng. The words are the dashboard's
own alert texts, so screen and voice say the same thing.

All timings are in `software/config/hub.example.json` → `alarm`.

Typical critical alerts from the hub: oxygen below 3 mg/L, aerator ON but no current (fault 10), aerator ON but oxygen
still falling (fault 11), pond node silent, battery critically low.
