/** Screen text in English, Telugu and Tamil. Telugu and Tamil need a native speaker's review before field use. */
import { FIELD_INFO } from "../../shared/am1.ts";
import type { Lang } from "../../shared/api.ts";

const en = {
  nav_home: "Home", nav_field: "Field", nav_pond: "Pond", nav_spray: "Spray", nav_more: "More",
  live: "Live", reconnecting: "Reconnecting…", voice: "Voice alerts",
  all_normal: "Whole farm normal", all_normal_sub: "{n} devices reporting. No action needed.",
  attention: "{n} need attention", alerts: "Alerts", no_devices: "No devices yet. Start the gateway or the simulator.",
  pump: "Pump", running: "Running", stopped: "Stopped", tripped: "Tripped", start_pump: "Start pump", stop_pump: "Stop pump",
  auto_irr: "Automatic irrigation", auto_irr_sub: "Hub starts the pump when topsoil is dry and no rain is coming, and stops it when the root zone is full.",
  cmd_pending: "Sending…", cmd_sent: "Waiting for the pump to confirm…", cmd_acked: "Confirmed by the device", cmd_failed: "Not confirmed. Check the gateway.",
  by_auto: "automatic", by_farmer: "you",
  weather: "Weather", rain_chance: "Rain chance, next 12 h", rain_total: "Rain, next 24 h", now_label: "Now",
  forecast_live: "Live forecast", forecast_sim: "Simulated forecast", forecast_none: "Forecast unavailable", use_live: "Use live forecast",
  field: "Field", soil_nodes: "Soil nodes", m15: "15 cm", m30: "30 cm", moisture: "Soil moisture",
  battery: "Battery", signal: "Signal", last_packet: "Last packet", ago: "{t} ago", reporting: "Reporting", not_reporting: "Not reporting",
  packets: "Packets", lost: "Lost", last24: "Last 24 hours", temps: "Temperature and humidity", no_history: "Waiting for history…",
  pond: "Pond", do_label: "Dissolved oxygen", aerator: "Aerator", aer_auto: "Auto", aer_on: "On", aer_off: "Off",
  aer_mode: "Aerator control", aer_mode_sub: "Auto: the pond controller starts the aerator below 4 mg/L by itself, even without internet.",
  no_pond: "No pond node has reported yet.", fault: "Fault", ask_reading: "Ask for a reading now",
  spray: "Spray log", log_spray: "Log a spray", product: "Product", sprayed: "Sprayed", safe_in: "Safe to harvest in {t}", safe_now: "Safe to harvest",
  label_phi: "label {d} d", model_d: "model {d} d", spray_note: "We don't measure pesticide in the soil. We log each spray and estimate how fast it breaks down from live soil temperature and moisture. The timer is never shorter than the label's waiting period.",
  p_ins: "Insecticide", p_fun: "Fungicide", p_neem: "Neem spray", p_custom: "Other product",
  name: "Name", phi_days: "Label waiting period (days)", half_life: "Half-life (days)", save: "Save", cancel: "Cancel", delete: "Delete", no_sprays: "No sprays logged.",
  devices: "Devices", rename: "Rename", type: "Type", sms_out: "SMS sent to the farmer", no_sms: "No SMS yet.", raw: "Raw packets",
  settings: "Settings", sms_lang: "SMS language", dry_below: "Start irrigation when 15 cm moisture is below (%)", full_at: "Stop irrigation when 30 cm moisture reaches (%)",
  rain_skip: "Skip irrigation when rain chance is at least (%)", do_low: "Pond oxygen alarm below (mg/L)", farm_name: "Farm name",
  gateway_help: "Gateway connection", app_lang: "App language",
  farm_now: "Farm now", topsoil: "Topsoil, average", field_cores: "Soil at a glance",
  cores_sub: "Each column is one node: 15 cm on top, 30 cm below. The colour shows moisture, from dry to wet as in the key.", dry: "dry", wet: "wet",
  pond_oxygen: "Pond oxygen", rain_short: "Rain chance, 12 h", oxy_ok: "Healthy", oxy_low: "Low", oxy_crit: "Critical",
  flowing: "Water flowing", temperature: "Temperature", mode: "Mode",
};
export type Key = keyof typeof en;

