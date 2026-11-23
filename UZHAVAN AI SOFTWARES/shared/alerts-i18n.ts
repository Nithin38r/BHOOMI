/**
 * Alert texts in English, Telugu and Tamil.
 * The server uses these to write SMS messages; the dashboard uses them on screen and for voice alerts.
 * Telugu and Tamil were drafted for the prototype: have a native speaker review them before field use.
 */
import type { AlertCode, Lang, Params } from "./api.ts";

type T = { title: string; detail: string };

const EN: Record<AlertCode, T> = {
  NODE_OFFLINE: { title: "{name} not reporting", detail: "No packet for {min} min. Check the battery, antenna or radio path." },
  SENSOR_NA: { title: "{name}: {sensor} not responding", detail: "The packet says NA. Check the cable or the sensor." },
  BATTERY_LOW: { title: "{name} battery low", detail: "{v} V. The node now reports every hour to save power." },
  IRRIGATE_NOW: { title: "Soil is dry: irrigate", detail: "{names}. No rain expected. Start the pump before the crop wilts." },
  IRRIGATION_SKIPPED_RAIN: { title: "Irrigation postponed: rain expected", detail: "{names} is dry, but the forecast gives a {prob} % chance of rain in the next 12 h." },
  IRRIGATING: { title: "Irrigating", detail: "The pump stops by itself when 30 cm moisture reaches {full} %." },
  WATERLOGGING: { title: "Waterlogging at {name}", detail: "Keep the pump off and open the field drain. Roots lack oxygen in saturated soil." },
  HEAT_STRESS: { title: "Heat stress", detail: "Air at {t} °C. Irrigate in the evening, not at noon." },
  COLD_STRESS: { title: "Cold stress", detail: "Air at {t} °C. Protect nursery seedlings tonight." },
  FUNGAL_RISK: { title: "Fungal disease risk", detail: "Humidity {h} % at {t} °C keeps leaves wet. Inspect for blast and avoid evening irrigation." },
  NITROGEN_LOW: { title: "Nitrogen looks low", detail: "{names}. Readings are indicative: confirm with a soil test before adding fertiliser." },
  SALT_HIGH: { title: "Salts building up", detail: "EC above 2.3 dS/m at {names}. Stop fertigation and irrigate with plain water." },
  PUMP_TRIP: { title: "Pump stopped itself", detail: "{reason}. The pump switch stopped the motor in its own firmware. Check before restarting." },
  PUMP_RUNNING: { title: "Pump running", detail: "{i} A · running for {rt} min." },
  TANK_LOW: { title: "Tank almost empty", detail: "Tank at {lv} %." },
  DO_LOW: { title: "Pond oxygen falling", detail: "Dissolved oxygen {do} mg/L, below {lim}. The aerator should be running." },
  DO_CRIT: { title: "Fish stress: very low oxygen", detail: "Dissolved oxygen {do} mg/L. Check the aerator now and start a backup if needed." },
  AERATOR_FAULT: { title: "Aerator not working", detail: "The aerator is switched on but draws only {a} A. The motor may have tripped." },
  PH_OUT: { title: "Pond pH out of range", detail: "pH {ph}. Suggested range 6.5–8.5." },
  POND_FAULT: { title: "Pond node fault {flt}", detail: "{text}" },
  PEST_HIGH: { title: "Insect count high", detail: "Sticky card: {wf} whiteflies and {ap} aphids a day. Inspect the crop before deciding to spray." },
  COLD_ROOM_WARM: { title: "Cold room warming", detail: "{t} °C. Check the door and the power." },
  DO_NOT_HARVEST: { title: "Do not harvest yet", detail: "{product} sprayed. Safe to harvest in {leftMin}." },
  COMMAND_FAILED: { title: "Command not confirmed", detail: "{cmd} {val} for {name} was not confirmed by the device. Check the gateway." },
};

