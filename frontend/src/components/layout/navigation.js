import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Package,
  Percent,
  QrCode,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sprout,
  Store,
  Ticket,
  Truck,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";

const sharedItems = [
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/complaints", label: "Complaints", icon: ShieldCheck },
  { to: "/terms", label: "Terms", icon: FileText },
  { to: "/privacy", label: "Privacy & consent", icon: ShieldCheck },
  { to: "/help", label: "Help Centre", icon: LifeBuoy },
];

export const navigationByPortal = {
  admin: {
    label: "Admin Portal",
    items: [
      { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/admin/approvals", label: "Approvals", icon: ShieldCheck },
      { to: "/admin/field-verifications", label: "Field Verification Archive", icon: ClipboardCheck },
      { to: "/admin/users", label: "User Directory", icon: Users },
      { to: "/admin/vouchers", label: "Tokens & Settlements", icon: Ticket },
      { to: "/admin/harvest", label: "Harvest", icon: Sprout },
      { to: "/admin/loan-settings", label: "Financing Settings", icon: Settings },
      { to: "/admin/funding", label: "Funding & Ledger", icon: Wallet },
      { to: "/admin/interest", label: "Monthly Interest", icon: Percent },
      { to: "/admin/oversight", label: "Portfolio Oversight", icon: BarChart3 },
      ...sharedItems,
    ],
  },
  buyer: {
    label: "Buyer Portal",
    items: [
      { to: "/buyer/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/buyer/contracts", label: "Contracts", icon: FileText },
      { to: "/buyer/monitoring", label: "Crop Monitoring", icon: Sprout },
      { to: "/buyer/deliveries", label: "Deliveries", icon: Truck },
      { to: "/buyer/profile", label: "Profile & KYC", icon: UserCircle },
      ...sharedItems,
    ],
  },
  farmer: {
    label: "Farmer Portal",
    items: [
      { to: "/farmer/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/farmer/contracts", label: "Contracts", icon: FileText },
      { to: "/farmer/my-loan", label: "My loan", icon: Wallet },
      { to: "/marketplace", label: "Marketplace", icon: Store },
      { to: "/cart", label: "Cart", icon: ShoppingCart },
      { to: "/orders", label: "Orders", icon: ClipboardList },
      { to: "/harvest", label: "Harvest", icon: Sprout },
      { to: "/farmer/profile", label: "Profile & KYC", icon: UserCircle },
      ...sharedItems,
    ],
  },
  field_officer: {
    label: "Field Officer Portal",
    items: [
      { to: "/fieldofficer/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/fieldofficer/assignments", label: "Assignments", icon: ClipboardCheck },
      { to: "/fieldofficer/profile", label: "Profile & KYC", icon: UserCircle },
      ...sharedItems,
    ],
  },
  loan_officer: {
    label: "Loan Officer Portal",
    items: [
      { to: "/loanofficer/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/loanofficer/applications", label: "Applications", icon: ClipboardList },
      { to: "/loanofficer/contracts", label: "Contract Signing", icon: FileSignature },
      { to: "/loanofficer/interest", label: "Monthly Interest", icon: Percent },
      { to: "/loanofficer/portfolio", label: "Portfolio", icon: BriefcaseBusiness },
      ...sharedItems,
    ],
  },
  vendor: {
    label: "Vendor Portal",
    items: [
      { to: "/vendor/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/vendor/products", label: "Products", icon: Package },
      { to: "/vendor/orders", label: "Orders", icon: ClipboardList },
      { to: "/vendor/redeem", label: "Redeem Voucher", icon: QrCode },
      { to: "/vendor/settlements", label: "Settlements", icon: Wallet },
      { to: "/vendor/employees", label: "Employees", icon: Users },
      { to: "/vendor/profile", label: "Profile & KYC", icon: UserCircle },
      ...sharedItems,
    ],
  },
  partner: {
    label: "Partner Portal",
    items: [
      { to: "/partner", label: "Partner workspace", icon: BriefcaseBusiness },
      { to: "/partner/interest", label: "Monthly Interest", icon: Percent },
      ...sharedItems,
    ],
  },
};

export function getNavigationForUser(user) {
  if (user?.vendor_employment) {
    const items = navigationByPortal.vendor.items;
    if (user.vendor_employment.status !== "active") {
      return {
        ...navigationByPortal.vendor,
        items: sharedItems,
      };
    }
    return {
      ...navigationByPortal.vendor,
      items: user.vendor_employment.role === "manager"
        ? items
        : items.filter((item) => ["/vendor/products", "/vendor/orders"].includes(item.to) ||
          ["/notifications", "/messages", "/complaints", "/terms", "/privacy", "/help"].includes(item.to)),
    };
  }
  const portalKey = user?.role === "admin"
    ? "admin"
    : user?.user_type === "warehouse_logistics" ||
      user?.user_type === "insurer" ||
      user?.user_type === "credit_bureau" ||
      user?.user_type === "agronomist" ||
      user?.user_type === "cooperative" ||
      user?.user_type === "mobile_money" ||
      user?.user_type === "compliance" ||
      user?.user_type === "collections" ||
      user?.user_type === "support_desk"
      ? "partner"
      : user?.user_type || "farmer";

  const navigation = navigationByPortal[portalKey] || navigationByPortal.farmer;
  if (portalKey === "partner" && user?.user_type !== "collections") {
    return {
      ...navigation,
      items: navigation.items.filter((item) => item.to !== "/partner/interest"),
    };
  }
  return navigation;
}