const te: Record<Key, string> = {
  nav_home: "హోమ్", nav_field: "పొలం", nav_pond: "చెరువు", nav_spray: "పిచికారీ", nav_more: "మరిన్ని",
  live: "లైవ్", reconnecting: "మళ్ళీ కలుపుతోంది…", voice: "వాయిస్ హెచ్చరికలు",
  all_normal: "పొలం అంతా సాధారణంగా ఉంది", all_normal_sub: "{n} పరికరాలు సమాచారం పంపుతున్నాయి. ఏ చర్యా అవసరం లేదు.",
  attention: "{n} విషయాలపై దృష్టి అవసరం", alerts: "హెచ్చరికలు", no_devices: "ఇంకా పరికరాలు లేవు. గేట్‌వే లేదా సిమ్యులేటర్‌ను ప్రారంభించండి.",
  pump: "మోటార్", running: "నడుస్తోంది", stopped: "ఆగి ఉంది", tripped: "ట్రిప్ అయింది", start_pump: "మోటార్ ఆన్", stop_pump: "మోటార్ ఆఫ్",
  auto_irr: "ఆటోమేటిక్ నీటిపారుదల", auto_irr_sub: "పై మట్టి ఎండి, వర్షం సూచన లేనప్పుడు హబ్ మోటార్ ఆన్ చేస్తుంది; వేర్ల వద్ద తేమ నిండగానే ఆపుతుంది.",
  cmd_pending: "పంపుతోంది…", cmd_sent: "మోటార్ నిర్ధారణ కోసం వేచి ఉంది…", cmd_acked: "పరికరం నిర్ధారించింది", cmd_failed: "నిర్ధారణ రాలేదు. గేట్‌వేని తనిఖీ చేయండి.",
  by_auto: "ఆటోమేటిక్", by_farmer: "మీరు",
  weather: "వాతావరణం", rain_chance: "వర్షం అవకాశం, 12 గంటల్లో", rain_total: "వర్షం, 24 గంటల్లో", now_label: "ఇప్పుడు",
  forecast_live: "లైవ్ సూచన", forecast_sim: "సిమ్యులేటెడ్ సూచన", forecast_none: "సూచన అందుబాటులో లేదు", use_live: "లైవ్ సూచన వాడండి",
  field: "పొలం", soil_nodes: "మట్టి నోడ్‌లు", m15: "15 సెం.మీ.", m30: "30 సెం.మీ.", moisture: "నేల తేమ",
  battery: "బ్యాటరీ", signal: "సిగ్నల్", last_packet: "చివరి ప్యాకెట్", ago: "{t} క్రితం", reporting: "సమాచారం వస్తోంది", not_reporting: "సమాచారం రావడం లేదు",
  packets: "ప్యాకెట్లు", lost: "కోల్పోయినవి", last24: "గత 24 గంటలు", temps: "ఉష్ణోగ్రత, తేమ", no_history: "చరిత్ర కోసం వేచి ఉంది…",
  pond: "చెరువు", do_label: "కరిగిన ఆక్సిజన్", aerator: "ఏరేటర్", aer_auto: "ఆటో", aer_on: "ఆన్", aer_off: "ఆఫ్",
  aer_mode: "ఏరేటర్ నియంత్రణ", aer_mode_sub: "ఆటో: ఆక్సిజన్ 4 mg/L కంటే తగ్గితే చెరువు కంట్రోలర్ ఇంటర్నెట్ లేకపోయినా ఏరేటర్‌ను తానే ఆన్ చేస్తుంది.",
  no_pond: "చెరువు నోడ్ నుండి ఇంకా సమాచారం రాలేదు.", fault: "లోపం", ask_reading: "ఇప్పుడే రీడింగ్ అడగండి",
  spray: "పిచికారీ రికార్డు", log_spray: "పిచికారీ నమోదు", product: "మందు", sprayed: "పిచికారీ చేసిన సమయం", safe_in: "{t} తర్వాత కోత కోయవచ్చు", safe_now: "కోత కోయవచ్చు",
  label_phi: "లేబుల్ {d} రోజులు", model_d: "మోడల్ {d} రోజులు", spray_note: "మట్టిలో పురుగుమందును మేము కొలవము. ప్రతి పిచికారీని నమోదు చేసి, లైవ్ మట్టి ఉష్ణోగ్రత, తేమ ఆధారంగా అది ఎంత వేగంగా విచ్ఛిన్నమవుతుందో అంచనా వేస్తాము. టైమర్ ఎప్పుడూ లేబుల్‌పై ఉన్న నిరీక్షణ కాలం కంటే తక్కువ ఉండదు.",
  p_ins: "పురుగుమందు", p_fun: "శిలీంధ్రనాశిని", p_neem: "వేప పిచికారీ", p_custom: "ఇతర మందు",
  name: "పేరు", phi_days: "లేబుల్ నిరీక్షణ కాలం (రోజులు)", half_life: "అర్ధ జీవిత కాలం (రోజులు)", save: "సేవ్", cancel: "రద్దు", delete: "తొలగించు", no_sprays: "పిచికారీలు నమోదు కాలేదు.",
  devices: "పరికరాలు", rename: "పేరు మార్చు", type: "రకం", sms_out: "రైతుకు పంపిన SMS", no_sms: "ఇంకా SMS లేవు.", raw: "ముడి ప్యాకెట్లు",
  settings: "సెట్టింగ్‌లు", sms_lang: "SMS భాష", dry_below: "15 సెం.మీ. తేమ ఇంత కంటే తగ్గితే నీరు ప్రారంభం (%)", full_at: "30 సెం.మీ. తేమ ఇంత చేరితే నీరు ఆపు (%)",
  rain_skip: "వర్షం అవకాశం కనీసం ఇంత ఉంటే నీరు వద్దు (%)", do_low: "చెరువు ఆక్సిజన్ అలారం (mg/L కంటే తక్కువ)", farm_name: "పొలం పేరు",
  gateway_help: "గేట్‌వే కనెక్షన్", app_lang: "యాప్ భాష",
  farm_now: "ఇప్పుడు పొలం", topsoil: "పై మట్టి, సగటు", field_cores: "నేల తేమ ఒక్క చూపులో",
  cores_sub: "ప్రతి స్తంభం ఒక నోడ్: పైన 15 సెం.మీ., కింద 30 సెం.మీ. రంగు తేమను చూపిస్తుంది, సూచికలో ఉన్నట్లు పొడి నుంచి తడి వరకు.", dry: "పొడి", wet: "తడి",
  pond_oxygen: "చెరువు ఆక్సిజన్", rain_short: "వర్షం అవకాశం, 12 గం", oxy_ok: "సరిపడా", oxy_low: "తక్కువ", oxy_crit: "ప్రమాదం",
  flowing: "నీరు ప్రవహిస్తోంది", temperature: "ఉష్ణోగ్రత", mode: "విధానం",
};

