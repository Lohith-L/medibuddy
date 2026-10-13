import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Invite link target: .../#/join?code=MB-K7Q4XP
 * Signed in -> accept on "Add patient". Not signed in -> caregiver sign-up with
 * the code filled in (that page links to login for people who have an account).
 */
const Join = () => {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const q = code ? `?code=${encodeURIComponent(code)}` : "";

  if (loading) return null;
  if (session) return <Navigate to={`/care/add${q}${q ? "&" : "?"}auto=1`} replace />;
  return <Navigate to={`/signup/caregiver${q}`} replace />;
};

export default Join;