const TE: Record<AlertCode, T> = {
  NODE_OFFLINE: { title: "{name} నుండి సమాచారం రావడం లేదు", detail: "{min} నిమిషాలుగా ప్యాకెట్ రాలేదు. బ్యాటరీ, యాంటెనా లేదా రేడియో మార్గాన్ని తనిఖీ చేయండి." },
  SENSOR_NA: { title: "{name}: {sensor} స్పందించడం లేదు", detail: "ప్యాకెట్‌లో NA వచ్చింది. కేబుల్ లేదా సెన్సార్‌ను తనిఖీ చేయండి." },
  BATTERY_LOW: { title: "{name} బ్యాటరీ తక్కువగా ఉంది", detail: "{v} V. శక్తి ఆదా కోసం నోడ్ ఇప్పుడు గంటకు ఒకసారి సమాచారం పంపుతుంది." },
  IRRIGATE_NOW: { title: "నేల ఎండిపోయింది: నీరు పెట్టండి", detail: "{names}. వర్షం సూచన లేదు. పంట వాడిపోకముందే మోటార్ ఆన్ చేయండి." },
  IRRIGATION_SKIPPED_RAIN: { title: "వర్షం సూచన: నీటిపారుదల వాయిదా", detail: "{names} ఎండిపోయింది, కానీ రాబోయే 12 గంటల్లో {prob}% వర్షం పడే అవకాశం ఉంది." },
  IRRIGATING: { title: "నీటిపారుదల జరుగుతోంది", detail: "30 సెం.మీ. లోతులో తేమ {full}% చేరగానే మోటార్ తనంతట తానే ఆగుతుంది." },
  WATERLOGGING: { title: "{name} వద్ద నీరు నిలిచిపోయింది", detail: "మోటార్ ఆపి ఉంచి, పొలంలో నీరు బయటకు పోయేలా కాలువ తెరవండి. నీరు నిండిన నేలలో వేర్లకు ఆక్సిజన్ అందదు." },
  HEAT_STRESS: { title: "అధిక వేడి", detail: "గాలి ఉష్ణోగ్రత {t} °C. మధ్యాహ్నం కాకుండా సాయంత్రం నీరు పెట్టండి." },
  COLD_STRESS: { title: "చలి ప్రభావం", detail: "గాలి ఉష్ణోగ్రత {t} °C. ఈ రాత్రి నారుమడిని కాపాడండి." },
  FUNGAL_RISK: { title: "శిలీంధ్ర తెగులు ప్రమాదం", detail: "{t} °C వద్ద తేమ {h}% ఉండటంతో ఆకులు తడిగా ఉంటాయి. అగ్గి తెగులు కోసం పరిశీలించండి, సాయంత్రం నీరు పెట్టవద్దు." },
  NITROGEN_LOW: { title: "నత్రజని తక్కువగా ఉన్నట్లుంది", detail: "{names}. ఇవి సూచనాత్మక విలువలు మాత్రమే: ఎరువు వేసే ముందు మట్టి పరీక్షతో నిర్ధారించుకోండి." },
  SALT_HIGH: { title: "నేలలో లవణాలు పెరుగుతున్నాయి", detail: "{names} వద్ద EC 2.3 dS/m కంటే ఎక్కువ. ఎరువు కలిపిన నీరు ఆపి, మామూలు నీటితో తడపండి." },
  PUMP_TRIP: { title: "మోటార్ తనంతట తానే ఆగిపోయింది", detail: "{reason}. పంప్ స్విచ్ తన ఫర్మ్‌వేర్‌తో మోటార్‌ను ఆపింది. మళ్ళీ ప్రారంభించే ముందు తనిఖీ చేయండి." },
  PUMP_RUNNING: { title: "మోటార్ నడుస్తోంది", detail: "{i} A · {rt} నిమిషాలుగా నడుస్తోంది." },
  TANK_LOW: { title: "ట్యాంక్ దాదాపు ఖాళీ", detail: "ట్యాంక్‌లో {lv}% నీరు ఉంది." },
  DO_LOW: { title: "చెరువులో ఆక్సిజన్ తగ్గుతోంది", detail: "కరిగిన ఆక్సిజన్ {do} mg/L, {lim} కంటే తక్కువ. ఏరేటర్ నడుస్తూ ఉండాలి." },
  DO_CRIT: { title: "చేపలకు ప్రమాదం: ఆక్సిజన్ చాలా తక్కువ", detail: "కరిగిన ఆక్సిజన్ {do} mg/L. వెంటనే ఏరేటర్‌ను తనిఖీ చేయండి, అవసరమైతే మరొకటి ప్రారంభించండి." },
  AERATOR_FAULT: { title: "ఏరేటర్ పనిచేయడం లేదు", detail: "ఏరేటర్ ఆన్‌లో ఉంది కానీ {a} A మాత్రమే తీసుకుంటోంది. మోటార్ ట్రిప్ అయి ఉండవచ్చు." },
  PH_OUT: { title: "చెరువు pH పరిధి దాటింది", detail: "pH {ph}. సూచించిన పరిధి 6.5–8.5." },
  POND_FAULT: { title: "చెరువు నోడ్ లోపం {flt}", detail: "చెరువు నోడ్‌ను తనిఖీ చేయండి. ({text})" },
  PEST_HIGH: { title: "పురుగుల సంఖ్య ఎక్కువగా ఉంది", detail: "పసుపు అట్ట: రోజుకు {wf} తెల్లదోమలు, {ap} పేనుబంకలు. పిచికారీ చేసే ముందు పంటను పరిశీలించండి." },
  COLD_ROOM_WARM: { title: "కోల్డ్ రూమ్ వేడెక్కుతోంది", detail: "{t} °C. తలుపు, విద్యుత్ సరఫరాను తనిఖీ చేయండి." },
  DO_NOT_HARVEST: { title: "ఇంకా కోత కోయవద్దు", detail: "{product} పిచికారీ చేశారు. {leftMin} తర్వాత కోత కోయవచ్చు." },
  COMMAND_FAILED: { title: "ఆదేశం నిర్ధారణ కాలేదు", detail: "{name} కి {cmd} {val} ఆదేశాన్ని పరికరం నిర్ధారించలేదు. గేట్‌వేని తనిఖీ చేయండి." },
};

