package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.content.res.AssetFileDescriptor;
import android.media.MediaPlayer;
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

import com.medibuddy.app.R;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service for a ringing alarm: the patient's medicine alarm and the
 * caregiver alarms (missed dose, SOS).
 *
 * Pattern, repeated until Taken / Snooze / OK / I'm responding:
 *   medicine:   beep-beep-beep -> "It's time to take your medicine: <name>, <dose>." -> 3 s pause (max 2 min)
 *   missed:     beep-beep-beep -> "<patient> missed <medicine> at <time>."          -> 3 s pause (max 2 min)
 *   SOS:        siren (~5 s)   -> "Emergency! SOS from <patient>."                  -> repeat    (max 5 min)
 * Sound and voice never overlap: the voice starts when the sound's
 * OnCompletionListener fires, the next round after TTS onDone. Vibration runs
 * the whole time. Sound plays with USAGE_ALARM + CONTENT_TYPE_SONIFICATION, the
 * voice with USAGE_ALARM + CONTENT_TYPE_SPEECH (accessibility stream when DND
 * has muted alarms, see AlarmAudioGuard), alarm volume at max, restored after.
 * If TextToSpeech can't speak, the beep/siren keeps repeating on its own.
 * Settings "Alarm beep" / "Voice announcement" can turn one of them off (never both).
 */
public class AlarmService extends Service {

    private static final String TAG = "MedicineAlarm";

    public static final String ACTION_START = "com.medibuddy.app.alarm.START";
    public static final String ACTION_TAKEN = "com.medibuddy.app.alarm.TAKEN";
    public static final String ACTION_SNOOZE = "com.medibuddy.app.alarm.SNOOZE";
    public static final String ACTION_DISMISS_ALL = "com.medibuddy.app.alarm.DISMISS_ALL";

    public static final String ACTION_ACK = "com.medibuddy.app.alarm.ACK";

    private static final long RING_TIMEOUT_MS = 2 * 60 * 1000L;
    private static final long SOS_TIMEOUT_MS = 5 * 60 * 1000L;
    /** Silence after the voice before the next round (SOS: almost none). */
    private static final long PAUSE_MS = 3_000L;
    private static final long SOS_PAUSE_MS = 400L;
    /** How long to wait for TextToSpeech to start before skipping the voice this round. */
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
    /**
     * TextToSpeech stop/shutdown are blocking calls into the speech engine; while the
     * engine is still starting (e.g. Taken pressed during the first beep) they can block
     * for seconds. Run them here so the alarm screen never freezes (ANR).
     */
    private static final ExecutorService ttsWorker = Executors.newSingleThreadExecutor();
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
    private long ttsInitStart;
    private boolean speaking;
    private int utteranceCounter;
    private final Runnable speechSafety = this::onSpeechFinished;

