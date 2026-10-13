package com.medibuddy.app.alarm;

import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The spoken alarm sentence in the app's languages, and choosing a TTS voice
 * that is actually installed on the phone (falls back to English).
 *
 * Medicine names and doses are spoken exactly as written.
 */
public final class AlarmVoice {

    private AlarmVoice() {}

    /** Sentence before the list of medicines, per app language code. */
    static String intro(String lang) {
        switch (normalize(lang)) {
            case "hi": return "आपकी दवा लेने का समय हो गया है:";
            case "te": return "మీ మందు వేసుకునే సమయం అయ్యింది:";
            case "ta": return "உங்கள் மருந்தை எடுத்துக்கொள்ளும் நேரம் வந்துவிட்டது:";
            case "kn": return "ನಿಮ್ಮ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯವಾಗಿದೆ:";
            case "mr": return "तुमचे औषध घेण्याची वेळ झाली आहे:";
            case "bn": return "আপনার ওষুধ খাওয়ার সময় হয়েছে:";
            case "gu": return "તમારી દવા લેવાનો સમય થઈ ગયો છે:";
            case "ml": return "നിങ്ങളുടെ മരുന്ന് കഴിക്കാനുള്ള സമയമായി:";
            default:   return "It's time to take your medicine:";
        }
    }

    static Locale locale(String lang) {
        String code = normalize(lang);
        return "en".equals(code) ? new Locale("en", "IN") : new Locale(code, "IN");
    }

    static String normalize(String lang) {
        if (lang == null) return "en";
        String l = lang.trim().toLowerCase(Locale.US);
        int dash = l.indexOf('-');
        if (dash > 0) l = l.substring(0, dash);
        switch (l) {
            case "hi": case "te": case "ta": case "kn": case "mr": case "bn": case "gu": case "ml":
                return l;
            default:
                return "en";
        }
    }

    /** "It's time to take your medicine: Paracetamol, 500 mg; Cetirizine, 10 mg." */
    static String sentence(String lang, List<AlarmPayload> due) {
        StringBuilder sb = new StringBuilder(intro(lang)).append(' ');
        for (int i = 0; i < due.size(); i++) {
            AlarmPayload p = due.get(i);
            if (i > 0) sb.append("; ");
            sb.append(p.medicineName);
            if (p.dose != null && !p.dose.trim().isEmpty()) sb.append(", ").append(p.dose.trim());
        }
        return sb.append('.').toString();
    }

    /**
     * True when the TTS engine can speak this language offline right now
     * (voice data installed, no network needed).
     */
    static boolean hasInstalledVoice(TextToSpeech tts, Locale locale) {
        int availability;
        try {
            availability = tts.isLanguageAvailable(locale);
        } catch (Exception e) {
            return false;
        }
        if (availability < TextToSpeech.LANG_AVAILABLE) return false;

        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null || voices.isEmpty()) return true; // engine doesn't list voices; trust availability
            for (Voice v : voices) {
                if (!v.getLocale().getLanguage().equals(locale.getLanguage())) continue;
                Set<String> features = v.getFeatures();
                boolean notInstalled = features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
                if (!notInstalled && !v.isNetworkConnectionRequired()) return true;
            }
            return false;
        } catch (Exception e) {
            return true;
        }
    }

    /** "{patient} missed {medicine} at {time}." / "Emergency! SOS from {patient}." */
    static String caregiverSentence(String lang, AlarmPayload p) {
        String patient = p.patientName == null || p.patientName.isEmpty() ? "your patient" : p.patientName;
        String med = p.medicineName == null ? "" : p.medicineName;
        String time = p.displayTime();
        if (p.isSos()) {
            switch (normalize(lang)) {
                case "hi": return "आपातकाल! " + patient + " से SOS।";
                case "te": return "అత్యవసరం! " + patient + " నుండి SOS.";
                case "ta": return "அவசரம்! " + patient + " இடமிருந்து SOS.";
                case "kn": return "ತುರ್ತು! " + patient + " ಅವರಿಂದ SOS.";
                case "mr": return "आणीबाणी! " + patient + " यांच्याकडून SOS.";
                case "bn": return "জরুরি! " + patient + "-এর থেকে SOS।";
                case "gu": return "કટોકટી! " + patient + " તરફથી SOS.";
                default:   return "Emergency! SOS from " + patient + ".";
            }
        }
        switch (normalize(lang)) {
            case "hi": return patient + " ने " + time + " बजे की " + med + " नहीं ली।";
            case "te": return patient + " " + time + " కి " + med + " తీసుకోలేదు.";
            case "ta": return patient + " " + time + " மணிக்கு " + med + " எடுக்கவில்லை.";
            case "kn": return patient + " " + time + " ಕ್ಕೆ " + med + " ತೆಗೆದುಕೊಂಡಿಲ್ಲ.";
            case "mr": return patient + " यांनी " + time + " वाजताचे " + med + " घेतले नाही.";
            case "bn": return patient + " " + time + "-এর " + med + " খাননি।";
            case "gu": return patient + " એ " + time + " વાગ્યાની " + med + " લીધી નથી.";
            default:   return patient + " missed " + med + " at " + time + ".";
        }
    }

    static Choice chooseCaregiver(TextToSpeech tts, String lang, AlarmPayload p) {
        String code = normalize(lang);
        Locale wanted = locale(code);
        if (!"en".equals(code) && hasInstalledVoice(tts, wanted)) {
            return new Choice(caregiverSentence(code, p), wanted, false);
        }
        Locale english = new Locale("en", "IN");
        if (tts.isLanguageAvailable(english) < TextToSpeech.LANG_AVAILABLE) english = Locale.US;
        return new Choice(caregiverSentence("en", p), english, !"en".equals(code));
    }

    /** Result of choosing what to say and in which voice. */
    static final class Choice {
        final String text;
        final Locale locale;
        /** The app language had no installed voice, so English is used. */
        final boolean fellBack;

        Choice(String text, Locale locale, boolean fellBack) {
            this.text = text;
            this.locale = locale;
            this.fellBack = fellBack;
        }
    }

    static Choice choose(TextToSpeech tts, String lang, List<AlarmPayload> due) {
        String code = normalize(lang);
        Locale wanted = locale(code);
        if (!"en".equals(code) && hasInstalledVoice(tts, wanted)) {
            return new Choice(sentence(code, due), wanted, false);
        }
        Locale english = new Locale("en", "IN");
        if (tts.isLanguageAvailable(english) < TextToSpeech.LANG_AVAILABLE) english = Locale.US;
        return new Choice(sentence("en", due), english, !"en".equals(code));
    }
}