const TA: Record<AlertCode, T> = {
  NODE_OFFLINE: { title: "{name} தகவல் அனுப்பவில்லை", detail: "{min} நிமிடங்களாக பாக்கெட் வரவில்லை. பேட்டரி, ஆண்டெனா அல்லது ரேடியோ இணைப்பைச் சரிபார்க்கவும்." },
  SENSOR_NA: { title: "{name}: {sensor} செயல்படவில்லை", detail: "பாக்கெட்டில் NA வந்துள்ளது. கேபிள் அல்லது சென்சாரைச் சரிபார்க்கவும்." },
  BATTERY_LOW: { title: "{name} பேட்டரி குறைவு", detail: "{v} V. மின்சாரத்தைச் சேமிக்க நோட் இனி மணிக்கு ஒருமுறை தகவல் அனுப்பும்." },
  IRRIGATE_NOW: { title: "மண் வறண்டுள்ளது: நீர் பாய்ச்சவும்", detail: "{names}. மழை எதிர்பார்க்கப்படவில்லை. பயிர் வாடும் முன் மோட்டாரை இயக்கவும்." },
  IRRIGATION_SKIPPED_RAIN: { title: "மழை எதிர்பார்ப்பு: நீர்ப்பாசனம் ஒத்திவைப்பு", detail: "{names} வறண்டுள்ளது, ஆனால் அடுத்த 12 மணி நேரத்தில் {prob}% மழை வாய்ப்பு உள்ளது." },
  IRRIGATING: { title: "நீர்ப்பாசனம் நடைபெறுகிறது", detail: "30 செ.மீ. ஆழத்தில் ஈரப்பதம் {full}% அடைந்ததும் மோட்டார் தானாக நின்றுவிடும்." },
  WATERLOGGING: { title: "{name} இல் நீர் தேங்கியுள்ளது", detail: "மோட்டாரை நிறுத்தி வைத்து வயல் வடிகாலைத் திறக்கவும். நீர் தேங்கிய மண்ணில் வேர்களுக்கு ஆக்ஸிஜன் கிடைக்காது." },
  HEAT_STRESS: { title: "அதிக வெப்பம்", detail: "காற்று வெப்பநிலை {t} °C. மதியம் அல்ல, மாலையில் நீர் பாய்ச்சவும்." },
  COLD_STRESS: { title: "குளிர் பாதிப்பு", detail: "காற்று வெப்பநிலை {t} °C. இன்றிரவு நாற்றங்காலைப் பாதுகாக்கவும்." },
  FUNGAL_RISK: { title: "பூஞ்சை நோய் அபாயம்", detail: "{t} °C இல் {h}% ஈரப்பதம் இலைகளை ஈரமாக வைக்கும். குலை நோய் உள்ளதா எனப் பார்க்கவும், மாலையில் நீர் பாய்ச்ச வேண்டாம்." },
  NITROGEN_LOW: { title: "நைட்ரஜன் குறைவாகத் தெரிகிறது", detail: "{names}. இவை தோராயமான அளவுகள்: உரம் இடும் முன் மண் பரிசோதனை மூலம் உறுதிசெய்யவும்." },
  SALT_HIGH: { title: "மண்ணில் உப்பு அதிகரிக்கிறது", detail: "{names} இல் EC 2.3 dS/m க்கு மேல். உரப்பாசனத்தை நிறுத்தி சாதாரண நீர் பாய்ச்சவும்." },
  PUMP_TRIP: { title: "மோட்டார் தானாக நின்றுவிட்டது", detail: "{reason}. பம்ப் சுவிட்ச் தன் ஃபர்ம்வேர் மூலம் மோட்டாரை நிறுத்தியது. மீண்டும் இயக்கும் முன் சரிபார்க்கவும்." },
  PUMP_RUNNING: { title: "மோட்டார் இயங்குகிறது", detail: "{i} A · {rt} நிமிடங்களாக இயங்குகிறது." },
  TANK_LOW: { title: "தொட்டி கிட்டத்தட்ட காலி", detail: "தொட்டியில் {lv}% நீர் உள்ளது." },
  DO_LOW: { title: "குளத்தில் ஆக்ஸிஜன் குறைகிறது", detail: "கரைந்த ஆக்ஸிஜன் {do} mg/L, {lim} க்குக் கீழ். ஏரேட்டர் இயங்க வேண்டும்." },
  DO_CRIT: { title: "மீன்களுக்கு ஆபத்து: ஆக்ஸிஜன் மிகக் குறைவு", detail: "கரைந்த ஆக்ஸிஜன் {do} mg/L. உடனே ஏரேட்டரைச் சரிபார்த்து, தேவைப்பட்டால் மாற்று ஏரேட்டரை இயக்கவும்." },
  AERATOR_FAULT: { title: "ஏரேட்டர் வேலை செய்யவில்லை", detail: "ஏரேட்டர் இயக்கத்தில் உள்ளது ஆனால் {a} A மட்டுமே எடுக்கிறது. மோட்டார் ட்ரிப் ஆகியிருக்கலாம்." },
  PH_OUT: { title: "குளத்தின் pH வரம்பு மீறியது", detail: "pH {ph}. பரிந்துரைக்கப்பட்ட வரம்பு 6.5–8.5." },
  POND_FAULT: { title: "குள நோட் பிழை {flt}", detail: "குள நோட்டைச் சரிபார்க்கவும். ({text})" },
  PEST_HIGH: { title: "பூச்சிகள் அதிகம்", detail: "மஞ்சள் ஒட்டும் அட்டை: நாளொன்றுக்கு {wf} வெள்ளை ஈக்கள், {ap} அசுவினிகள். தெளிக்கும் முன் பயிரைப் பார்வையிடவும்." },
  COLD_ROOM_WARM: { title: "குளிர் அறை சூடாகிறது", detail: "{t} °C. கதவு மற்றும் மின்சாரத்தைச் சரிபார்க்கவும்." },
  DO_NOT_HARVEST: { title: "இன்னும் அறுவடை செய்ய வேண்டாம்", detail: "{product} தெளிக்கப்பட்டது. {leftMin} பிறகு அறுவடை செய்யலாம்." },
  COMMAND_FAILED: { title: "கட்டளை உறுதிப்படுத்தப்படவில்லை", detail: "{name} க்கான {cmd} {val} கட்டளையைச் சாதனம் உறுதிப்படுத்தவில்லை. கேட்வேயைச் சரிபார்க்கவும்." },
};

