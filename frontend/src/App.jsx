import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AuthCallback from './pages/AuthCallback';
// Add page imports here
import Home from './pages/Home';
import Onboarding from './pages/Onboarding';
import FarmerLayout from './components/layout/FarmerLayout';
import VendorLayout from './components/layout/VendorLayout';
import BuyerLayout from './components/layout/BuyerLayout';
import FieldOfficerLayout from './components/layout/FieldOfficerLayout';
import LoanOfficerLayout from './components/layout/LoanOfficerLayout';
import AdminLayout from './components/layout/AdminLayout';
import AuthenticatedLayout from './components/layout/AuthenticatedLayout';
import FarmerProfileSetup from './pages/farmer/FarmerProfileSetup';
import FarmerDashboard from './pages/farmer/FarmerDashboard';
import Marketplace from './pages/farmer/Marketplace';
import ProductDetail from './pages/farmer/ProductDetails';
import Cart from './pages/farmer/Cart';
import Orders from './pages/farmer/Orders';
import OrderDetail from './pages/farmer/OrderDetail';
import Harvest from './pages/farmer/Harvest';
import VendorProfileSetup from './pages/vendor/VendorProfileSetup';
import VendorDashboard from './pages/vendor/VendorDashboard';
import VendorProducts from './pages/vendor/VendorProducts';
import VendorOrders from './pages/vendor/VendorOrders';
import VendorRedeem from './pages/vendor/VendorRedeem';
import VendorSettlements from './pages/vendor/VendorSettlements';
import VendorEmployees from './pages/vendor/VendorEmployees';
import VendorEmployeePending from './pages/vendor/VendorEmployeePending';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminApprovals from './pages/admin/AdminApprovals';
import AdminUsers from './pages/admin/AdminUsers';
import AdminVouchers from './pages/admin/AdminVouchers';
import AdminHarvest from './pages/admin/AdminHarvest';
import AdminLoanSettings from './pages/admin/AdminLoanSettings';
import AdminFunding from './pages/admin/AdminFunding';
import AdminOversight from './pages/admin/AdminOversight';
import AdminInterest from './pages/admin/AdminInterest';
import AdminFieldVerifications from './pages/admin/AdminFieldVerifications';
import VendorProductDetail from './pages/vendor/VendorProductDetails';
import Notifications from './pages/Notifications';
import DeleteAccount from './pages/DeleteAccount';
import BuyerDashboard from './pages/buyer/BuyerDashboard';
import BuyerProfileSetup from './pages/buyer/BuyerProfileSetup';
import BuyerContracts from './pages/buyer/BuyerContracts';
import BuyerMonitoring from './pages/buyer/BuyerMonitoring';
import BuyerDeliveries from './pages/buyer/BuyerDeliveries';
import FarmerContracts from './pages/farmer/FarmerContracts';
import FieldOfficerDashboard from './pages/fieldofficer/FieldOfficerDashboard';
import FieldOfficerProfileSetup from './pages/fieldofficer/FieldOfficerProfileSetup';
import FieldOfficerAssignments from './pages/fieldofficer/FieldOfficerAssignments';
import FieldOfficerVerification from './pages/fieldofficer/FieldOfficerVerification';
import LoanOfficerDashboard from './pages/loanofficer/LoanOfficerDashboard';
import LoanOfficerApplications from './pages/loanofficer/LoanOfficerApplications';
import LoanOfficerApplicationReview from './pages/loanofficer/LoanOfficerApplicationReview';
import LoanOfficerContracts from './pages/loanofficer/LoanOfficerContracts';
import LoanOfficerPortfolio from './pages/loanofficer/LoanOfficerPortfolio';
import Messages from './pages/Messages';
import MyLoan from './pages/farmer/MyLoan';
import Complaints from './pages/Complaints';
import LegalCenter from './pages/LegalCenter';
import PartnerLayout from './components/layout/PartnerLayout';
import PartnerWorkspace from './pages/partner/PartnerWorkspace';

