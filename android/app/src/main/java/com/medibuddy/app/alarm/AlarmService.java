package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
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
 * Foreground service that rings the alarm: loops the alarm sound on the ALARM
 * stream (plays in silent / Do Not Disturb when alarms are allowed), vibrates,
 * and keeps a full-screen notification up until the user answers.
 *
 * Several medicines due at once are queued and shown one after another.
 * Each one rings for at most 2 minutes, then becomes a "Missed dose" notification.
 *
 * Voice announcement (if enabled): tone for ~5 s, then the tone pauses while
 * TextToSpeech says "It's time to take your medicine: ..." (all medicines due)
 * in the app's language on the ALARM stream, then the tone resumes. The cycle
 * repeats every ~15 s until Taken / Snooze or the 2-minute limit.
 */
public class AlarmService extends Service {

    private static final String TAG = "MedicineAlarm";

    public static final String ACTION_START = "com.medibuddy.app.alarm.START";
    public static final String ACTION_TAKEN = "com.medibuddy.app.alarm.TAKEN";
    public static final String ACTION_SNOOZE = "com.medibuddy.app.alarm.SNOOZE";
    public static final String ACTION_DISMISS_ALL = "com.medibuddy.app.alarm.DISMISS_ALL";

    private static final long RING_TIMEOUT_MS = 2 * 60 * 1000L;
    /** Tone before the first announcement. */
    private static final long FIRST_SPEAK_DELAY_MS = 5_000L;
    /** One tone + voice cycle. */
    private static final long SPEAK_CYCLE_MS = 15_000L;
    /** Minimum tone between two announcements. */
    private static final long MIN_TONE_BETWEEN_MS = 4_000L;
    /** Resume the tone even if TTS never reports that it finished. */
    private static final long SPEECH_SAFETY_MS = 25_000L;

    /** Lets the alarm screen follow what is ringing. Same process, main thread only. */
    public interface Listener {
        void onAlarmChanged(@Nullable AlarmPayload current, int waiting);
    }

    private static AlarmService instance;
    private static Listener listener;

    private final List<AlarmPayload> queue = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onTimeout;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private boolean inForeground;

    private TextToSpeech tts;
    private boolean ttsReady;
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
        if (AlarmStore.isVoiceEnabled(this)) initTts();
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
        stopRinging();
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

    // ── Sound, vibration, wake lock ───────────────────────────────────────

    private void startRinging() {
        acquireWakeLock();
        requestAudioFocus();
        startSound();
        startVibration();
        if (AlarmStore.isVoiceEnabled(this)) {
            handler.removeCallbacks(speakRunnable);
            handler.postDelayed(speakRunnable, FIRST_SPEAK_DELAY_MS);
        }
    }

    private void startSound() {
        if (player != null) return;
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.e(TAG, "Could not play alarm sound", e);
            if (player != null) {
                player.release();
                player = null;
            }
        }
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs);
        } else {
            vibrator.vibrate(pattern, 0, attrs);
        }
    }

    private void stopRinging() {
        handler.removeCallbacks(speakRunnable);
        handler.removeCallbacks(speechSafety);
        speaking = false;
        if (tts != null) tts.stop();
        abandonAudioFocus();
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    // ── Voice announcement ────────────────────────────────────────────────

    private void initTts() {
        // Post to the main thread: the init callback may run before the constructor returns.
        tts = new TextToSpeech(getApplicationContext(), status -> handler.post(() -> {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                Log.w(TAG, "TextToSpeech unavailable (status " + status + ")");
                return;
            }
            tts.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
            tts.setSpeechRate(0.9f); // a little slower: easier for elderly users
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
                    handler.post(AlarmService.this::onSpeechFinished);
                }

                @Override
                public void onError(String utteranceId, int errorCode) {
                    handler.post(AlarmService.this::onSpeechFinished);
                }
            });
            ttsReady = true;
        }));
    }

    /** Pauses the tone and speaks every medicine that is due right now. */
    private void speakAnnouncement() {
        if (queue.isEmpty() || !AlarmStore.isVoiceEnabled(this)) return;
        if (tts == null) initTts();
        if (!ttsReady) {
            // Engine still starting: keep ringing and try again shortly.
            handler.postDelayed(speakRunnable, 1_000L);
            return;
        }

        String lang = queue.get(0).language;
        if (lang == null || lang.isEmpty()) lang = AlarmStore.getLanguage(this);
        AlarmVoice.Choice choice = AlarmVoice.choose(tts, lang, new ArrayList<>(queue));
        if (choice.fellBack) AlarmStore.setVoiceFallback(this, AlarmVoice.normalize(lang));

        int result = tts.setLanguage(choice.locale);
        if (result < TextToSpeech.LANG_AVAILABLE) {
            Log.w(TAG, "TTS language " + choice.locale + " not usable (" + result + ")");
        }

        if (player != null && player.isPlaying()) player.pause();
        speaking = true;
        lastSpeakStart = System.currentTimeMillis();
        int speakResult = tts.speak(choice.text, TextToSpeech.QUEUE_FLUSH, null, "medicine-alarm-" + (++utteranceCounter));
        if (speakResult != TextToSpeech.SUCCESS) {
            onSpeechFinished();
            return;
        }
        handler.removeCallbacks(speechSafety);
        handler.postDelayed(speechSafety, SPEECH_SAFETY_MS);
    }

    /** Resumes the tone and schedules the next announcement. */
    private void onSpeechFinished() {
        if (!speaking) return;
        speaking = false;
        handler.removeCallbacks(speechSafety);
        if (queue.isEmpty()) return;
        if (player != null && !player.isPlaying()) {
            try {
                player.start();
            } catch (IllegalStateException ignored) {
            }
        }
        long sinceStart = System.currentTimeMillis() - lastSpeakStart;
        long delay = Math.max(MIN_TONE_BETWEEN_MS, SPEAK_CYCLE_MS - sinceStart);
        handler.removeCallbacks(speakRunnable);
        handler.postDelayed(speakRunnable, delay);
    }

    // ── Audio focus: pause music / other audio while the alarm rings ──────

    private void requestAudioFocus() {
        if (audioManager == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(change -> { /* the alarm keeps ringing */ })
                .build();
            audioManager.requestAudioFocus(focusRequest);
        } else {
            audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
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
