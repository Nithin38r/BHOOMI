"""
Shared helpers for the BHOOMI hub services (alarm_service.py, sms_service.py).

* Reads the hub snapshot from GET {hub_url}/api/state (same JSON the dashboard uses).
* Turns alerts and advice into text using the dashboard's own translations
  (window.BHOOMI_I18N inside software/dashboard/index.html), so the screen,
  the voice and the SMS always say the same thing, in en / te / hi / ta / kn.
"""
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DASHBOARD = os.path.normpath(os.path.join(HERE, "..", "dashboard", "index.html"))
LEVEL_RANK = {"info": 0, "warn": 1, "crit": 2}

_I18N = None


def load_i18n(path=DASHBOARD):
    """Parse window.BHOOMI_I18N = { en: { key:"text", ... }, te: {...} } from the dashboard."""
    global _I18N
    if _I18N is not None:
        return _I18N
    try:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        start = src.index("window.BHOOMI_I18N")
        end = src.index("\n};", start)
        block = src[start:end]
        out = {}
        heads = list(re.finditer(r"\n(\w{2}):\s*\{", block))
        for i, h in enumerate(heads):
            seg = block[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(block)]
            out[h.group(1)] = dict(re.findall(r'(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"', seg))
        _I18N = out or {"en": {}}
    except (OSError, ValueError):
        _I18N = {"en": {}}
    return _I18N


def t(key, lang="en", **p):
    tr = load_i18n()
    s = tr.get(lang, {}).get(key) or tr.get("en", {}).get(key) or key
    return re.sub(r"\{(\w+)\}", lambda m: str(p[m.group(1)]) if p.get(m.group(1)) is not None else m.group(0), s)


def short(name):
    return re.sub(r"^BHOOMI_", "", name or "")


def node_name(state, node_id):
    n = (state.get("nodes") or {}).get(node_id) or {}
    return n.get("name") or node_id


def alert_text(state, a, lang="en"):
    code = a.get("code", "")
    key = code if code.startswith("FLT_") else "A_" + code
    p = dict(a.get("p") or {})
    p["node"] = short(node_name(state, a.get("node")))
    return t(key, lang, **p)


def advice_text(adv, lang="en"):
    p = dict(adv.get("p") or {})
    if "crop" in p:
        p["crop"] = t("c_" + (p["crop"] or "default"), lang)
    return t("V_" + adv.get("code", ""), lang, **p)


def top_level(state):
    """0 = normal, 1 = warning, 2 = critical (info alerts don't sound)."""
    lv = 0
    for a in state.get("alerts", []):
        lv = max(lv, LEVEL_RANK.get(a.get("level"), 0))
    return lv


def alert_key(a):
    return f"{a.get('node')}|{a.get('code')}"


def fetch_state(hub_url, sample=None, timeout=4):
    if sample:
        with open(sample, encoding="utf-8") as f:
            return json.load(f)
    with urllib.request.urlopen(hub_url.rstrip("/") + "/api/state", timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_config(path):
    if not os.path.exists(path):
        path = os.path.join(HERE, "..", "config", "hub.example.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)
