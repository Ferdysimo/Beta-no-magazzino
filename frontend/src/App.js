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
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
