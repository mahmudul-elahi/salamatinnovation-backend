# Security, Auth & RBAC Rules

## Authentication & Passwords
- **Token Format**: Standard JSON Web Tokens (JWT) using `@nestjs/jwt` and `passport-jwt`.
  - Access and refresh tokens use separate secrets and a `type` claim. Refresh tokens are single use (rotated through Redis by `jti`).
  - Tokens carry the user's `tokenVersion`; bump it (via `UsersService`) to revoke all sessions after a password change or security event.
- **Password Hashing**: Use `@node-rs/bcrypt` (or `bcrypt`) with a minimum cost salt rounds of 10.
- **Brute Force Protection**: Protect login and sensitive authentication endpoints with `@Throttle(AUTH_THROTTLE)` (Redis-backed `@nestjs/throttler`).
- **Secrets in logs**: Never log OTPs, tokens or passwords. Internal error details go to logs only, never to API responses.

## Role & Permission-Based Access Control (RBAC + PBAC)
- **Hybrid Security Model**:
  - **Roles**: High-level system roles (e.g., `SUPER_ADMIN`, `COMPANY_ADMIN`, `STORE_MANAGER`, `CASHIER`, `INVENTORY_CLERK`, `ACCOUNTANT`).
  - **Permissions**: Fine-grained capability strings formatted as `resource:action` (e.g., `products:create`, `products:update`, `sales:checkout`, `sales:discount_override`, `sales:refund`, `sales:void`, `inventory:transfer`, `reports:view`).
- **Authorization Enforcement**:
  - `JwtAuthGuard`, `RolesGuard` and `PermissionsGuard` are registered globally; just add `@RequirePermissions(...)` or `@Roles(...)` to a route (no `@UseGuards` needed).
  - Use `@casl/ability` for Attribute-Based Access Control (ABAC) to enforce ownership and scope.
- **Multi-Branch Data Isolation**:
  - Staff members (Cashiers, Store Managers) must have their operations scoped to their assigned `branchId`.
  - Super Admins / Company Owners can switch branch context or view cross-branch aggregate reports.
  - Never allow a branch-scoped user to view or modify sales, inventory, or cash drawers of another branch.
