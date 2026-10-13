// Who am I (patient / caregiver) and whose data am I looking at?
//
// Pages that show a patient's data (medicines, health, reports, log, upload)
// use useActivePatient(): it is the signed-in user's own profile, or a linked
// patient picked in the "Viewing:" switcher. Writes are only allowed when the
// active patient is me or my caregiver link has 'manage' permission (RLS
// enforces the same on the server).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  clearHomeMode, fetchLinkedPatients, fetchMyProfile, readHomeMode, saveRoles, takeSignupRole, writeHomeMode,
  type CarePermission, type HomeMode, type LinkedPatient, type MyProfile, type Role,
} from "@/lib/care";

const VIEWING_KEY = "medibuddy.viewingPatientId";

export interface ActivePatient {
  patientId: string;
  name: string;
  isSelf: boolean;
  /** Can add / edit / delete this patient's data. */
  canManage: boolean;
  permission: CarePermission | "owner";
  timezone: string;
  missedDoseDelay: number;
  phone: string | null;
}

interface CareContextValue {
  loading: boolean;
  me: MyProfile | null;
  linked: LinkedPatient[];
  isPatient: boolean;
  isCaregiver: boolean;
  /** Caregiver who is not also a patient: patient-only features are hidden. */
  caregiverOnly: boolean;
  active: ActivePatient | null;
  /** Which home/nav to show. Fixed for single-role users; remembered for users with both roles. */
  mode: HomeMode;
  setMode: (mode: HomeMode) => void;
  /** Where "home" is for this user right now. */
  homePath: string;
  setViewing: (patientId: string | null) => void;
  refresh: () => Promise<void>;
  setRolesLocal: (roles: Role[]) => void;
}

const CareContext = createContext<CareContextValue | null>(null);

const readViewing = () => {
  try {
    return localStorage.getItem(VIEWING_KEY);
  } catch {
    return null;
  }
};

export const CareProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<MyProfile | null>(null);
  const [linked, setLinked] = useState<LinkedPatient[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(readViewing);
  const [loading, setLoading] = useState(true);
  const [storedMode, setStoredMode] = useState<HomeMode | null>(readHomeMode);
  /** Whose data is loaded: avoids using a signed-out (empty) state right after login. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setMe(null);
      setLinked([]);
      setLoadedFor(null);
      setLoading(false);
      return;
    }
    let [profile, patients] = await Promise.all([fetchMyProfile(user.id), fetchLinkedPatients()]);
    // Google sign-up: the role picked before the redirect is applied once here
    // (the server ignores it if this account already has a role).
    const picked = takeSignupRole();
    if (profile && !profile.rolesConfirmed && picked) {
      try {
        await saveRoles(user.id, [picked]);
        writeHomeMode(picked);
        setStoredMode(picked);
        profile = await fetchMyProfile(user.id);
      } catch (e) {
        console.warn("[care] could not save the sign-up role", e);
      }
    }
    setMe(profile);
    setLinked(patients);
    setLoadedFor(user.id);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void refresh();
  }, [authLoading, refresh]);

  // Access can be removed by the patient at any time: re-check when links change.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`care-links-${user.id}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "care_links", filter: `caregiver_id=eq.${user.id}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  // Realtime needs the table in the publication; also re-check whenever the app/tab comes back.
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user, refresh]);

  // The interface mode belongs to the session: forget it when the user signs out.
  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    const id = user?.id ?? null;
    if (prevUser.current && !id) {
      clearHomeMode();
      setStoredMode(null);
    }
    prevUser.current = id;
  }, [authLoading, user]);

  const setViewing = useCallback((patientId: string | null) => {
    setViewingId(patientId);
    try {
      if (patientId) localStorage.setItem(VIEWING_KEY, patientId);
      else localStorage.removeItem(VIEWING_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const setMode = useCallback((m: HomeMode) => {
    writeHomeMode(m);
    setStoredMode(m);
  }, []);

  const setRolesLocal = useCallback((roles: Role[]) => {
    setMe((m) => (m ? { ...m, roles, rolesConfirmed: true } : m));
  }, []);

  const value = useMemo<CareContextValue>(() => {
    const isPatient = !!me?.roles.includes("patient");
    const isCaregiver = !!me?.roles.includes("caregiver") || linked.length > 0;
    const caregiverOnly = isCaregiver && !isPatient;
    // The login page decides the interface (stored with the session). Single-role
    // accounts are fixed; a caregiver-only account never gets the patient interface.
    const mode: HomeMode = caregiverOnly
      ? "caregiver"
      : !isCaregiver
        ? "patient"
        : storedMode ?? "patient";

    const fromLink = (l: LinkedPatient): ActivePatient => ({
      patientId: l.patientId,
      name: l.name,
      isSelf: false,
      canManage: l.permission === "manage",
      permission: l.permission,
      timezone: l.timezone,
      missedDoseDelay: l.missedDoseDelay,
      phone: l.phone,
    });

    let active: ActivePatient | null = null;
    if (mode === "caregiver") {
      // Caregiver mode: only linked patients, never my own patient data.
      const viewedLink = linked.find((l) => l.patientId === viewingId) ?? linked[0] ?? null;
      active = viewedLink ? fromLink(viewedLink) : null;
    } else if (me) {
      // Patient mode: only my own data.
      active = {
        patientId: me.patientId,
        name: me.name,
        isSelf: true,
        canManage: true,
        permission: "owner",
        timezone: me.timezone,
        missedDoseDelay: me.missedDoseDelay,
        phone: null,
      };
    }

    return {
      loading: loading || authLoading || (!!user && loadedFor !== user.id),
      me,
      linked,
      isPatient,
      isCaregiver,
      caregiverOnly,
      active,
      mode,
      setMode,
      homePath: !me || !me.rolesConfirmed ? "/choose-role" : mode === "caregiver" ? "/care" : "/dashboard",
      setViewing,
      refresh,
      setRolesLocal,
    };
  }, [loading, authLoading, user, loadedFor, me, linked, viewingId, storedMode, setViewing, refresh, setRolesLocal, setMode]);

  return <CareContext.Provider value={value}>{children}</CareContext.Provider>;
};

export function useCare(): CareContextValue {
  const ctx = useContext(CareContext);
  if (!ctx) throw new Error("useCare must be used inside CareProvider");
  return ctx;
}

/** The patient whose data the current page shows (me, or the patient I'm viewing). */
export function useActivePatient() {
  const { active, loading } = useCare();
  return { active, loading };
}
