import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Loader2, UserPlus, Users, Ban, CheckCircle2 } from "lucide-react";

const roleDescription = {
  assistant: "Manage products and orders",
  manager: "Full vendor workspace access, including settlements",
};

export default function VendorEmployees() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ employee_name: "", employee_email: "", role: "assistant" });
  const vendorUserId = user?.vendor_employment?.vendor_user_id || user?.id;
  const canManageTeam = !user?.vendor_employment || user.vendor_employment.role === "manager";

  const load = async () => {
    const [profiles, team] = await Promise.all([
      api.entities.VendorProfile.filter({ created_by_id: vendorUserId }),
      api.entities.VendorEmployee.filter({ vendor_user_id: vendorUserId }, "-created_date"),
    ]);
    setProfile(profiles[0] || null);
    setEmployees(team);
    setLoading(false);
  };

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError.message || "Could not load this vendor's employees.");
      setLoading(false);
    });
  }, [vendorUserId]);

  const inviteEmployee = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.users.inviteEmployee({
        email: form.employee_email,
        employee_name: form.employee_name,
        role: form.role,
      });
      setForm({ employee_name: "", employee_email: "", role: "assistant" });
      setSuccess(`Invitation sent to ${form.employee_email}. The employee must register with that email, then you can approve their access.`);
      await load();
    } catch (inviteError) {
      setError(inviteError.message || "Failed to invite employee.");
    } finally {
      setSaving(false);
    }
  };

  const updateEmployeeStatus = async (employee) => {
    const newStatus = employee.status === "active" ? "suspended" : "active";
    if (newStatus === "active" && !employee.employee_user_id) return;
    setActionId(employee.id);
    setError("");
    setSuccess("");
    try {
      await api.entities.VendorEmployee.update(employee.id, { status: newStatus });
      setSuccess(newStatus === "active"
        ? `${employee.employee_name}'s account is approved.`
        : `${employee.employee_name}'s vendor access is suspended.`);
      await load();
    } catch (actionError) {
      setError(actionError.message || "Could not update employee access.");
    } finally {
      setActionId("");
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;
  if (!profile) {
    return <EmptyState icon={Users} title="Complete your store profile first" description="Set up your vendor profile before managing employees." />;
  }

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employees</h1>
        <p className="mt-1 text-sm text-slate-500">Invite team members, review their details, and approve their access to {profile.business_name}.</p>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

      {canManageTeam && (
        <form onSubmit={inviteEmployee} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-medium text-slate-900">Invite New Employee</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="employee-name">Full Name</Label>
              <Input id="employee-name" required value={form.employee_name} onChange={(event) => setForm({ ...form, employee_name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employee-email">Email</Label>
              <Input id="employee-email" type="email" required value={form.employee_email} onChange={(event) => setForm({ ...form, employee_email: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employee-role">Role</Label>
              <select
                id="employee-role"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              >
                <option value="assistant">Assistant — manage products &amp; orders</option>
                <option value="manager">Manager — full access including settlements</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">The employee creates an account using this email. You approve access after registration.</p>
          <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">
            <UserPlus className="mr-1 h-4 w-4" /> {saving ? "Sending invite..." : "Invite Employee"}
          </Button>
        </form>
      )}

      {employees.length === 0 ? (
        <EmptyState icon={Users} title="No employees yet" description="Invite team members to help run your store." />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-medium text-slate-900">Your employees</h2>
            <p className="mt-1 text-xs text-slate-500">Select a team member to view their details and access status.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {employees.map((employee) => (
              <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <button type="button" onClick={() => setSelectedEmployeeId(employee.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-slate-900 hover:text-emerald-800">{employee.employee_name}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{employee.employee_email} · {employee.role}</span>
                </button>
                <div className="flex items-center gap-3">
                  <StatusBadge status={employee.status === "invited" && employee.employee_user_id ? "pending_approval" : employee.status} />
                  {canManageTeam && employee.employee_user_id && employee.status !== "invited" && (
                    <Button variant="outline" size="sm" disabled={actionId === employee.id} onClick={() => updateEmployeeStatus(employee)}>
                      {employee.status === "suspended"
                        ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve</>
                        : <><Ban className="mr-1 h-3.5 w-3.5" /> Suspend</>}
                    </Button>
                  )}
                  {canManageTeam && employee.employee_user_id && employee.status === "invited" && (
                    <Button size="sm" disabled={actionId === employee.id} onClick={() => updateEmployeeStatus(employee)} className="bg-emerald-800 hover:bg-emerald-900">
                      {actionId === employee.id ? "Approving..." : "Approve"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedEmployee && (
        <section aria-label="Employee details" className="rounded-2xl border border-emerald-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Employee details</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedEmployee.employee_name}</h2>
            </div>
            <StatusBadge status={selectedEmployee.status === "invited" && selectedEmployee.employee_user_id ? "pending_approval" : selectedEmployee.status} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">Email</dt><dd className="font-medium text-slate-800">{selectedEmployee.employee_email}</dd></div>
            <div><dt className="text-slate-400">Assigned role</dt><dd className="font-medium capitalize text-slate-800">{selectedEmployee.role}</dd></div>
            <div><dt className="text-slate-400">Access includes</dt><dd className="font-medium text-slate-800">{roleDescription[selectedEmployee.role]}</dd></div>
            <div><dt className="text-slate-400">Account registration</dt><dd className="font-medium text-slate-800">{selectedEmployee.employee_user_id ? "Registered" : "Invite sent; registration pending"}</dd></div>
            <div><dt className="text-slate-400">Invited</dt><dd className="font-medium text-slate-800">{new Date(selectedEmployee.created_date).toLocaleString()}</dd></div>
          </dl>
          {canManageTeam && selectedEmployee.employee_user_id && selectedEmployee.status === "invited" && (
            <Button className="mt-5 bg-emerald-800 hover:bg-emerald-900" disabled={actionId === selectedEmployee.id} onClick={() => updateEmployeeStatus(selectedEmployee)}>
              {actionId === selectedEmployee.id ? "Approving..." : "Approve employee account"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
