/**
 * Permission definitions and role-based permission mapping
 * Permissions follow the format: category.module.action
 */

// Permission categories
const PERMISSION_CATEGORIES = {
  OPERATIONS: "operations",
  FINANCIALS: "financials",
  MASTER_DATA: "master_data",
  SYSTEM: "system",
  COR: "cor",
  TMS: "tms",
};

// Role-based permission mappings
const ROLE_PERMISSIONS = {
  SUPER_ADMIN: [], // Super admin has all permissions, so empty array means all
  ADMIN: [
    // Operations
    "operations.dashboard.view",
    "operations.daily_board.view",
    "operations.allocator.view",
    "operations.allocator.manage",
    "operations.jobs.view",
    "operations.jobs.manage",
    "operations.drivers.view",
    "operations.drivers.manage",
    "operations.vehicles.view",
    "operations.vehicles.manage",
    "operations.clients.view",
    "operations.clients.manage",
    "operations.cor.view",
    "operations.cor.manage",
    "operations.broadcasts.view",
    "operations.broadcasts.manage",
    // Financials
    "financials.dashboard.view",
    "financials.invoicing.view",
    "financials.invoicing.manage",
    "financials.reports.view",
    "financials.payroll.view",
    "financials.payroll.manage",
    "financials.receivables.view",
    "financials.receivables.manage",
    "financials.adjustments.view",
    "financials.adjustments.manage",
    "financials.adjustments.approve",
    // Master Data
    "master_data.view",
    "master_data.manage",
    // System
    "system.users.view",
    "system.users.manage",
    "system.settings.view",
    "system.settings.manage",
    // CoR
    "cor.dashboard.view",
    "cor.forms.view",
    "cor.forms.manage",
  ],
  OPERATIONS: [
    "operations.dashboard.view",
    "operations.daily_board.view",
    "operations.allocator.view",
    "operations.allocator.manage",
    "operations.jobs.view",
    "operations.jobs.manage",
    "operations.drivers.view",
    "operations.drivers.manage",
    "operations.vehicles.view",
    "operations.vehicles.manage",
    "operations.clients.view",
    "operations.clients.manage",
    "operations.cor.view",
    "operations.cor.manage",
    "operations.broadcasts.view",
    "operations.broadcasts.manage",
    "master_data.view",
    "cor.dashboard.view",
    "cor.forms.view",
    "cor.forms.manage",
  ],
  FINANCE: [
    "financials.dashboard.view",
    "financials.invoicing.view",
    "financials.invoicing.manage",
    "financials.reports.view",
    "financials.payroll.view",
    "financials.payroll.manage",
    "financials.receivables.view",
    "financials.receivables.manage",
    "financials.adjustments.view",
    "financials.adjustments.manage",
    "financials.adjustments.approve",
    "operations.jobs.view",
    "operations.drivers.view",
    "operations.vehicles.view",
  ],
  DRIVER: [
    "operations.dashboard.view",
    "driver.portal.view",
  ],
  STAFF: [
    "cor.dashboard.view",
    "cor.forms.view",
  ],
};

/**
 * Get permissions for a role
 * @param {string} role - System role
 * @param {boolean} isSuperAdmin - Whether user is super admin
 * @param {boolean} isTenantAdmin - Whether user is tenant admin
 * @param {Array} customPermissions - Custom permissions array
 * @returns {Array} Array of permission strings
 */
function getPermissionsForRole(role, isSuperAdmin = false, isTenantAdmin = false, customPermissions = []) {
  // Super admin has all permissions
  if (isSuperAdmin) {
    // Return all possible permissions or empty array to indicate "all"
    return [];
  }

  // Get base permissions from role
  const rolePermissions = ROLE_PERMISSIONS[role] || [];

  // Tenant admin gets additional permissions (if not super admin)
  let permissions = [...rolePermissions];
  
  if (isTenantAdmin) {
    // Tenant admin can manage users and settings within their organization
    permissions.push(
      "system.users.view",
      "system.users.manage",
      "system.settings.view",
      "system.settings.manage"
    );
  }

  // Add custom permissions if provided
  if (customPermissions && Array.isArray(customPermissions)) {
    permissions = [...permissions, ...customPermissions];
  }

  // Remove duplicates
  return [...new Set(permissions)];
}

/**
 * Get all available permissions
 * @returns {Array} Array of all permission strings
 */
function getAllPermissions() {
  const allPermissions = new Set();
  
  Object.values(ROLE_PERMISSIONS).forEach(permissions => {
    permissions.forEach(permission => allPermissions.add(permission));
  });

  return Array.from(allPermissions).sort();
}

module.exports = {
  PERMISSION_CATEGORIES,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  getAllPermissions,
};

