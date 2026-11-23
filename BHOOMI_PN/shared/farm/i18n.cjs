/*
 * Farmer-facing alert texts in English, Telugu and Tamil (push, SMS and voice).
 * Short, plain sentences: what happened, the number, what to do.
 * NOTE: the Telugu and Tamil texts should be checked by a native speaker before field use.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BhoomiI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LANGS = { en: 'English', te: 'తెలుగు', ta: 'தமிழ்' };
  const VOICE = { en: 'en-IN', te: 'te-IN', ta: 'ta-IN' };
  const POND_NAMES = {
    pond1: { en: 'Pond 1', te: 'చెరువు 1', ta: 'குளம் 1' },
    tank: { en: 'Test tank', te: 'పరీక్ష ట్యాంక్', ta: 'சோதனைத் தொட்டி' },
  };
  const f1 = (x) => (typeof x === 'number' ? x.toFixed(1) : '–');

  // code -> language -> (pond name, vars) => text
  const T = {
    AERON: {
      en: (p, v) => `${p}: oxygen ${f1(v.do)} mg/L. Aerator started automatically.`,
      te: (p, v) => `${p}: ఆక్సిజన్ ${f1(v.do)} mg/L. ఏరేటర్ దానంతట అదే ఆన్ అయింది.`,
      ta: (p, v) => `${p}: ஆக்சிஜன் ${f1(v.do)} mg/L. ஏரேட்டர் தானாக இயங்கத் தொடங்கியது.`,
    },
    AERSTOP: {
      en: (p, v) => `${p}: oxygen back to ${f1(v.do)} mg/L. Aerator stopped.`,
      te: (p, v) => `${p}: ఆక్సిజన్ మళ్లీ ${f1(v.do)} mg/L. ఏరేటర్ ఆగింది.`,
      ta: (p, v) => `${p}: ஆக்சிஜன் மீண்டும் ${f1(v.do)} mg/L. ஏரேட்டர் நின்றது.`,
    },
    DOLOW: {
      en: (p, v) => `${p}: oxygen critical (${f1(v.do)} mg/L). Fish at risk. Check the pond now.`,
      te: (p, v) => `${p}: ఆక్సిజన్ ప్రమాద స్థాయిలో ఉంది (${f1(v.do)} mg/L). చేపలకు ప్రమాదం. వెంటనే చెరువు చూడండి.`,
      ta: (p, v) => `${p}: ஆக்சிஜன் அபாய அளவில் (${f1(v.do)} mg/L). மீன்களுக்கு ஆபத்து. உடனே குளத்தைப் பாருங்கள்.`,
    },
    AEROFF: {
      en: (p, v) => `${p}: oxygen low (${f1(v.do)} mg/L) but the aerator is off. Check the mode.`,
      te: (p, v) => `${p}: ఆక్సిజన్ తక్కువ (${f1(v.do)} mg/L), కానీ ఏరేటర్ ఆఫ్‌లో ఉంది. మోడ్ చూడండి.`,
      ta: (p, v) => `${p}: ஆக்சிஜன் குறைவு (${f1(v.do)} mg/L), ஆனால் ஏரேட்டர் அணைந்துள்ளது. மோடை சரிபாருங்கள்.`,
    },
    FLT_PUMP: {   // 10
      en: (p) => `${p}: aerator switched ON but the motor is not running. Check it now.`,
      te: (p) => `${p}: ఏరేటర్ ఆన్ చేశాం కానీ మోటార్ తిరగడం లేదు. వెంటనే చూడండి.`,
      ta: (p) => `${p}: ஏரேட்டர் இயக்கப்பட்டது, ஆனால் மோட்டார் ஓடவில்லை. உடனே சரிபாருங்கள்.`,
    },
    FLT_WEAK: {   // 11
      en: (p) => `${p}: aerator is running but oxygen keeps falling. Check the paddles or add a second aerator.`,
      te: (p) => `${p}: ఏరేటర్ నడుస్తున్నా ఆక్సిజన్ తగ్గుతూనే ఉంది. పెడల్స్ చూడండి లేదా రెండో ఏరేటర్ పెట్టండి.`,
      ta: (p) => `${p}: ஏரேட்டர் ஓடியும் ஆக்சிஜன் குறைந்துகொண்டே இருக்கிறது. பேடில்களைச் சரிபாருங்கள் அல்லது இரண்டாவது ஏரேட்டர் போடுங்கள்.`,
    },
    FLT_SENSOR: { // 1-6
      en: (p, v) => `${p}: sensor problem (FLT ${v.flt}). Readings may be wrong. ${v.night ? 'Aerator kept ON for safety.' : ''}`.trim(),
      te: (p, v) => `${p}: సెన్సార్ సమస్య (FLT ${v.flt}). రీడింగ్స్ తప్పు కావచ్చు. ${v.night ? 'జాగ్రత్తగా ఏరేటర్ ఆన్‌లో ఉంచాం.' : ''}`.trim(),
      ta: (p, v) => `${p}: சென்சார் கோளாறு (FLT ${v.flt}). அளவீடுகள் தவறாக இருக்கலாம். ${v.night ? 'பாதுகாப்புக்காக ஏரேட்டர் இயக்கத்தில் உள்ளது.' : ''}`.trim(),
    },
    FLT_POWER: {  // 7
      en: (p) => `${p}: battery low on the pond sensor. Clean the solar panel.`,
      te: (p) => `${p}: చెరువు సెన్సార్ బ్యాటరీ తక్కువగా ఉంది. సోలార్ ప్యానెల్ శుభ్రం చేయండి.`,
      ta: (p) => `${p}: குள சென்சாரின் பேட்டரி குறைவு. சோலார் பேனலைச் சுத்தம் செய்யுங்கள்.`,
    },
    FLT_BUOY: {   // 20
      en: (p) => `${p}: no reading from the buoy for 35 min. Aerator running as a safety step.`,
      te: (p) => `${p}: 35 నిమిషాలుగా బోయ్ నుండి సమాచారం లేదు. జాగ్రత్తగా ఏరేటర్ నడుస్తోంది.`,
      ta: (p) => `${p}: 35 நிமிடமாக மிதவையிலிருந்து தகவல் இல்லை. பாதுகாப்புக்காக ஏரேட்டர் ஓடுகிறது.`,
    },
    FLT_BANK: {   // 21
      en: (p) => `${p}: aerator controller not answering. Check its power supply.`,
      te: (p) => `${p}: ఏరేటర్ కంట్రోలర్ స్పందించడం లేదు. దాని కరెంట్ సరఫరా చూడండి.`,
      ta: (p) => `${p}: ஏரேட்டர் கட்டுப்பாட்டுப் பெட்டி பதிலளிக்கவில்லை. மின்சாரத்தைச் சரிபாருங்கள்.`,
    },
    SILENT: {
      en: (p, v) => `${p}: no data for ${v.min} min. Check power and antenna.`,
      te: (p, v) => `${p}: ${v.min} నిమిషాలుగా సమాచారం రాలేదు. కరెంట్, యాంటెనా చూడండి.`,
      ta: (p, v) => `${p}: ${v.min} நிமிடமாக தகவல் வரவில்லை. மின்சாரம், ஆன்டெனாவைச் சரிபாருங்கள்.`,
    },
    CLEAR: {
      en: (p) => `${p}: problem cleared. Back to normal.`,
      te: (p) => `${p}: సమస్య తీరింది. మళ్లీ సాధారణ స్థితి.`,
      ta: (p) => `${p}: கோளாறு சரியானது. மீண்டும் இயல்பு நிலை.`,
    },
    FORECAST: {
      en: (p, v) => `${p}: oxygen is falling. Likely below 4 mg/L at about ${v.time}.`,
      te: (p, v) => `${p}: ఆక్సిజన్ తగ్గుతోంది. సుమారు ${v.time}కి 4 mg/L కంటే తక్కువ కావచ్చు.`,
      ta: (p, v) => `${p}: ஆக்சிஜன் குறைந்து வருகிறது. சுமார் ${v.time} மணிக்கு 4 mg/L-க்குக் கீழே போகலாம்.`,
    },
    NEWDEV: {
      en: (p, v) => `New device ${v.id} (${v.type}) joined the farm network.`,
      te: (p, v) => `కొత్త పరికరం ${v.id} (${v.type}) ఫార్మ్ నెట్‌వర్క్‌లో చేరింది.`,
      ta: (p, v) => `புதிய சாதனம் ${v.id} (${v.type}) பண்ணை நெட்வொர்க்கில் சேர்ந்தது.`,
    },
  };

  function textFor(code, pondKey, vars) {
    const t = T[code]; if (!t) return { en: code, te: code, ta: code };
    const k = String(pondKey || '').toUpperCase();
    const names = POND_NAMES[pondKey] || (pondKey ? { en: 'Pond ' + k, te: 'చెరువు ' + k, ta: 'குளம் ' + k } : { en: 'Farm', te: 'పొలం', ta: 'பண்ணை' });
    return { en: t.en(names.en, vars || {}), te: t.te(names.te, vars || {}), ta: t.ta(names.ta, vars || {}) };
  }
  function pondName(key, lang) { return textFor('CLEAR', key, {})[lang].split(':')[0]; }
  return { LANGS, VOICE, POND_NAMES, textFor, pondName };
});