    private MediaPlayer soundPlayer;
    private int soundRes;
    private int soundUsage = -1;
    private Runnable soundDone;
    private final Runnable soundTimeout = this::finishSound;
    /** Bumped when ringing stops: callbacks from an older round do nothing. */
    private int cycleGen;
    private final Runnable cycleRunnable = this::runCycle;

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
                // A caregiver alarm is never the caregiver's own dose: just stop it.
                if (!done.isCaregiver()) {
                    AlarmStore.addPendingAction(this, done, "taken");
                    MedicineAlarmPlugin.notifyDoseAction();
                }
                finishCurrent(done);
            }
        } else if (ACTION_SNOOZE.equals(action)) {
            AlarmPayload snoozed = resolve(payload);
            if (snoozed != null) {
                if (!snoozed.isCaregiver()) AlarmScheduler.snooze(this, snoozed);
                finishCurrent(snoozed);
            }
        } else if (ACTION_ACK.equals(action)) {
            AlarmPayload acked = resolve(payload);
            if (acked != null) finishCurrent(acked);
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
            final TextToSpeech t = tts;
            tts = null;
            ttsWorker.execute(() -> {
                try {
                    t.shutdown();
                } catch (RuntimeException ignored) {
                }
            });
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
        Log.i(TAG, "Alarm #" + p.id + " (" + p.kind + ") not answered in time");
        if (!p.isCaregiver()) AlarmNotifications.showMissed(this, p);
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
        AlarmPayload p = current();
        handler.postDelayed(timeout, p != null && p.isSos() ? SOS_TIMEOUT_MS : RING_TIMEOUT_MS);
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

    // ── Ringing: sound + voice pattern, vibration, wake lock ─────────────

    private void startRinging() {
        if (ringing) return;
        ringing = true;
        ringStart = System.currentTimeMillis();
        acquireWakeLock();
        try {
            AlarmAudioGuard.apply(this); // max alarm volume, DND relaxed if needed
        } catch (Exception e) {
            Log.e(TAG, "Could not prepare alarm audio", e); // still ring
        }
        requestAudioFocus();
        startVibration();
        cycleGen++;
        handler.removeCallbacks(cycleRunnable);
        handler.post(cycleRunnable);
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
        cycleGen++;
        handler.removeCallbacks(cycleRunnable);
        handler.removeCallbacks(speechSafety);
        handler.removeCallbacks(soundTimeout);
        soundDone = null;
        speaking = false;
        long t0 = System.currentTimeMillis();
        try {
            if (tts != null) {
                final TextToSpeech t = tts;
                ttsWorker.execute(() -> {
                    try {
                        t.stop();
                    } catch (RuntimeException ignored) {
                    }
                });
            }
            releaseSoundPlayer();
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
            long took = System.currentTimeMillis() - t0;
            if (took > 300) Log.w(TAG, "Stopping the alarm took " + took + " ms");
        }
    }

    // ── The pattern: sound -> voice -> pause -> again ─────────────────────

    /** One round: beep (or siren), then the voice. */
    private void runCycle() {
        if (queue.isEmpty() || !ringing) return;
        final int gen = cycleGen;
        AlarmPayload p = queue.get(0);
        boolean voiceUsable = AlarmStore.isVoiceEnabled(this) && !ttsFailed;
        // Never silent: without a usable voice the sound always plays.
        boolean sound = AlarmStore.isBeepEnabled(this) || !voiceUsable;
        if (sound) {
            playSound(p.isSos() ? R.raw.sos_siren : R.raw.alarm_beep, () -> {
                if (gen == cycleGen) afterSound();
            });
        } else {
            afterSound();
        }
    }

    /** The sound finished: speak (if on and possible), else go to the next round. */
    private void afterSound() {
        if (queue.isEmpty() || !ringing) return;
        if (!AlarmStore.isVoiceEnabled(this) || ttsFailed || tts == null) {
            scheduleNext();
            return;
        }
        if (!ttsReady) {
            if (System.currentTimeMillis() - ringStart < TTS_START_WAIT_MS) {
                final int gen = cycleGen;
                handler.postDelayed(() -> {
                    if (gen == cycleGen) afterSound();
                }, 300L);
            } else {
                Log.e(TAG, "TextToSpeech not ready after " + TTS_START_WAIT_MS + " ms: sound only this round");
                if (!AlarmStore.isBeepEnabled(this)) toneBeep();
                scheduleNext();
            }
            return;
        }
        speakNow();
    }

    private void scheduleNext() {
        if (queue.isEmpty() || !ringing) return;
        AlarmPayload p = queue.get(0);
        handler.removeCallbacks(cycleRunnable);
        handler.postDelayed(cycleRunnable, p.isSos() ? SOS_PAUSE_MS : PAUSE_MS);
    }

    // ── Sound (beep / siren) ──────────────────────────────────────────────

    private void playSound(int res, Runnable done) {
        handler.removeCallbacks(soundTimeout);
        soundDone = done;
        try {
            // Alarm stream normally; accessibility stream when DND has muted alarms.
            int usage = AlarmAudioGuard.alarmStreamMuted(this)
                ? AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY
                : AudioAttributes.USAGE_ALARM;
            if (soundPlayer == null || soundRes != res || soundUsage != usage) {
                releaseSoundPlayer();
                MediaPlayer mp = new MediaPlayer();
                mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(usage)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                try (AssetFileDescriptor afd = getResources().openRawResourceFd(res)) {
                    mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                }
                mp.prepare();
                mp.setOnCompletionListener(m -> handler.post(this::finishSound));
                mp.setOnErrorListener((m, what, extra) -> {
                    Log.e(TAG, "Alarm sound error " + what + "/" + extra);
                    handler.post(this::finishSound);
                    return true;
                });
                soundPlayer = mp;
                soundRes = res;
                soundUsage = usage;
            } else {
                soundPlayer.seekTo(0);
            }
            soundPlayer.start();
            Log.i(TAG, "Sound " + (res == R.raw.sos_siren ? "siren" : "beep") + " started (usage " + usage + ")");
            // Safety: continue even if the completion callback never comes.
            handler.postDelayed(soundTimeout, soundPlayer.getDuration() + 2_000L);
        } catch (Exception e) {
            Log.e(TAG, "Alarm sound failed: tone instead", e);
            releaseSoundPlayer();
            toneBeep();
            handler.postDelayed(soundTimeout, BEEP_MS + 300L);
        }
    }

    private void finishSound() {
        handler.removeCallbacks(soundTimeout);
        if (soundDone != null) Log.i(TAG, "Sound finished");
        Runnable d = soundDone;
        soundDone = null;
        if (d != null) d.run();
    }

    private void releaseSoundPlayer() {
        if (soundPlayer == null) return;
        try {
            soundPlayer.stop();
        } catch (Exception ignored) {
        }
        soundPlayer.release();
        soundPlayer = null;
        soundUsage = -1;
    }

    /** Last resort: a generated tone on the alarm stream (already at max volume). */
    private void toneBeep() {
        try {
            int stream = AlarmAudioGuard.alarmStreamMuted(this) ? AudioManager.STREAM_ACCESSIBILITY : AudioManager.STREAM_ALARM;
            if (beeper == null) beeper = new ToneGenerator(stream, ToneGenerator.MAX_VOLUME);
            beeper.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, BEEP_MS);
        } catch (RuntimeException e) {
            Log.e(TAG, "Fallback tone failed too", e);
        }
    }

    // ── Voice announcement ────────────────────────────────────────────────

    private void initTts() {
        ttsInitStart = System.currentTimeMillis();
        // Post to the main thread: the init callback may run before the constructor returns.
        tts = new TextToSpeech(getApplicationContext(), status -> handler.post(() -> {
            if (tts == null) return; // the alarm already stopped
            if (status != TextToSpeech.SUCCESS) {
                Log.e(TAG, "TextToSpeech failed to start (status " + status + "): sound only");
                ttsFailed = true;
                return;
            }
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
        }));
    }

    /**
     * USAGE_ALARM normally (heard in silent / vibrate). If Do Not Disturb has muted
     * the alarm stream (e.g. "Total silence" on Android 15+, where apps can't relax
     * DND), use the accessibility stream, which DND never mutes.
     */
    private AudioAttributes speechAttributes() {
        boolean muted = AlarmAudioGuard.alarmStreamMuted(this);
        if (muted) Log.w(TAG, "Alarm stream is muted (volume 0 or Do Not Disturb): speaking on the accessibility stream");
        return new AudioAttributes.Builder()
            .setUsage(muted ? AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY : AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    /** Medicine: every medicine due now. Caregiver: who missed what / who sent SOS. */
    private void speakNow() {
        AlarmPayload current = queue.get(0);
        String lang = current.language;
        if (lang == null || lang.isEmpty()) lang = AlarmStore.getLanguage(this);
        AlarmVoice.Choice choice;
        if (current.isCaregiver()) {
            choice = AlarmVoice.chooseCaregiver(tts, lang, current);
        } else {
            List<AlarmPayload> due = new ArrayList<>();
            for (AlarmPayload q : queue) if (!q.isCaregiver()) due.add(q);
            choice = AlarmVoice.choose(tts, lang, due);
        }
        if (choice.fellBack) AlarmStore.setVoiceFallback(this, AlarmVoice.normalize(lang));

        int langResult = tts.setLanguage(choice.locale);
        if (langResult < TextToSpeech.LANG_AVAILABLE) {
            onSpeechError("no voice for " + choice.locale + " (" + langResult + ")");
            return;
        }
        tts.setAudioAttributes(speechAttributes());
        speaking = true;
        Log.i(TAG, "Speaking (" + choice.locale + "): " + choice.text);
        int speakResult = tts.speak(choice.text, TextToSpeech.QUEUE_FLUSH, null, "medicine-alarm-" + (++utteranceCounter));
        if (speakResult != TextToSpeech.SUCCESS) {
            onSpeechError("speak() returned " + speakResult);
            return;
        }
        handler.removeCallbacks(speechSafety);
        handler.postDelayed(speechSafety, SPEECH_SAFETY_MS);
    }

    /** The voice failed this round: keep the sound going (never silent). */
    private void onSpeechError(String why) {
        Log.e(TAG, "TextToSpeech error (" + why + "): sound only");
        speaking = false;
        handler.removeCallbacks(speechSafety);
        if (!AlarmStore.isBeepEnabled(this)) toneBeep();
        scheduleNext();
    }

    private void onSpeechFinished() {
        if (!speaking) return;
        speaking = false;
        handler.removeCallbacks(speechSafety);
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