const ta: Record<Key, string> = {
  nav_home: "முகப்பு", nav_field: "வயல்", nav_pond: "குளம்", nav_spray: "தெளிப்பு", nav_more: "மேலும்",
  live: "நேரலை", reconnecting: "மீண்டும் இணைக்கிறது…", voice: "குரல் எச்சரிக்கைகள்",
  all_normal: "முழு வயலும் இயல்பாக உள்ளது", all_normal_sub: "{n} சாதனங்கள் தகவல் அனுப்புகின்றன. எந்த நடவடிக்கையும் தேவையில்லை.",
  attention: "{n} விஷயங்கள் கவனிக்கப்பட வேண்டும்", alerts: "எச்சரிக்கைகள்", no_devices: "இன்னும் சாதனங்கள் இல்லை. கேட்வே அல்லது சிமுலேட்டரைத் தொடங்கவும்.",
  pump: "மோட்டார்", running: "இயங்குகிறது", stopped: "நின்றுள்ளது", tripped: "ட்ரிப் ஆனது", start_pump: "மோட்டார் இயக்கு", stop_pump: "மோட்டார் நிறுத்து",
  auto_irr: "தானியங்கி நீர்ப்பாசனம்", auto_irr_sub: "மேல் மண் வறண்டு மழை எதிர்பார்ப்பு இல்லாதபோது ஹப் மோட்டாரை இயக்கும்; வேர்ப் பகுதி நிறைந்ததும் நிறுத்தும்.",
  cmd_pending: "அனுப்புகிறது…", cmd_sent: "மோட்டார் உறுதிப்படுத்தக் காத்திருக்கிறது…", cmd_acked: "சாதனம் உறுதிப்படுத்தியது", cmd_failed: "உறுதிப்படுத்தப்படவில்லை. கேட்வேயைச் சரிபார்க்கவும்.",
  by_auto: "தானியங்கி", by_farmer: "நீங்கள்",
  weather: "வானிலை", rain_chance: "மழை வாய்ப்பு, 12 மணி நேரத்தில்", rain_total: "மழை, 24 மணி நேரத்தில்", now_label: "இப்போது",
  forecast_live: "நேரலை முன்னறிவிப்பு", forecast_sim: "சிமுலேட் முன்னறிவிப்பு", forecast_none: "முன்னறிவிப்பு கிடைக்கவில்லை", use_live: "நேரலை முன்னறிவிப்பைப் பயன்படுத்து",
  field: "வயல்", soil_nodes: "மண் நோட்கள்", m15: "15 செ.மீ.", m30: "30 செ.மீ.", moisture: "மண் ஈரப்பதம்",
  battery: "பேட்டரி", signal: "சிக்னல்", last_packet: "கடைசி பாக்கெட்", ago: "{t} முன்பு", reporting: "தகவல் வருகிறது", not_reporting: "தகவல் வரவில்லை",
  packets: "பாக்கெட்டுகள்", lost: "இழந்தவை", last24: "கடந்த 24 மணி நேரம்", temps: "வெப்பநிலை மற்றும் ஈரப்பதம்", no_history: "வரலாற்றுக்காகக் காத்திருக்கிறது…",
  pond: "குளம்", do_label: "கரைந்த ஆக்ஸிஜன்", aerator: "ஏரேட்டர்", aer_auto: "தானியங்கி", aer_on: "இயக்கு", aer_off: "நிறுத்து",
  aer_mode: "ஏரேட்டர் கட்டுப்பாடு", aer_mode_sub: "தானியங்கி: ஆக்ஸிஜன் 4 mg/L க்குக் கீழ் குறைந்தால் இணையம் இல்லாவிட்டாலும் குளக் கட்டுப்படுத்தி ஏரேட்டரைத் தானே இயக்கும்.",
  no_pond: "குள நோட்டிலிருந்து இன்னும் தகவல் வரவில்லை.", fault: "பிழை", ask_reading: "இப்போதே அளவீட்டைக் கேள்",
  spray: "தெளிப்புப் பதிவு", log_spray: "தெளிப்பைப் பதிவு செய்", product: "மருந்து", sprayed: "தெளித்த நேரம்", safe_in: "{t} பிறகு அறுவடை செய்யலாம்", safe_now: "அறுவடை செய்யலாம்",
  label_phi: "லேபிள் {d} நாள்", model_d: "மாதிரி {d} நாள்", spray_note: "மண்ணில் பூச்சிக்கொல்லியை நாங்கள் அளவிடுவதில்லை. ஒவ்வொரு தெளிப்பையும் பதிவு செய்து, நேரலை மண் வெப்பநிலை மற்றும் ஈரப்பதத்தைக் கொண்டு அது எவ்வளவு வேகமாகச் சிதைகிறது என மதிப்பிடுகிறோம். டைமர் லேபிளில் உள்ள காத்திருப்புக் காலத்தை விடக் குறையாது.",
  p_ins: "பூச்சிக்கொல்லி", p_fun: "பூஞ்சைக்கொல்லி", p_neem: "வேப்ப எண்ணெய் தெளிப்பு", p_custom: "வேறு மருந்து",
  name: "பெயர்", phi_days: "லேபிள் காத்திருப்புக் காலம் (நாட்கள்)", half_life: "அரை ஆயுள் (நாட்கள்)", save: "சேமி", cancel: "ரத்து", delete: "நீக்கு", no_sprays: "தெளிப்புகள் பதிவாகவில்லை.",
  devices: "சாதனங்கள்", rename: "பெயர் மாற்று", type: "வகை", sms_out: "விவசாயிக்கு அனுப்பிய SMS", no_sms: "இன்னும் SMS இல்லை.", raw: "மூல பாக்கெட்டுகள்",
  settings: "அமைப்புகள்", sms_lang: "SMS மொழி", dry_below: "15 செ.மீ. ஈரப்பதம் இதற்குக் கீழ் சென்றால் நீர் தொடங்கு (%)", full_at: "30 செ.மீ. ஈரப்பதம் இதை அடைந்தால் நீர் நிறுத்து (%)",
  rain_skip: "மழை வாய்ப்பு குறைந்தது இவ்வளவு இருந்தால் நீர் வேண்டாம் (%)", do_low: "குள ஆக்ஸிஜன் அலாரம் (mg/L க்குக் கீழ்)", farm_name: "பண்ணையின் பெயர்",
  gateway_help: "கேட்வே இணைப்பு", app_lang: "செயலி மொழி",
  farm_now: "இப்போது வயல்", topsoil: "மேல் மண், சராசரி", field_cores: "மண் ஈரம் ஒரே பார்வையில்",
  cores_sub: "ஒவ்வொரு தூணும் ஒரு நோட்: மேலே 15 செ.மீ., கீழே 30 செ.மீ. நிறம் ஈரப்பதத்தைக் காட்டுகிறது, குறியீட்டில் உள்ளது போல் வறண்டது முதல் ஈரம் வரை.", dry: "வறண்ட", wet: "ஈரமான",
  pond_oxygen: "குள ஆக்ஸிஜன்", rain_short: "மழை வாய்ப்பு, 12 மணி", oxy_ok: "போதுமானது", oxy_low: "குறைவு", oxy_crit: "ஆபத்து",
  flowing: "நீர் பாய்கிறது", temperature: "வெப்பநிலை", mode: "முறை",
};

