# Sanctuary AgriConnect

React frontend (`frontend/`) + Django REST backend (`backend/`). Base44 (SDK, Vite plugin, hosted entities/auth/uploads/email) has been removed.

## Run locally
### Windows PowerShell
```powershell
Set-Location backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py runserver
```

### macOS/Linux
```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # DEBUG=True prints emails (OTP codes, reset links) to the console
python manage.py migrate
python manage.py createsuperuser   # becomes role "admin" -> admin pages in the app + /admin/
python manage.py runserver

# frontend (new terminal)
cd frontend && cp .env.example .env && npm install && npm run dev
```
Vite proxies `/api` and `/media` to Django, so no CORS setup is needed in dev. Tests: `cd backend && DEBUG=True python manage.py test`.

## What replaced what
| Base44 | Now |
|---|---|
| `base44.entities.X.*` | `api.entities.X.*` (`frontend/src/api/client.js`) -> `/api/entities/X/` (generic endpoints, one Django model per entity in `agri/models.py`) |
| entity `rls` rules | `agri/policies.py` (same rules, enforced server-side on every query) |
| `auth.*` (login, OTP register, reset, Google) | `accounts/` app: token auth, email OTP, password reset, Google OAuth |
| `integrations.Core.UploadPublicFile/PrivateFile` | `/api/files/upload/` (private files are served via short-lived signed links) |
| `integrations.Core.SendEmail` | `/api/integrations/send-email/` (registered recipients only, HTML sanitised, rate limited) |
| `entities.Message.subscribe` | authenticated WebSocket events, with polling fallback while disconnected |

The Messages page lets signed-in users search active system accounts by name, email, or account type and start a direct conversation by selecting a user. The recipient search excludes the current user and inactive accounts.

## Production notes
- Set `DEBUG=False`, a real `SECRET_KEY`, `ALLOWED_HOSTS`, SMTP settings, and `DB_ENGINE=postgres` (+ `psycopg`). `backend/Dockerfile` is provided.
- The backend ASGI app serves `/ws/messages/` over WebSockets. In development, run Django with `python manage.py runserver`; Vite proxies the WebSocket route. The production Docker image runs Daphne. Configure the reverse proxy/load balancer to forward WebSocket upgrades for `/ws/`.
- A local in-memory channel layer is used when `REDIS_URL` is unset. For multiple backend instances, configure `REDIS_URL` to a reachable Redis service so events reach users connected to any instance.
- Serve frontend and API from one origin (reverse proxy `/api`, `/media`, `/admin`, and `/ws` to Django). If split, set `VITE_API_URL`, `PUBLIC_BASE_URL`, `CORS_ALLOWED_ORIGINS`, and permit the frontend origin in `ALLOWED_HOSTS` for WebSocket origin validation.
- Uploads are stored on disk in `UPLOAD_ROOT` - mount a persistent volume or move to object storage.
- Google sign-in is optional: set `GOOGLE_CLIENT_ID/SECRET` and register `<API>/api/auth/google/callback/` as a redirect URI.
- Run `python manage.py accrue_loan_interest` at least daily using a monitored scheduler (for example, cron or Windows Task Scheduler). It posts each due monthly accrual once, keyed to each released tranche's monthly anniversary; rerunning it is safe. Interest is simple (not compounded) and applies only to outstanding released principal. Alert an operator on command failure and reconcile the resulting ledger entries.
- Admin dashboard visits and the Monthly Interest module also post any currently due accruals idempotently and report borrower-level principal, interest, total owed, and month-by-month ledger history. Active loan officers can view the portfolio; farmers see only their own balances and posted monthly interest on My loan. The scheduler remains necessary to accrue interest unattended between portal visits.
- Payout instructions are not disbursements. An administrator must confirm the external payment with its real provider reference before the facility is committed or a disbursement is posted to the append-only loan ledger. This application does not itself transfer funds.
- Buyer-backed harvest recovery records delivered quantity and unit, contract price, grade, and a private weigh-ticket or warehouse-receipt file. Buyers submit separate evidence-backed claims for loan withholding and the farmer's net proceeds; a different administrator must verify each claim. Only verified withholding is posted to the loan ledger. Harvest settlement status is derived from both payment obligations being verified, while any remaining loan balance stays visible as outstanding. Provider transactions are still entered and verified manually until a bank or mobile-money integration is implemented.
- Before launch, choose and integrate the actual payment, SMS/USSD, insurer, credit-bureau, and logistics providers; this code currently supplies workflows, not those third-party services. Complete local legal/compliance review, configure durable media and tested backups, and establish payout/ledger reconciliation and scheduler monitoring. Financial entity relationships still include string identifiers, so a relational migration and data-integrity plan is also a production hardening item.

## Behaviour changes worth knowing
Added hardening beyond the old rules: users can't self-approve (`account_status`, KYC/profile `status`, financing/settlement approval fields are admin-only); vouchers must match a signed agreement and the order total; a user's `user_type` can't be changed once chosen; `role` can't be set from the client; assigned field officers can read/verify their farmers; active buyer listings are visible to farmers (without `id_number`). Notifications can be created for any user (the app relies on this). `Settlement.voucher_id` is no longer required (buyer deliveries have none). Portfolio delinquency uses the oldest-installment-first allocation of recorded repayments; PAR and reserve amounts are estimates, not regulatory reporting or booked accounting reserves, until payment-to-installment allocation and reconciliation are implemented.

Frontend fixes made along the way: file/folder name casing (`UI`->`ui`, `Layout`->`layout`, etc.) so it builds on Linux; typo `offlake_contract_id`; Delete-account re-auth; removed Base44-only files (OAuthConsent, image transform helpers, UserNotRegisteredError). Pre-existing lint errors for unused imports remain.
