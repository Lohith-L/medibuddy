package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Foreground service for a ringing medicine alarm: voice only, no ringtone.
 *
 *  - Speaks "It's time to take your medicine: <name>, <dose>." (every medicine
 *    due right now) with TextToSpeech on the ALARM stream (USAGE_ALARM +
 *    CONTENT_TYPE_SPEECH), in the app language (English if that voice is missing).
 *  - Speak, pause ~10 s, speak again ... until Taken / Snooze, at most 2 minutes,
 *    then a "Missed dose" notification.
 *  - While ringing: alarm volume at maximum, Do Not Disturb relaxed to
 *    "alarms only" if it would block alarms (see AlarmAudioGuard), audio focus
 *    held exclusively so music / videos pause, repeating vibration.
 *    Everything is restored when the alarm stops.
 *  - If TextToSpeech can't start or has no voice, a short beep plays on the
 *    alarm stream instead, so the reminder is never silent.
 *
 * Several medicines due at once are queued and shown one after another.
 */
public class AlarmService extends Service {

    private static final String TAG = "MedicineAlarm";

    public static final String ACTION_START = "com.medibuddy.app.alarm.START";
    public static final String ACTION_TAKEN = "com.medibuddy.app.alarm.TAKEN";
    public static final String ACTION_SNOOZE = "com.medibuddy.app.alarm.SNOOZE";
    public static final String ACTION_DISMISS_ALL = "com.medibuddy.app.alarm.DISMISS_ALL";

    private static final long RING_TIMEOUT_MS = 2 * 60 * 1000L;
    /** Silence between two announcements. */
    private static final long PAUSE_BETWEEN_MS = 10_000L;
    /** How long to wait for TextToSpeech to start before beeping instead. */
    private static final long TTS_START_WAIT_MS = 8_000L;
    /** Treat the announcement as finished even if TTS never reports it. */
    private static final long SPEECH_SAFETY_MS = 30_000L;
    private static final int BEEP_MS = 1_200;

    /** Lets the alarm screen follow what is ringing. Same process, main thread only. */
    public interface Listener {
        void onAlarmChanged(@Nullable AlarmPayload current, int waiting);
    }

    private static AlarmService instance;
    private static Listener listener;

    private final List<AlarmPayload> queue = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onTimeout;

    private Vibrator vibrator;
    private ToneGenerator beeper;
    private boolean ringing;
    private long ringStart;
    private PowerManager.WakeLock wakeLock;
    private boolean inForeground;

    private TextToSpeech tts;
    private boolean ttsReady;
    /** TextToSpeech failed to start: use the beep. */
    private boolean ttsFailed;
    /** Beeped because the engine was still starting: speak as soon as it is ready. */
    private boolean waitingForTts;
    private long ttsInitStart;
    private boolean speaking;
    private long lastSpeakStart;
    private int utteranceCounter;
    private final Runnable speakRunnable = this::speakAnnouncement;
    private final Runnable speechSafety = this::onSpeechFinished;

    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    // ── Static access for AlarmActivity ───────────────────────────────────

    @Nullable
    public static AlarmPayload current() {
        AlarmService s = instance;
        return s == null || s.queue.isEmpty() ? null : s.queue.get(0);
    }

    public static int waitingCount() {
        AlarmService s = instance;
        return s == null ? 0 : Math.max(0, s.queue.size() - 1);
    }

    public static void setListener(@Nullable Listener l) {
        listener = l;
    }

