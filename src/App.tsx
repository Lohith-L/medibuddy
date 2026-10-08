import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import PublicRoute from "@/components/PublicRoute";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import UploadPrescription from "./pages/UploadPrescription";
import Medicines from "./pages/Medicines";
import MedicineLog from "./pages/MedicineLog";
import Profile from "./pages/Profile";
import FamilyAlerts from "./pages/FamilyAlerts";
import HealthReports from "./pages/HealthReports";
import Health from "./pages/Health";
import Pharmacies from "./pages/Pharmacies";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LanguageProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
