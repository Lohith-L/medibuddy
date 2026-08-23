import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
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
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<UploadPrescription />} />
            <Route path="/medicines" element={<Medicines />} />
            <Route path="/log" element={<MedicineLog />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/family-alerts" element={<FamilyAlerts />} />
            <Route path="/health-reports" element={<HealthReports />} />
            <Route path="/health" element={<Health />} />
            <Route path="/pharmacies" element={<Pharmacies />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