    /** Sends a command (taken / snooze) to the running service. */
    public static void send(Context ctx, String action, @Nullable AlarmPayload p) {
        Intent i = new Intent(ctx, AlarmService.class).setAction(action);
        if (p != null) p.writeTo(i);
        try {
            ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "Could not reach alarm service", e);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        // A previous alarm may have been killed before it could restore the volume / DND.
        AlarmAudioGuard.restoreIfLeftOver(this);
        initTts();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        AlarmPayload payload = AlarmPayload.from(intent);

        // Every start via startForegroundService() must call startForeground() promptly.
        if (!inForeground) {
            AlarmPayload shown = payload != null ? payload : current();
            if (shown == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            goForeground(shown);
        }

        if (ACTION_START.equals(action) && payload != null) {
            enqueue(payload);
        } else if (ACTION_TAKEN.equals(action)) {
            AlarmPayload done = resolve(payload);
            if (done != null) {
                AlarmStore.addPendingAction(this, done, "taken");
                MedicineAlarmPlugin.notifyDoseAction();
                finishCurrent(done);
            }
        } else if (ACTION_SNOOZE.equals(action)) {
            AlarmPayload snoozed = resolve(payload);
            if (snoozed != null) {
                AlarmScheduler.snooze(this, snoozed);
                finishCurrent(snoozed);
            }
        } else if (ACTION_DISMISS_ALL.equals(action)) {
            queue.clear();
            stopEverything();
        }

        if (queue.isEmpty()) stopEverything();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopRinging(); // also restores the alarm volume and Do Not Disturb
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (instance == this) instance = null;
        notifyListener();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Queue handling ────────────────────────────────────────────────────

    private void enqueue(AlarmPayload p) {
        for (AlarmPayload q : queue) {
            if (q.id == p.id) return; // already ringing for this reminder
        }
        queue.add(p);
        if (queue.size() == 1) {
            startRinging();
            restartTimeout();
        }
        updateNotification();
        notifyListener();
    }

    /** The payload the user acted on: the one sent, or whatever is ringing now. */
    @Nullable
    private AlarmPayload resolve(@Nullable AlarmPayload sent) {
        if (sent != null) {
            for (AlarmPayload q : queue) {
                if (q.id == sent.id) return q;
            }
            // Not ringing any more (e.g. it already timed out): still honour the action.
            return sent;
        }
        return current();
    }

    private void finishCurrent(AlarmPayload p) {
        boolean wasFirst = !queue.isEmpty() && queue.get(0).id == p.id;
        queue.remove(p);
        if (queue.isEmpty()) return;
        if (wasFirst) restartTimeout();
        updateNotification();
        notifyListener();
    }

    private void onTimeout() {
        AlarmPayload p = current();
        if (p == null) return;
        Log.i(TAG, "Alarm #" + p.id + " not answered in 2 minutes");
        AlarmNotifications.showMissed(this, p);
        queue.remove(0);
        if (queue.isEmpty()) {
            stopEverything();
        } else {
            restartTimeout();
            updateNotification();
            notifyListener();
        }
    }

    private void restartTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_TIMEOUT_MS);
    }

    private void stopEverything() {
        stopRinging();
        handler.removeCallbacks(timeout);
        releaseWakeLock();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        inForeground = false;
        notifyListener();
        stopSelf();
    }

    // ── Foreground notification ───────────────────────────────────────────

    private void goForeground(AlarmPayload p) {
        Notification n = AlarmNotifications.buildAlarm(this, p, 0);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            : 0;
        ServiceCompat.startForeground(this, AlarmNotifications.ALARM_NOTIFICATION_ID, n, type);
        inForeground = true;
    }

    private void updateNotification() {
        AlarmPayload p = current();
        if (p == null) return;
        try {
            NotificationManagerCompat.from(this).notify(
                AlarmNotifications.ALARM_NOTIFICATION_ID,
                AlarmNotifications.buildAlarm(this, p, waitingCount())
            );
        } catch (SecurityException ignored) {
        }
    }

    private void notifyListener() {
        Listener l = listener;
        if (l != null) l.onAlarmChanged(current(), waitingCount());
    }

    // ── Ringing: voice, vibration, wake lock ───────────────────────────────

    private void startRinging() {
        if (ringing) return;
        ringing = true;
        ringStart = System.currentTimeMillis();
        acquireWakeLock();
        try {
            AlarmAudioGuard.apply(this); // max alarm volume, DND relaxed if needed
        } catch (Exception e) {
            Log.e(TAG, "Could not prepare alarm audio", e); // still speak
        }
        requestAudioFocus();
        startVibration();
        handler.removeCallbacks(speakRunnable);
        handler.post(speakRunnable);
    }

