# Security, Auth & RBAC Rules

## Authentication & Passwords
- **Token Format**: Standard JSON Web Tokens (JWT) using `@nestjs/jwt` and `passport-jwt`.
- **Password Hashing**: Use `@node-rs/bcrypt` (or `bcrypt`) with a minimum cost salt rounds of 10.
- **Brute Force Protection**: Protect login and sensitive authentication endpoints with `@nestjs/throttler`.

## Role & Permission-Based Access Control (RBAC + PBAC)
- **Hybrid Security Model**:
  - **Roles**: High-level system roles (e.g., `SUPER_ADMIN`, `COMPANY_ADMIN`, `STORE_MANAGER`, `CASHIER`, `INVENTORY_CLERK`, `ACCOUNTANT`).
  - **Permissions**: Fine-grained capability strings formatted as `resource:action` (e.g., `products:create`, `products:update`, `sales:checkout`, `sales:discount_override`, `sales:refund`, `sales:void`, `inventory:transfer`, `reports:view`).
- **Authorization Enforcement**:
  - Use custom `@RequirePermissions(...)` decorators backed by a global/scoped `PermissionsGuard`.
  - Use `@casl/ability` for Attribute-Based Access Control (ABAC) to enforce ownership and scope.
- **Multi-Branch Data Isolation**:
  - Staff members (Cashiers, Store Managers) must have their operations scoped to their assigned `branchId`.
  - Super Admins / Company Owners can switch branch context or view cross-branch aggregate reports.
  - Never allow a branch-scoped user to view or modify sales, inventory, or cash drawers of another branch.
