import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { ToastProvider } from "./context/ToastContext";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { isAllowedEmail } from "./lib/access";
import { AccessDenied } from "./pages/AccessDenied";
import { Login } from "./pages/Login";

// Code-split the pages so the initial bundle stays small (the scanner lib is
// loaded only when the /add route is actually opened).
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Products = lazy(() => import("./pages/Products").then((m) => ({ default: m.Products })));
const AddProduct = lazy(() => import("./pages/AddProduct").then((m) => ({ default: m.AddProduct })));
const Import = lazy(() => import("./pages/Import").then((m) => ({ default: m.Import })));
const Waste = lazy(() => import("./pages/Waste").then((m) => ({ default: m.Waste })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

export default function App() {
  // Theme is applied to <html> as early as possible.
  useTheme();
  const { user, loading, signOut } = useAuth();

  // Sessions belonging to a non-allowed email are signed out immediately.
  const blocked = Boolean(user && !isAllowedEmail(user.email));
  useEffect(() => {
    if (blocked) void signOut();
  }, [blocked, signOut]);

  if (loading) {
    return <PageLoader label="Caricamento…" />;
  }

  return (
    <ToastProvider>
      {blocked ? (
        <AccessDenied />
      ) : user ? (
        <Layout>
          <Suspense fallback={<PageLoader label="Caricamento…" />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/add" element={<AddProduct />} />
              <Route path="/import" element={<Import />} />
              <Route path="/waste" element={<Waste />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      ) : (
        <Login />
      )}
    </ToastProvider>
  );
}