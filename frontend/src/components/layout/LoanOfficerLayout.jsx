import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function LoanOfficerLayout() {
  const { user } = useAuth();
  if (user?.user_type !== "loan_officer" && user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
