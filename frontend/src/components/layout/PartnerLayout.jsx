import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Outlet } from "react-router-dom";

const partnerTypes = ["insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative", "mobile_money", "compliance", "collections", "support_desk"];

export default function PartnerLayout() {
  const { user } = useAuth();
  if (!partnerTypes.includes(user?.user_type) && user?.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