const TEMPLATES: Record<Lang, Record<AlertCode, T>> = { en: EN, te: TE, ta: TA };

export const TRIP_REASON: Record<Lang, Record<string, string>> = {
  en: { DRY: "Dry run: no water in the well", PHASE: "Phase failure", MAXRT: "Maximum run time reached" },
  te: { DRY: "నీరు లేకుండా మోటార్ నడిచింది (బావిలో నీరు లేదు)", PHASE: "ఒక ఫేజ్ విద్యుత్ లేదు", MAXRT: "గరిష్ఠ నడుపు సమయం పూర్తయింది" },
  ta: { DRY: "நீரின்றி மோட்டார் ஓடியது (கிணற்றில் நீர் இல்லை)", PHASE: "ஒரு ஃபேஸ் மின்சாரம் இல்லை", MAXRT: "அதிகபட்ச இயக்க நேரம் முடிந்தது" },
};

export function formatDuration(min: number, lang: Lang): string {
  if (min <= 0) return { en: "now", te: "ఇప్పుడే", ta: "இப்போதே" }[lang];
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.floor(min % 60);
  const u = { en: ["d", "h", "min"], te: ["రోజులు", "గం", "ని"], ta: ["நாள்", "மணி", "நிமி"] }[lang];
  if (d) return `${d} ${u[0]} ${h} ${u[1]}`;
  if (h) return `${h} ${u[1]} ${m} ${u[2]}`;
  return `${m} ${u[2]}`;
}

function fill(tpl: string, params: Params, lang: Lang): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) return "";
    if (k.endsWith("Min") && typeof v === "number") return formatDuration(v, lang);
    if (k === "reason" && typeof v === "string") return TRIP_REASON[lang][v] ?? v;
    return String(v);
  });
}

export function alertText(code: AlertCode, params: Params, lang: Lang): { title: string; detail: string } {
  const t = TEMPLATES[lang][code] ?? EN[code];
  return { title: fill(t.title, params, lang), detail: fill(t.detail, params, lang) };
}