    private void startVibration() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = { 0, 800, 600 };
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build();
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs);
    }

    private void stopRinging() {
        handler.removeCallbacks(speakRunnable);
        handler.removeCallbacks(speechSafety);
        speaking = false;
        try {
            if (tts != null) tts.stop();
            if (beeper != null) {
                beeper.stopTone();
                beeper.release();
                beeper = null;
            }
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
            }
            abandonAudioFocus();
        } catch (Exception e) {
            Log.w(TAG, "Error while stopping the alarm", e);
        } finally {
            if (ringing) AlarmAudioGuard.restore(this);
            ringing = false;
        }
    }

    // ── Voice announcement ────────────────────────────────────────────────

    private void initTts() {
        // Post to the main thread: the init callback may run before the constructor returns.
        ttsInitStart = System.currentTimeMillis();
        tts = new TextToSpeech(getApplicationContext(), status -> handler.post(() -> {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                Log.e(TAG, "TextToSpeech failed to start (status " + status + "): beeping instead");
                ttsFailed = true;
                return;
            }
            tts.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
            tts.setSpeechRate(0.9f); // a little slower: easier for elderly users
            tts.setPitch(1.0f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    handler.post(AlarmService.this::onSpeechFinished);
                }

                @Override
                @Deprecated
                public void onError(String utteranceId) {
                    handler.post(() -> onSpeechError("onError"));
                }

                @Override
                public void onError(String utteranceId, int errorCode) {
                    handler.post(() -> onSpeechError("onError " + errorCode));
                }
            });
            ttsReady = true;
            Log.i(TAG, "TextToSpeech ready in " + (System.currentTimeMillis() - ttsInitStart) + " ms");
            if (ringing && waitingForTts && !speaking) {
                waitingForTts = false;
                handler.removeCallbacks(speakRunnable);
                handler.post(speakRunnable);
            }
        }));
    }

    /**
     * USAGE_ALARM normally (heard in silent / vibrate). If Do Not Disturb has muted
     * the alarm stream (e.g. "Total silence" on Android 15+, where apps can't relax
     * DND), use the accessibility stream, which DND never mutes.
     */
    private AudioAttributes speechAttributes() {
        boolean muted = AlarmAudioGuard.alarmStreamMuted(this);
        if (muted) Log.w(TAG, "Alarm stream is muted (Do Not Disturb): speaking on the accessibility stream");
        return new AudioAttributes.Builder()
            .setUsage(muted ? AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY : AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    /** Speaks every medicine that is due right now (or beeps if the voice can't). */
    private void speakAnnouncement() {
        if (queue.isEmpty() || !ringing) return;
        if (!ttsReady && !ttsFailed) {
            // Engine still starting: wait a little, then beep rather than stay silent.
            if (System.currentTimeMillis() - ringStart < TTS_START_WAIT_MS) {
                handler.postDelayed(speakRunnable, 300L);
            } else {
                Log.e(TAG, "TextToSpeech not ready after " + TTS_START_WAIT_MS + " ms: beeping");
                waitingForTts = true;
                beepAndScheduleNext();
            }
            return;
        }
        if (ttsFailed || tts == null) {
            beepAndScheduleNext();
            return;
        }

        String lang = queue.get(0).language;
        if (lang == null || lang.isEmpty()) lang = AlarmStore.getLanguage(this);
        AlarmVoice.Choice choice = AlarmVoice.choose(tts, lang, new ArrayList<>(queue));
        if (choice.fellBack) AlarmStore.setVoiceFallback(this, AlarmVoice.normalize(lang));

        int langResult = tts.setLanguage(choice.locale);
        if (langResult < TextToSpeech.LANG_AVAILABLE) {
            Log.e(TAG, "No TTS voice for " + choice.locale + " (" + langResult + "): beeping");
            beepAndScheduleNext();
            return;
        }

        tts.setAudioAttributes(speechAttributes());
        speaking = true;
        lastSpeakStart = System.currentTimeMillis();
        Log.i(TAG, "Speaking (" + choice.locale + "): " + choice.text);
        int speakResult = tts.speak(choice.text, TextToSpeech.QUEUE_FLUSH, null, "medicine-alarm-" + (++utteranceCounter));
        if (speakResult != TextToSpeech.SUCCESS) {
            onSpeechError("speak() returned " + speakResult);
            return;
        }
        handler.removeCallbacks(speechSafety);
        handler.postDelayed(speechSafety, SPEECH_SAFETY_MS);
    }

    private void onSpeechError(String why) {
        Log.e(TAG, "TextToSpeech error (" + why + "): beeping");
        speaking = false;
        handler.removeCallbacks(speechSafety);
        beepAndScheduleNext();
    }

    /** Pause ~10 s, then speak again. */
    private void onSpeechFinished() {
        if (!speaking) return;
        speaking = false;
        handler.removeCallbacks(speechSafety);
        scheduleNext();
    }

    private void scheduleNext() {
        if (queue.isEmpty() || !ringing) return;
        handler.removeCallbacks(speakRunnable);
        handler.postDelayed(speakRunnable, PAUSE_BETWEEN_MS);
    }

    /** Safety fallback: short beep on the alarm stream (already at max volume). */
    private void beepAndScheduleNext() {
        try {
            int stream = AlarmAudioGuard.alarmStreamMuted(this) ? AudioManager.STREAM_ACCESSIBILITY : AudioManager.STREAM_ALARM;
            if (beeper == null) beeper = new ToneGenerator(stream, ToneGenerator.MAX_VOLUME);
            beeper.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, BEEP_MS);
        } catch (RuntimeException e) {
            Log.e(TAG, "Fallback beep failed too", e);
        }
        scheduleNext();
    }

    // ── Audio focus: pause music / other audio while the alarm rings ──────

    private void requestAudioFocus() {
        if (audioManager == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        // Exclusive: music and videos pause (not just duck) for the whole alarm.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(change -> { /* the alarm keeps ringing */ })
                .build();
            audioManager.requestAudioFocus(focusRequest);
        } else {
            audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(null);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MediBuddy:MedicineAlarm");
        // Safety net: never hold it longer than a few alarms' worth of ringing.
        wakeLock.acquire(10 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }
}
