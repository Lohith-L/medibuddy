package com.medibuddy.app.alarm;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.medibuddy.app.MainActivity;
import com.medibuddy.app.R;

/**
 * Full-screen alarm shown over the lock screen (launched by the alarm
 * notification's full-screen intent). Shows the medicine, dose and time with
 * "Taken" and "Snooze 10 min".
 *
 * Also used without UI as the target of the notification's "Taken" button,
 * because opening the app from a notification action must go through an
 * activity on Android 12+.
 */
public class AlarmActivity extends AppCompatActivity implements AlarmService.Listener {

    static final String EXTRA_ACTION = "alarm_action";
    static final String ACTION_TAKEN = "taken";

    private AlarmPayload shown;
    private TextView timeView, medicineView, doseView, moreView;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        // "Taken" pressed in a notification: act immediately, no screen.
        if (ACTION_TAKEN.equals(getIntent().getStringExtra(EXTRA_ACTION))) {
            AlarmPayload p = AlarmPayload.from(getIntent());
            if (p == null) p = AlarmService.current();
            if (p == null) finish();
            else if (p.isCaregiver()) acknowledge(p);
            else markTaken(p);
            return;
        }

        setContentView(R.layout.activity_alarm);
        timeView = findViewById(R.id.alarm_time);
        medicineView = findViewById(R.id.alarm_medicine);
        doseView = findViewById(R.id.alarm_dose);
        moreView = findViewById(R.id.alarm_more);

        findViewById(R.id.alarm_taken).setOnClickListener(v -> {
            if (shown == null) return;
            if (shown.isCaregiver()) acknowledge(shown);
            else markTaken(shown);
        });
        findViewById(R.id.alarm_snooze).setOnClickListener(v -> {
            if (shown != null) snooze(shown);
        });

