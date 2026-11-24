# BHOOMI Soil Node — Power & Battery Life

How the soil node runs for months on one battery, for the prototype (P1) and the product (PRO).

| | P1 as soldered | P1 + switched sensor rail | PRO |
|---|---|---|---|
| Battery | 1 × 18650, 3000 mAh | 1 × 18650, 3000 mAh | 1S2P 18650, 6000 mAh |
| Charger → regulator | TP4056 → HT7833 | TP4056 → HT7833 | CN3791 MPPT → TPS63802 |
| Sleep current | ≈ 16 mA | ≈ 1 mA | ≈ 35 µA |
| Energy per day | 370 mAh | 33 mAh | 12.6 mAh |
| Life with no sun | ≈ 6 days | ≈ 73 days | ≈ 381 days |

**Why it lasts:** deep sleep (awake about 4 s every 15 min), sensors switched fully off between readings, daily solar top-up, and firmware that slows reporting when the battery drops (15 min → 60 min → silent 6 h).

![Power chain](images/01_power_chain_P1_vs_PRO.png)
![Daily energy budget](images/02_daily_energy_budget.png)
![Battery life and solar](images/03_battery_life_and_solar.png)
![Adaptive duty cycle](images/04_adaptive_duty_cycle.png)

Full write-up: [BHOOMI_SoilNode_Power_Life.pdf](BHOOMI_SoilNode_Power_Life.pdf). All figures are design estimates. Measure the real sleep current with `BHOOMI_HardwareTest` (test 7).

