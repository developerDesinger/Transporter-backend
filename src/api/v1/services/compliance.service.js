const mongoose = require("mongoose");
const ComplianceAlert = require("../models/complianceAlert.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const ALERT_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const alertsCache = new Map();

const validateSeverity = (severity) => {
  if (!severity) return null;
  const normalized = severity.toString().toLowerCase();
  if (!["low", "medium", "high"].includes(normalized)) {
    throw new AppError("Invalid severity", HttpStatusCodes.BAD_REQUEST);
  }
  return normalized;
};

const validateEntityType = (entityType) => {
  if (!entityType) return null;
  const normalized = entityType.toString().toUpperCase();
  if (!["DRIVER", "VEHICLE", "JOB"].includes(normalized)) {
    throw new AppError("Invalid entityType", HttpStatusCodes.BAD_REQUEST);
  }
  return normalized;
};

class ComplianceService {
  static async getAlerts(query, user) {
    const organizationId =
      query.organizationId ||
      user.activeOrganizationId ||
      user.defaultOrganizationId ||
      null;

    let organizationObjectId = null;
    if (organizationId) {
      if (mongoose.Types.ObjectId.isValid(organizationId)) {
        organizationObjectId = new mongoose.Types.ObjectId(organizationId);
      } else {
        throw new AppError(
          "Invalid organizationId",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    const severityFilter = validateSeverity(query.severity);
    const entityTypeFilter = validateEntityType(query.entityType);
    const limit =
      query.limit && !Number.isNaN(parseInt(query.limit, 10))
        ? Math.min(Math.max(parseInt(query.limit, 10), 1), 50)
        : 10;

    const cacheKey = JSON.stringify({
      organizationId: organizationObjectId?.toString() || "unscoped",
      severityFilter,
      entityTypeFilter,
      limit,
    });

    const cached = alertsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const matchStage = {
      status: { $in: ["OPEN", "ESCALATED"] },
    };

    if (organizationObjectId) {
      matchStage.organizationId = organizationObjectId;
    }

    if (severityFilter) {
      matchStage.severity = severityFilter;
    }

    if (entityTypeFilter) {
      matchStage.entityType = entityTypeFilter;
    }

    const alerts = await ComplianceAlert.find(matchStage)
      .sort({ detectedAt: -1 })
      .limit(limit)
      .lean();

    const count = await ComplianceAlert.countDocuments(matchStage);

    const formattedAlerts = alerts.map((alert) => ({
      id: alert._id.toString(),
      title: alert.title,
      entity: alert.entityLabel,
      entityType: alert.entityType,
      description: alert.description || "",
      severity: alert.severity,
      detectedAt: alert.detectedAt ? alert.detectedAt.toISOString() : null,
      status: alert.status,
    }));

    const response = {
      alerts: formattedAlerts,
      count,
    };

    alertsCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + ALERT_CACHE_TTL_MS,
    });

    return response;
  }
}

module.exports = ComplianceService;


