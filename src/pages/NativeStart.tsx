import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isIntroDone, markIntroDone } from "@/lib/startFlow";

/**
 * "/" in the Android app (the website shows the landing page instead).
 * Decides the first screen while the native splash is still showing:
 * logged in -> home, first launch -> intro slides, otherwise -> welcome.
 */
const NativeStart = () => {
  const { session, loading } = useAuth();
  const [introDone, setIntroDone] = useState<boolean | null>(null);

  useEffect(() => {
    void isIntroDone().then(setIntroDone);
  }, []);

  // Someone who is (or was) logged in knows the app: no intro after logging out.
  useEffect(() => {
    if (session) void markIntroDone();
  }, [session]);

  // Still deciding: the native splash covers this.
  if (loading || introDone === null) return <div className="min-h-screen bg-background" />;
  if (session) return <Navigate to="/home" replace />;
  return <Navigate to={introDone ? "/welcome" : "/intro"} replace />;
};

export default NativeStart;