const AuthenticatedApp = () => {
  const { isLoadingAuth } = useAuth();

  // Wait for the session check so protected pages don't flash the login screen
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AuthenticatedLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/delete-account" element={<DeleteAccount />} />
        <Route path="/complaints" element={<Complaints />} />
        <Route path="/terms" element={<LegalCenter />} />
        <Route path="/privacy" element={<LegalCenter />} />
        <Route path="/help" element={<LegalCenter />} />
        <Route path="/vendor/employee-pending" element={<VendorEmployeePending />} />

        <Route element={<FieldOfficerLayout />}>
          <Route path="/fieldofficer/dashboard" element={<FieldOfficerDashboard />} />
          <Route path="/fieldofficer/profile" element={<FieldOfficerProfileSetup />} />
          <Route path="/fieldofficer/assignments" element={<FieldOfficerAssignments />} />
          <Route path="/fieldofficer/verification/:verificationId" element={<FieldOfficerVerification />} />
        </Route>

        <Route element={<LoanOfficerLayout />}>
          <Route path="/loanofficer/dashboard" element={<LoanOfficerDashboard />} />
          <Route path="/loanofficer/applications" element={<LoanOfficerApplications />} />
          <Route path="/loanofficer/applications/:applicationId" element={<LoanOfficerApplicationReview />} />
          <Route path="/loanofficer/contracts" element={<LoanOfficerContracts />} />
          <Route path="/loanofficer/interest" element={<AdminInterest />} />
          <Route path="/loanofficer/portfolio" element={<LoanOfficerPortfolio />} />
        </Route>

        <Route element={<PartnerLayout />}>
          <Route path="/partner" element={<PartnerWorkspace />} />
          <Route path="/partner/interest" element={<AdminInterest />} />
        </Route>

        <Route element={<BuyerLayout />}>
          <Route path="/buyer/dashboard" element={<BuyerDashboard />} />
          <Route path="/buyer/profile" element={<BuyerProfileSetup />} />
          <Route path="/buyer/contracts" element={<BuyerContracts />} />
          <Route path="/buyer/monitoring" element={<BuyerMonitoring />} />
          <Route path="/buyer/deliveries" element={<BuyerDeliveries />} />
        </Route>

        <Route element={<FarmerLayout />}>
          <Route path="/farmer/dashboard" element={<FarmerDashboard />} />
          <Route path="/farmer/profile" element={<FarmerProfileSetup />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/marketplace/:productId" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:orderId" element={<OrderDetail />} />
          <Route path="/harvest" element={<Harvest />} />
          <Route path="/farmer/contracts" element={<FarmerContracts />} />
          <Route path="/farmer/my-loan" element={<MyLoan />} />
        </Route>

        <Route element={<VendorLayout />}>
          <Route path="/vendor/dashboard" element={<VendorDashboard />} />
          <Route path="/vendor/profile" element={<VendorProfileSetup />} />
          <Route path="/vendor/products" element={<VendorProducts />} />
          <Route path="/vendor/orders" element={<VendorOrders />} />
          <Route path="/vendor/redeem" element={<VendorRedeem />} />
          <Route path="/vendor/settlements" element={<VendorSettlements />} />
          <Route path="/vendor/employees" element={<VendorEmployees />} />
          <Route path="/vendor/products/:productId" element={<VendorProductDetail />} />
        </Route>

        <Route element={<AdminLayout />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/approvals" element={<AdminApprovals />} />
          <Route path="/admin/field-verifications" element={<AdminFieldVerifications />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/vouchers" element={<AdminVouchers />} />
          <Route path="/admin/harvest" element={<AdminHarvest />} />
          <Route path="/admin/loan-settings" element={<AdminLoanSettings />} />
          <Route path="/admin/funding" element={<AdminFunding />} />
          <Route path="/admin/oversight" element={<AdminOversight />} />
          <Route path="/admin/interest" element={<AdminInterest />} />
        </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App