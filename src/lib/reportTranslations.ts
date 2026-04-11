export type ReportLang = "en" | "hi" | "kn" | "te" | "ta" | "mr";

const t: Record<string, Record<ReportLang, string>> = {
  title: { en: "Health Report", hi: "स्वास्थ्य रिपोर्ट", kn: "ಆರೋಗ್ಯ ವರದಿ", te: "ఆరోగ్య నివేదిక", ta: "சுகாதார அறிக்கை", mr: "आरोग्य अहवाल" },
  subtitle: { en: "Medicine Adherence Report", hi: "दवा पालन रिपोर्ट", kn: "ಔಷಧ ಅನುಸರಣೆ ವರದಿ", te: "మందుల పాటింపు నివేదిక", ta: "மருந்து இணக்க அறிக்கை", mr: "औषध पालन अहवाल" },
  patient: { en: "Patient", hi: "रोगी", kn: "ರೋಗಿ", te: "రోగి", ta: "நோயாளி", mr: "रुग्ण" },
  reportDate: { en: "Report Date", hi: "रिपोर्ट तिथि", kn: "ವರದಿ ದಿನಾಂಕ", te: "నివేదిక తేదీ", ta: "அறிக்கை தேதி", mr: "अहवाल तारीख" },
  period: { en: "Period", hi: "अवधि", kn: "ಅವಧಿ", te: "కాలం", ta: "காலம்", mr: "कालावधी" },
  lastFourWeeks: { en: "Last 4 Weeks", hi: "पिछले 4 सप्ताह", kn: "ಕಳೆದ 4 ವಾರಗಳು", te: "గత 4 వారాలు", ta: "கடந்த 4 வாரங்கள்", mr: "मागील 4 आठवडे" },
  summary: { en: "Summary", hi: "सारांश", kn: "ಸಾರಾಂಶ", te: "సారాంశం", ta: "சுருக்கம்", mr: "सारांश" },
  totalDoses: { en: "Total Doses", hi: "कुल खुराक", kn: "ಒಟ್ಟು ಡೋಸ್‌ಗಳು", te: "మొత్తం మోతాదులు", ta: "மொத்த மருந்தளவுகள்", mr: "एकूण डोस" },
  taken: { en: "Taken", hi: "ली गई", kn: "ತೆಗೆದುಕೊಂಡಿದೆ", te: "తీసుకున్నవి", ta: "எடுத்தவை", mr: "घेतले" },
  missed: { en: "Missed", hi: "छूटी हुई", kn: "ತಪ್ಪಿದವು", te: "మిస్ అయినవి", ta: "தவறியவை", mr: "चुकलेले" },
  pending: { en: "Pending", hi: "लंबित", kn: "ಬಾಕಿ", te: "పెండింగ్", ta: "நிலுவையில்", mr: "प्रलंबित" },
  adherence: { en: "Adherence", hi: "पालन", kn: "ಅನುಸರಣೆ", te: "పాటింపు", ta: "இணக்கம்", mr: "पालन" },
  streak: { en: "Current Streak", hi: "वर्तमान स्ट्रीक", kn: "ಪ್ರಸ್ತುತ ಸ್ಟ್ರೀಕ್", te: "ప్రస్తుత స్ట్రీక్", ta: "தற்போதைய தொடர்", mr: "सध्याची स्ट्रीक" },
  days: { en: "days", hi: "दिन", kn: "ದಿನಗಳು", te: "రోజులు", ta: "நாட்கள்", mr: "दिवस" },
  activeMedicines: { en: "Active Medicines", hi: "सक्रिय दवाएं", kn: "ಸಕ್ರಿಯ ಔಷಧಗಳು", te: "యాక్టివ్ మందులు", ta: "செயலில் உள்ள மருந்துகள்", mr: "सक्रिय औषधे" },
  weeklyBreakdown: { en: "Weekly Breakdown", hi: "साप्ताहिक विवरण", kn: "ಸಾಪ್ತಾಹಿಕ ವಿವರ", te: "వారపు వివరాలు", ta: "வாராந்திர விவரம்", mr: "साप्ताहिक तपशील" },
  week: { en: "Week", hi: "सप्ताह", kn: "ವಾರ", te: "వారం", ta: "வாரம்", mr: "आठवडा" },
  doses: { en: "Doses", hi: "खुराक", kn: "ಡೋಸ್", te: "మోతాదు", ta: "மருந்தளவு", mr: "डोस" },
  generatedAt: { en: "Generated on", hi: "तारीख को बनाया गया", kn: "ರಚಿಸಿದ ದಿನಾಂಕ", te: "రూపొందించిన తేదీ", ta: "உருவாக்கிய தேதி", mr: "तयार केल्याची तारीख" },
  downloadReport: { en: "Download Report", hi: "रिपोर्ट डाउनलोड करें", kn: "ವರದಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", te: "నివేదిక డౌన్‌లోడ్ చేయండి", ta: "அறிக்கையைப் பதிவிறக்கவும்", mr: "अहवाल डाउनलोड करा" },
  trend: { en: "Trend", hi: "रुझान", kn: "ಟ್ರೆಂಡ್", te: "ధోరణి", ta: "போக்கு", mr: "ट्रेंड" },
  improving: { en: "Improving", hi: "सुधार हो रहा है", kn: "ಸುಧಾರಿಸುತ್ತಿದೆ", te: "మెరుగవుతోంది", ta: "மேம்படுகிறது", mr: "सुधारणा होत आहे" },
  declining: { en: "Declining", hi: "गिरावट", kn: "ಕುಸಿಯುತ್ತಿದೆ", te: "తగ్గుతోంది", ta: "குறைகிறது", mr: "घसरण" },
  stable: { en: "Stable", hi: "स्थिर", kn: "ಸ್ಥಿರ", te: "స్థిరం", ta: "நிலையானது", mr: "स्थिर" },
  poweredBy: { en: "MedBuddy - Your Medicine Companion", hi: "MedBuddy - आपका दवा साथी", kn: "MedBuddy - ನಿಮ್ಮ ಔಷಧ ಸಂಗಾತಿ", te: "MedBuddy - మీ మందుల సహచరుడు", ta: "MedBuddy - உங்கள் மருந்துத் தோழன்", mr: "MedBuddy - तुमचा औषध साथीदार" },
};

export function tr(key: string, lang: string): string {
  const normLang = normalizeLang(lang);
  return t[key]?.[normLang] ?? t[key]?.en ?? key;
}

function normalizeLang(lang: string): ReportLang {
  const l = (lang || "en").toLowerCase().trim();
  if (l === "en" || l === "english" || l.startsWith("en")) return "en";
  if (l.startsWith("hi") || l === "hindi") return "hi";
  if (l.startsWith("kn") || l === "kannada") return "kn";
  if (l.startsWith("te") || l === "telugu") return "te";
  if (l.startsWith("ta") || l === "tamil") return "ta";
  if (l.startsWith("mr") || l === "marathi") return "mr";
  return "en";
}