const ALL: Record<Lang, Record<Key, string>> = { en, te, ta };

export function makeT(lang: Lang) {
  return (k: Key, params?: Record<string, string | number>) =>
    (ALL[lang][k] ?? en[k]).replace(/\{(\w+)\}/g, (_, p: string) => String(params?.[p] ?? ""));
}
export type TFn = ReturnType<typeof makeT>;

/** Sensor names. English falls back to FIELD_INFO labels from the shared packet definition. */
const FIELD_LABELS: Record<"te" | "ta", Record<string, string>> = {
  te: { HOP: "మెష్ హాప్‌లు", DOS: "ఆక్సిజన్ సంతృప్తి", AERI: "ఏరేటర్ కరెంట్", M1: "తేమ 15 సెం.మీ.", M2: "తేమ 30 సెం.మీ.", ST: "మట్టి ఉష్ణోగ్రత", AT: "గాలి ఉష్ణోగ్రత", AH: "గాలిలో తేమ", LW: "ఆకు తడి", LX: "వెలుతురు",
    EC: "మట్టి EC", PH: "pH", NI: "నత్రజని సూచిక", PI: "భాస్వరం సూచిక", KI: "పొటాషియం సూచిక", BV: "బ్యాటరీ", RSSI: "సిగ్నల్",
    DO: "కరిగిన ఆక్సిజన్", WT: "నీటి ఉష్ణోగ్రత", I: "మోటార్ కరెంట్", RT: "నడిచిన సమయం", Q: "నీటి ప్రవాహం" },
  ta: { HOP: "மெஷ் தாவல்கள்", DOS: "ஆக்ஸிஜன் செறிவு", AERI: "ஏரேட்டர் மின்னோட்டம்", M1: "ஈரப்பதம் 15 செ.மீ.", M2: "ஈரப்பதம் 30 செ.மீ.", ST: "மண் வெப்பநிலை", AT: "காற்று வெப்பநிலை", AH: "காற்று ஈரப்பதம்", LW: "இலை ஈரம்", LX: "ஒளி",
    EC: "மண் EC", PH: "pH", NI: "நைட்ரஜன் குறியீடு", PI: "பாஸ்பரஸ் குறியீடு", KI: "பொட்டாசியம் குறியீடு", BV: "பேட்டரி", RSSI: "சிக்னல்",
    DO: "கரைந்த ஆக்ஸிஜன்", WT: "நீர் வெப்பநிலை", I: "மோட்டார் மின்னோட்டம்", RT: "இயங்கிய நேரம்", Q: "நீர் ஓட்டம்" },
};
export function fieldLabel(key: string, lang: Lang): string {
  return (lang !== "en" && FIELD_LABELS[lang][key]) || FIELD_INFO[key]?.label || key;
}

export const LANG_NAMES: Record<Lang, string> = { en: "English", te: "తెలుగు", ta: "தமிழ்" };
export const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", te: "te-IN", ta: "ta-IN" };
