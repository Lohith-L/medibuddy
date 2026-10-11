import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import PublicRoute from "@/components/PublicRoute";
import { MotionConfig } from "framer-motion";
import { Capacitor } from "@capacitor/core";

// Pages are loaded on demand so the first screen downloads and parses less
// JavaScript. Heavy libraries (Spline 3D, Leaflet maps, Recharts) now only
// load with the page that needs them.
const Landing = lazy(() => import("./pages/Landing"));
const Auth = lazy(() => import("./pages/Auth"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const UploadPrescription = lazy(() => import("./pages/UploadPrescription"));
const Medicines = lazy(() => import("./pages/Medicines"));
const MedicineLog = lazy(() => import("./pages/MedicineLog"));
const Profile = lazy(() => import("./pages/Profile"));
const FamilyAlerts = lazy(() => import("./pages/FamilyAlerts"));
const HealthReports = lazy(() => import("./pages/HealthReports"));
const Health = lazy(() => import("./pages/Health"));
const Pharmacies = lazy(() => import("./pages/Pharmacies"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AlarmSettings = lazy(() => import("./pages/AlarmSettings"));

const isNative = Capacitor.isNativePlatform();

/** Shown while a page's code is loading */
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
  </div>
);

import { useDeepLink } from "@/hooks/useDeepLink";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useMobilePolish } from "@/hooks/useMobilePolish";
import { useMedicineAlarmSync } from "@/hooks/useMedicineAlarmSync";

const queryClient = new QueryClient();

/** Inner component so hooks can access the Router context */
const AppRoutes = () => {
  // Handle OAuth deep links on Android/iOS (no-op on web)
  useDeepLink();
  // Register with FCM and save token to Supabase (no-op on web)
  usePushNotifications();
  // Status bar, splash screen, back button (no-op on web)
  useMobilePolish();
  // Keep phone medicine alarms in sync with the database (no-op on web)
  useMedicineAlarmSync();

  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public routes – redirect to /dashboard if already logged in */}
      <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
      <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Semi-public: onboarding runs right after Google OAuth callback */}
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

      {/* Protected routes – redirect to /auth if not logged in */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/upload" element={<ProtectedRoute><UploadPrescription /></ProtectedRoute>} />
      <Route path="/medicines" element={<ProtectedRoute><Medicines /></ProtectedRoute>} />
      <Route path="/log" element={<ProtectedRoute><MedicineLog /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/family-alerts" element={<ProtectedRoute><FamilyAlerts /></ProtectedRoute>} />
      <Route path="/health-reports" element={<ProtectedRoute><HealthReports /></ProtectedRoute>} />
      <Route path="/health" element={<ProtectedRoute><Health /></ProtectedRoute>} />
      <Route path="/pharmacies" element={<ProtectedRoute><Pharmacies /></ProtectedRoute>} />
      <Route path="/alarm-settings" element={<ProtectedRoute><AlarmSettings /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
};

const App = () => (
  // Honour the system "reduce motion" setting; in the app, skip movement
  // animations entirely (fades still run) to keep phones smooth.
  <MotionConfig reducedMotion={isNative ? "always" : "user"}>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LanguageProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </MotionConfig>
);

export default App;
