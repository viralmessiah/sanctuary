import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function VendorLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const employment = user?.vendor_employment;

  if (employment && employment.status !== "active") {
    return <Navigate to={`/vendor/employee-pending${employment.status === "suspended" ? "?status=suspended" : ""}`} replace />;
  }
  if (employment?.role === "assistant" &&
    !["/vendor/products", "/vendor/orders"].some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))) {
    return <Navigate to="/vendor/products" replace />;
  }

  return <Outlet />;
}