        // The alarm must be answered: Back does nothing while it rings.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (AlarmService.current() == null) finish();
            }
        });

        AlarmPayload fromIntent = AlarmPayload.from(getIntent());
        render(AlarmService.current() != null ? AlarmService.current() : fromIntent, AlarmService.waitingCount());
    }

    /** singleTask: a notification tap while the alarm screen is already open lands here. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        AlarmPayload p = AlarmPayload.from(intent);
        if (ACTION_TAKEN.equals(intent.getStringExtra(EXTRA_ACTION))) {
            if (p == null) p = AlarmService.current();
            if (p != null && p.isCaregiver()) acknowledge(p);
            else if (p != null) markTaken(p);
            return;
        }
        if (timeView != null) {
            render(AlarmService.current() != null ? AlarmService.current() : p, AlarmService.waitingCount());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        AlarmService.setListener(this);
        if (timeView != null && AlarmService.current() != null) {
            render(AlarmService.current(), AlarmService.waitingCount());
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        AlarmService.setListener(null);
    }

    // ── AlarmService.Listener ─────────────────────────────────────────────

    @Override
    public void onAlarmChanged(@Nullable AlarmPayload current, int waiting) {
        runOnUiThread(() -> {
            if (current == null) {
                finish(); // nothing ringing any more (answered elsewhere or timed out)
            } else {
                render(current, waiting);
            }
        });
    }

    // ── UI ────────────────────────────────────────────────────────────────

    private void render(@Nullable AlarmPayload p, int waiting) {
        if (p == null) {
            finish();
            return;
        }
        shown = p;
        String lang = AlarmTexts.langFor(this, p);
        View root = findViewById(R.id.alarm_root);
        View snoozeButton = findViewById(R.id.alarm_snooze);
        String patient = p.patientName == null ? "" : p.patientName;
        if (p.isSos()) {
            // SOS: red, the patient's name, "I'm responding". No snooze.
            root.setBackgroundColor(0xFFB91C1C);
            ((TextView) findViewById(R.id.alarm_label)).setText(AlarmTexts.get(lang, "cgSosLabel"));
            ((TextView) findViewById(R.id.alarm_taken)).setText(AlarmTexts.get(lang, "cgResponding"));
            snoozeButton.setVisibility(View.GONE);
            timeView.setText(p.displayTime());
            medicineView.setText(AlarmTexts.get(lang, "cgSosTitle", "patient", patient));
            doseView.setText("");
        } else if (p.isCaregiver()) {
            // Missed dose: who missed what, "OK, I'll check". No snooze.
            root.setBackgroundResource(R.drawable.alarm_background);
            ((TextView) findViewById(R.id.alarm_label)).setText(AlarmTexts.get(lang, "cgMissedLabel"));
            ((TextView) findViewById(R.id.alarm_taken)).setText(AlarmTexts.get(lang, "cgOk"));
            snoozeButton.setVisibility(View.GONE);
            timeView.setText(p.displayTime());
            medicineView.setText(AlarmTexts.get(lang, "cgMissedTitle", "patient", patient).replace("{name}", p.medicineName == null ? "" : p.medicineName));
            doseView.setText(p.dose == null ? "" : p.dose);
        } else {
            root.setBackgroundResource(R.drawable.alarm_background);
            ((TextView) findViewById(R.id.alarm_label)).setText(AlarmTexts.get(lang, "label"));
            ((TextView) findViewById(R.id.alarm_taken)).setText(AlarmTexts.get(lang, "taken"));
            ((TextView) findViewById(R.id.alarm_snooze)).setText(AlarmTexts.get(lang, "snooze"));
            snoozeButton.setVisibility(View.VISIBLE);
            timeView.setText(p.displayTime());
            medicineView.setText(p.medicineName);
            doseView.setText(p.dose == null || p.dose.isEmpty() ? AlarmTexts.get(lang, "timeForMedicine") : p.dose);
        }
        if (waiting > 0) {
            moreView.setVisibility(View.VISIBLE);
            moreView.setText(AlarmTexts.get(lang, "moreDue", "n", String.valueOf(waiting)));
        } else {
            moreView.setVisibility(View.GONE);
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────

    private void markTaken(AlarmPayload p) {
        if (AlarmService.current() != null) {
            // The service records it, stops ringing (or moves to the next medicine).
            AlarmService.send(this, AlarmService.ACTION_TAKEN, p);
        } else {
            AlarmStore.addPendingAction(this, p, "taken");
            MedicineAlarmPlugin.notifyDoseAction();
        }
        AlarmNotifications.cancelReminderFor(this, p);

        // More medicines still ringing: stay on the alarm screen for the next one.
        if (AlarmService.waitingCount() > 0 && timeView != null) {
            Toast.makeText(this, AlarmTexts.get(AlarmTexts.langFor(this, p), "markedTaken", "name", p.medicineName), Toast.LENGTH_SHORT).show();
            return;
        }
        openAppToLogDose(p);
    }

    /** Caregiver "OK, I'll check" / "I'm responding": stops this alarm (nothing is logged on the phone). */
    private void acknowledge(AlarmPayload p) {
        AlarmService.send(this, AlarmService.ACTION_ACK, p);
        if (AlarmService.waitingCount() == 0) finish();
    }

    private void snooze(AlarmPayload p) {
        AlarmService.send(this, AlarmService.ACTION_SNOOZE, p);
        Toast.makeText(this, AlarmTexts.get(AlarmTexts.langFor(this, p), "snoozed"), Toast.LENGTH_SHORT).show();
        if (AlarmService.waitingCount() == 0) finish();
    }

    /** Opens MediBuddy (after unlocking) so it writes the dose to Supabase. */
    private void openAppToLogDose(AlarmPayload p) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(
            "com.medibuddy.app://dose-taken?medicineId=" + Uri.encode(p.medicineId)
                + "&date=" + Uri.encode(p.date) + "&time=" + Uri.encode(p.time)));
        open.setClass(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (km != null && km.isKeyguardLocked() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    startActivity(open);
                    finish();
                }

                @Override
                public void onDismissCancelled() {
                    // Still saved locally; it syncs the next time the app opens.
                    finish();
                }

                @Override
                public void onDismissError() {
                    finish();
                }
            });
        } else {
            startActivity(open);
            finish();
        }
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
