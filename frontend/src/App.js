import React from 'react';
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { OrderProvider } from './contexts/OrderContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import CassaPage from './pages/CassaPage';
import BollitorePage from './pages/BollitorePage';
import GeneralePage from './pages/GeneralePage';
import ReportPage from './pages/ReportPage';
import ReportExcelPage from './pages/ReportExcelPage';
import FatturePage from './pages/FatturePage';
import VersamentiPage from './pages/VersamentiPage';
import ChiusurePage from './pages/ChiusurePage';
import BollitorePage2 from './pages/BollitorePage2';
import MonitorClientiPage from './pages/MonitorClientiPage';
import MagazzinierePage from './pages/MagazzinierePage';
import ProdottiMagazzinoPage from './pages/ProdottiMagazzinoPage';
import MediaLocaliPage from './pages/MediaLocaliPage';
import DiagnosticaLivePage from './pages/DiagnosticaLivePage';
import GeneraleHideLogPage from './pages/GeneraleHideLogPage';
import AdminDDTPage from './pages/AdminDDTPage';
import AdminFatturePage from './pages/AdminFatturePage';
import MagazzinoBevandePage from './pages/MagazzinoBevandePage';
import StoricoBevandePage from './pages/StoricoBevandePage';
import RichiestaMercePage from './pages/RichiestaMercePage';
import NuovaRichiestaPage from './pages/NuovaRichiestaPage';
import DDTViewPage from './pages/DDTViewPage';
import MagazzinoRichiestePage from './pages/MagazzinoRichiestePage';
import CarichiMagazzinoPage from './pages/CarichiMagazzinoPage';
import NuovoCaricoPage from './pages/NuovoCaricoPage';
import InventarioPage from './pages/InventarioPage';
import AnalisiPage from './pages/AnalisiPage';
import CronologiaMovimentiPage from './pages/CronologiaMovimentiPage';
import ReportBetaPage from './pages/ReportBetaPage';
import ReportIeriPage from './pages/ReportIeriPage';
import AuditCassaPage from './pages/AuditCassaPage';
import StoricoChiusurePage from './pages/StoricoChiusurePage';
import UpdateBanner from './components/UpdateBanner';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { token, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#F5C518]"></div>
      </div>
    );
  }
  
  if (!token) {
    return <Navigate to="/" replace />;
  }
  
  return <OrderProvider>{children}</OrderProvider>;
};

// Public Route - redirect to home if logged in
const PublicRoute = ({ children }) => {
  const { token, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#F5C518]"></div>
      </div>
    );
  }
  
  if (token) {
    return <Navigate to="/home" replace />;
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      } />
      <Route path="/home" element={
        <ProtectedRoute>
          <HomePage />
        </ProtectedRoute>
      } />
      <Route path="/cassa" element={
        <ProtectedRoute>
          <CassaPage />
        </ProtectedRoute>
      } />
      <Route path="/bollitore" element={
        <ProtectedRoute>
          <BollitorePage />
        </ProtectedRoute>
      } />
      <Route path="/generale" element={
        <ProtectedRoute>
          <GeneralePage />
        </ProtectedRoute>
      } />
      <Route path="/report" element={
        <ProtectedRoute>
          <ReportPage />
        </ProtectedRoute>
      } />
      <Route path="/report-excel" element={
        <ProtectedRoute>
          <ReportExcelPage />
        </ProtectedRoute>
      } />
      <Route path="/report-beta" element={
        <ProtectedRoute>
          <ReportBetaPage />
        </ProtectedRoute>
      } />
      <Route path="/report-ieri" element={
        <ProtectedRoute>
          <ReportIeriPage />
        </ProtectedRoute>
      } />
      <Route path="/audit-cassa" element={
        <ProtectedRoute>
          <AuditCassaPage />
        </ProtectedRoute>
      } />
      <Route path="/fatture" element={
        <ProtectedRoute>
          <FatturePage />
        </ProtectedRoute>
      } />
      <Route path="/versamenti" element={
        <ProtectedRoute>
          <VersamentiPage />
        </ProtectedRoute>
      } />
      <Route path="/chiusure" element={
        <ProtectedRoute>
          <ChiusurePage />
        </ProtectedRoute>
      } />
      <Route path="/bollitore2" element={
        <ProtectedRoute>
          <BollitorePage2 />
        </ProtectedRoute>
      } />
      <Route path="/monitor-clienti" element={
        <ProtectedRoute>
          <MonitorClientiPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino" element={
        <ProtectedRoute>
          <MagazzinierePage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/prodotti" element={
        <ProtectedRoute>
          <ProdottiMagazzinoPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/richieste-in-arrivo" element={
        <ProtectedRoute>
          <MagazzinoRichiestePage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/carichi" element={
        <ProtectedRoute>
          <CarichiMagazzinoPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/carichi/nuovo" element={
        <ProtectedRoute>
          <NuovoCaricoPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/carichi/:id/modifica" element={
        <ProtectedRoute>
          <NuovoCaricoPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/inventario" element={
        <ProtectedRoute>
          <InventarioPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/analisi" element={
        <ProtectedRoute>
          <AnalisiPage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino/cronologia" element={
        <ProtectedRoute>
          <CronologiaMovimentiPage />
        </ProtectedRoute>
      } />
      <Route path="/richiesta-merce" element={
        <ProtectedRoute>
          <RichiestaMercePage />
        </ProtectedRoute>
      } />
      <Route path="/richiesta-merce/nuova" element={
        <ProtectedRoute>
          <NuovaRichiestaPage />
        </ProtectedRoute>
      } />
      <Route path="/richiesta-merce/:id/modifica" element={
        <ProtectedRoute>
          <NuovaRichiestaPage />
        </ProtectedRoute>
      } />
      <Route path="/ddt/:id" element={
        <ProtectedRoute>
          <DDTViewPage />
        </ProtectedRoute>
      } />
      <Route path="/media-locali" element={
        <ProtectedRoute>
          <MediaLocaliPage />
        </ProtectedRoute>
      } />
      <Route path="/diagnostica" element={
        <ProtectedRoute>
          <DiagnosticaLivePage />
        </ProtectedRoute>
      } />
      <Route path="/cestino-generale" element={
        <ProtectedRoute>
          <GeneraleHideLogPage />
        </ProtectedRoute>
      } />
      <Route path="/admin/ddt" element={
        <ProtectedRoute>
          <AdminDDTPage />
        </ProtectedRoute>
      } />
      <Route path="/admin/fatture" element={
        <ProtectedRoute>
          <AdminFatturePage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino-bevande" element={
        <ProtectedRoute>
          <MagazzinoBevandePage />
        </ProtectedRoute>
      } />
      <Route path="/magazzino-bevande/storico" element={
        <ProtectedRoute>
          <StoricoBevandePage />
        </ProtectedRoute>
      } />
      <Route path="/storico-chiusure" element={
        <ProtectedRoute>
          <StoricoChiusurePage />
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <UpdateBanner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
