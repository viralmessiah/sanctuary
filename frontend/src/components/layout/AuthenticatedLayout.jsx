import { useAuth } from "@/lib/AuthContext";
import AppShell from "./AppShell";
import { getNavigationForUser } from "./navigation";

export default function AuthenticatedLayout() {
  const { user } = useAuth();
  const { items, label } = getNavigationForUser(user);

  return <AppShell navItems={items} portalLabel={label} />;
}
