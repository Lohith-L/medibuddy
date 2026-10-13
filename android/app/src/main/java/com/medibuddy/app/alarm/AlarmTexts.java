package com.medibuddy.app.alarm;

import java.util.HashMap;
import java.util.Map;

/**
 * Text for the alarm notification and alarm screen in the app's languages.
 * The language comes from the alarm (saved when the app synced) so it matches
 * the app UI and the voice announcement. Medicine names are never translated.
 */
public final class AlarmTexts {

    private AlarmTexts() {}

    private static final Map<String, Map<String, String>> T = new HashMap<>();

    private static void put(String key, String en, String hi, String te, String ta, String kn, String mr, String bn, String gu) {
        Map<String, String> m = new HashMap<>();
        m.put("en", en);
        m.put("hi", hi);
        m.put("te", te);
        m.put("ta", ta);
        m.put("kn", kn);
        m.put("mr", mr);
        m.put("bn", bn);
        m.put("gu", gu);
        T.put(key, m);
    }

    static {
        put("timeFor",
            "Time for {name}",
            "{name} लेने का समय",
            "{name} వేసుకునే సమయం",
            "{name} எடுக்கும் நேரம்",
            "{name} ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ",
            "{name} घेण्याची वेळ",
            "{name} খাওয়ার সময়",
            "{name} લેવાનો સમય");
        put("cgMissedLabel",
            "Missed medicine", "छूटी दवा", "తప్పిన మందు", "தவறிய மருந்து", "ತಪ್ಪಿದ ಔಷಧ", "चुकलेले औषध", "বাদ পড়া ওষুধ", "ચૂકી ગયેલી દવા");
        put("cgMissedTitle",
            "{patient} missed {name}", "{patient} ने {name} नहीं ली", "{patient} {name} తీసుకోలేదు", "{patient} {name} எடுக்கவில்லை",
            "{patient} {name} ತೆಗೆದುಕೊಂಡಿಲ್ಲ", "{patient} यांनी {name} घेतले नाही", "{patient} {name} খাননি", "{patient} એ {name} લીધી નથી");
        put("cgSosLabel",
            "🚨 SOS", "🚨 SOS", "🚨 SOS", "🚨 SOS", "🚨 SOS", "🚨 SOS", "🚨 SOS", "🚨 SOS");
        put("cgSosTitle",
            "SOS from {patient}", "{patient} से SOS", "{patient} నుండి SOS", "{patient} இடமிருந்து SOS",
            "{patient} ಅವರಿಂದ SOS", "{patient} यांच्याकडून SOS", "{patient}-এর থেকে SOS", "{patient} તરફથી SOS");
        put("cgOk",
            "👍 OK, I'll check", "👍 ठीक है, मैं देखता/देखती हूँ", "👍 సరే, నేను చూస్తాను", "👍 சரி, நான் பார்க்கிறேன்",
            "👍 ಸರಿ, ನಾನು ನೋಡುತ್ತೇನೆ", "👍 ठीक आहे, मी पाहतो/पाहते", "👍 ঠিক আছে, আমি দেখছি", "👍 ઠીક છે, હું જોઉં છું");
        put("cgResponding",
            "🏃 I'm responding", "🏃 मैं आ रहा/रही हूँ", "🏃 నేను వస్తున్నాను", "🏃 நான் வருகிறேன்",
            "🏃 ನಾನು ಬರುತ್ತಿದ್ದೇನೆ", "🏃 मी येत आहे", "🏃 আমি আসছি", "🏃 હું આવું છું");
        put("taken",
            "✅ Taken", "✅ ले ली", "✅ వేసుకున్నాను", "✅ எடுத்தேன்", "✅ ತೆಗೆದುಕೊಂಡೆ", "✅ घेतले", "✅ নিয়েছি", "✅ લીધી");
        put("snooze",
            "⏰ Snooze 10 min", "⏰ 10 मिनट बाद", "⏰ 10 నిమిషాలు ఆపు", "⏰ 10 நிமிடம் தள்ளிவை", "⏰ 10 ನಿಮಿಷ ಮುಂದೂಡಿ",
            "⏰ 10 मिनिटे पुढे ढकला", "⏰ 10 মিনিট পরে", "⏰ 10 મિનિટ પછી");
        put("more",
            "+{n} more", "+{n} और", "+{n} ఇంకా", "+{n} மேலும்", "+{n} ಇನ್ನಷ್ಟು", "+{n} आणखी", "+আরও {n}", "+{n} વધુ");
        put("label",
            "Medicine reminder", "दवा रिमाइंडर", "మందుల రిమైండర్", "மருந்து நினைவூட்டல்", "ಔಷಧಿ ಜ್ಞಾಪನೆ",
            "औषध रिमाइंडर", "ওষুধের রিমাইন্ডার", "દવા રિમાઇન્ડર");
        put("timeForMedicine",
            "Time for your medicine", "आपकी दवा का समय", "మీ మందు సమయం", "உங்கள் மருந்து நேரம்", "ನಿಮ್ಮ ಔಷಧಿಯ ಸಮಯ",
            "तुमच्या औषधाची वेळ", "আপনার ওষুধের সময়", "તમારી દવાનો સમય");
        put("moreDue",
            "+{n} more due now", "+{n} और दवाएं अभी लेनी हैं", "+{n} మరిన్ని మందులు ఇప్పుడే", "+{n} மேலும் மருந்துகள் இப்போது",
            "+{n} ಇನ್ನಷ್ಟು ಔಷಧಿಗಳು ಈಗ", "+{n} आणखी औषधे आता", "+আরও {n}টি ওষুধ এখন", "+{n} વધુ દવાઓ હમણાં");
        put("missedTitle",
            "Missed dose: {name}", "छूटी खुराक: {name}", "తప్పిన మోతాదు: {name}", "தவறிய மருந்தளவு: {name}",
            "ತಪ್ಪಿದ ಡೋಸ್: {name}", "चुकलेला डोस: {name}", "বাদ পড়া ডোজ: {name}", "ચૂકી ગયેલો ડોઝ: {name}");
        put("missedText",
            "The {time} alarm wasn't answered. Tap to open MediBuddy.",
            "{time} का अलार्म नहीं सुना गया। MediBuddy खोलने के लिए टैप करें।",
            "{time} అలారానికి స్పందన లేదు. MediBuddy తెరవడానికి నొక్కండి.",
            "{time} அலாரத்துக்குப் பதில் இல்லை. MediBuddy-ஐத் திறக்க தட்டுங்கள்.",
            "{time} ಅಲಾರಂಗೆ ಉತ್ತರ ಬರಲಿಲ್ಲ. MediBuddy ತೆರೆಯಲು ಒತ್ತಿ.",
            "{time} चा अलार्म ऐकला गेला नाही. MediBuddy उघडण्यासाठी टॅप करा.",
            "{time}-এর অ্যালার্মে সাড়া মেলেনি। MediBuddy খুলতে ট্যাপ করুন।",
            "{time} ના એલાર્મનો જવાબ ન મળ્યો. MediBuddy ખોલવા ટૅપ કરો.");
        put("markedTaken",
            "{name} marked as taken", "{name} ली गई के रूप में दर्ज", "{name} వేసుకున్నట్లు నమోదైంది", "{name} எடுத்ததாகக் குறிக்கப்பட்டது",
            "{name} ತೆಗೆದುಕೊಂಡಿದ್ದೆಂದು ಗುರುತಿಸಲಾಗಿದೆ", "{name} घेतले म्हणून नोंदवले", "{name} নেওয়া হয়েছে বলে চিহ্নিত", "{name} લીધી તરીકે નોંધ્યું");
        put("snoozed",
            "Snoozed for 10 minutes", "10 मिनट के लिए टाल दिया", "10 నిమిషాలు వాయిదా వేశాం", "10 நிமிடங்கள் தள்ளிவைக்கப்பட்டது",
            "10 ನಿಮಿಷ ಮುಂದೂಡಲಾಗಿದೆ", "10 मिनिटे पुढे ढकलले", "10 মিনিট পিছিয়ে দেওয়া হয়েছে", "10 મિનિટ પાછળ ઠેલ્યું");
        put("channelAlarm",
            "Medicine alarms", "दवा अलार्म", "మందుల అలారాలు", "மருந்து அலாரங்கள்", "ಔಷಧಿ ಅಲಾರಂಗಳು",
            "औषध अलार्म", "ওষুধের অ্যালার্ম", "દવાના એલાર્મ");
        put("channelReminder",
            "Medicine reminders", "दवा रिमाइंडर", "మందుల రిమైండర్‌లు", "மருந்து நினைவூட்டல்கள்", "ಔಷಧಿ ಜ್ಞಾಪನೆಗಳು",
            "औषध रिमाइंडर", "ওষুধের রিমাইন্ডার", "દવાના રિમાઇન્ડર");
        put("channelMissed",
            "Missed doses", "छूटी खुराकें", "తప్పిన మోతాదులు", "தவறிய மருந்தளவுகள்", "ತಪ್ಪಿದ ಡೋಸ್‌ಗಳು",
            "चुकलेले डोस", "বাদ পড়া ডোজ", "ચૂકી ગયેલા ડોઝ");
    }

    /** Text for `key` in `lang` (falls back to English), with {placeholders} filled. */
    static String get(String lang, String key, String... vars) {
        Map<String, String> m = T.get(key);
        if (m == null) return key;
        String text = m.get(AlarmVoice.normalize(lang));
        if (text == null) text = m.get("en");
        for (int i = 0; i + 1 < vars.length; i += 2) {
            text = text.replace("{" + vars[i] + "}", vars[i + 1] == null ? "" : vars[i + 1]);
        }
        return text;
    }

    /** The alarm's own language, or the app language saved at the last sync. */
    static String langFor(android.content.Context ctx, AlarmPayload p) {
        if (p != null && p.language != null && !p.language.isEmpty()) return p.language;
        return AlarmStore.getLanguage(ctx);
    }
}
