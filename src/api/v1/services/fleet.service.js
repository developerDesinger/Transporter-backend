const mongoose = require("mongoose");
const Vehicle = require("../models/vehicle.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const UTILIZATION_CACHE_TTL_MS = 60 * 1000; // 60 seconds

const fleetStatusCache = new Map();
const fleetUtilizationCache = new Map();
const fleetUtilizationTrendHistory = new Map();

const STATUS_BUCKETS = {
  active: new Set(["ACTIVE", "IN_SERVICE", "ON_TRIP", "DEPLOYED"]),
  idle: new Set([
    "IDLE",
    "AVAILABLE",
    "INACTIVE",
    "HOLD",
    "PARKED",
    "STANDBY",
    "SPARE",
  ]),
  maintenance: new Set([
    "MAINTENANCE",
    "WORKSHOP",
    "SERVICE",
    "REPAIR",
    "DOWN",
  ]),
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeStatus = (value) => {
  if (!value) {
    return "idle";
  }
  const upper = String(value).toUpperCase();
  if (STATUS_BUCKETS.active.has(upper)) return "active";
  if (STATUS_BUCKETS.maintenance.has(upper)) return "maintenance";
  if (STATUS_BUCKETS.idle.has(upper)) return "idle";
  // Map workshop enum from schema
  if (upper === "WORKSHOP") return "maintenance";
  if (upper === "HOLD") return "idle";
  return "idle";
};

const formatVehicleTypeLabel = (value) => {
  if (!value) return "Unknown";
  const str = String(value);
  return str
    .replace(/[_\-]+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const computePercent = (value, total) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

const roundToOne = (value) =>
  Number((Number.isFinite(value) ? value : 0).toFixed(1));

const buildCacheKey = ({ organizationId, depotId, type }) =>
  `${organizationId || "unscoped"}::${depotId || "all"}::${type || "all"}`;

class FleetService {
  static async getStatusSummary(query, user) {
    const organizationId = user.activeOrganizationId || null;

    const depotId = query.depotId?.trim() || null;
    const requestedType = query.type?.trim() || null;
    const cacheKey = buildCacheKey({
      organizationId,
      depotId,
      type: requestedType?.toUpperCase() || null,
    });

    const cached = fleetStatusCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const vehicleFilter = {};

    if (organizationId) {
      vehicleFilter.organizationId = new mongoose.Types.ObjectId(
        organizationId
      );
    }

    if (depotId) {
      vehicleFilter.depotId = depotId;
    }

    if (requestedType) {
      vehicleFilter.vehicleType = {
        $regex: new RegExp(`^${escapeRegex(requestedType)}$`, "i"),
      };
    }

    const vehicles = await Vehicle.find(vehicleFilter)
      .select("_id status")
      .lean();

    const summary = {
      active: 0,
      idle: 0,
      maintenance: 0,
    };

    vehicles.forEach((vehicle) => {
      const bucket = normalizeStatus(vehicle.status);
      if (summary[bucket] !== undefined) {
        summary[bucket] += 1;
      } else {
        summary.idle += 1;
      }
    });

    const total = vehicles.length;

    const progressEntries = Object.entries(summary).map(([key, value]) => {
      const percent = total === 0 ? 0 : roundToOne((value / total) * 100);
      return {
        label: key.charAt(0).toUpperCase() + key.slice(1),
        value,
        percent,
      };
    });

    const response = {
      total,
      summary,
      progress: progressEntries,
    };

    fleetStatusCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
    });

    return response;
  }

  static invalidateCacheForOrg(organizationId) {
    if (!organizationId) return;
    const idString = organizationId.toString();
    for (const key of fleetStatusCache.keys()) {
      if (key.startsWith(`${idString}::`)) {
        fleetStatusCache.delete(key);
      }
    }
  }

  /**
   * Get fleet utilization dataset for dashboard
   */
  static async getUtilization(query, user) {
    const organizationId = user.activeOrganizationId || null;
    const depotId = query.depotId?.trim() || null;
    const requestedType = query.type?.trim() || null;
    const dateString = query.date?.trim() || null;

    if (dateString) {
      const date = new Date(dateString);
      if (Number.isNaN(date.getTime())) {
        throw new AppError(
          "Invalid date format. Use YYYY-MM-DD",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    const cacheKey = `${buildCacheKey({
      organizationId,
      depotId,
      type: requestedType?.toUpperCase() || null,
    })}::${dateString || "today"}`;

    const cached = fleetUtilizationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const matchStage = {};
    if (organizationId) {
      matchStage.organizationId = new mongoose.Types.ObjectId(
        organizationId
      );
    }
    if (depotId) {
      matchStage.depotId = depotId;
    }
    if (requestedType) {
      matchStage.vehicleType = {
        $regex: new RegExp(`^${escapeRegex(requestedType)}$`, "i"),
      };
    }

    const activeStatuses = Array.from(STATUS_BUCKETS.active);
    const availableStatuses = Array.from(STATUS_BUCKETS.idle);
    const maintenanceStatuses = Array.from(STATUS_BUCKETS.maintenance);

    const pipeline = [
      { $match: matchStage },
      {
        $project: {
          vehicleType: {
            $cond: [
              { $or: [{ $eq: ["$vehicleType", null] }, { $eq: ["$vehicleType", ""] }] },
              "UNKNOWN",
              "$vehicleType",
            ],
          },
          status: { $toUpper: { $ifNull: ["$status", ""] } },
        },
      },
      {
        $group: {
          _id: "$vehicleType",
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [{ $in: ["$status", activeStatuses] }, 1, 0],
            },
          },
          available: {
            $sum: {
              $cond: [{ $in: ["$status", availableStatuses] }, 1, 0],
            },
          },
          maintenance: {
            $sum: {
              $cond: [{ $in: ["$status", maintenanceStatuses] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const results = await Vehicle.aggregate(pipeline);

    let total = 0;
    let totalActive = 0;
    let totalAvailable = 0;
    let totalMaintenance = 0;

    const types = results.map((item) => {
      const label = formatVehicleTypeLabel(item._id);
      total += item.total;
      totalActive += item.active;
      totalAvailable += item.available;
      totalMaintenance += item.maintenance;

      return {
        label,
        vehicleType: item._id,
        active: item.active,
        available: item.available,
        maintenance: item.maintenance,
        percent: computePercent(item.active, item.total),
      };
    });

    const utilizationPercent = computePercent(totalActive, total);

    const previousSample = fleetUtilizationTrendHistory.get(cacheKey);
    let trendPercent = 0;
    if (previousSample && previousSample.utilizationPercent > 0) {
      const delta =
        ((utilizationPercent - previousSample.utilizationPercent) /
          previousSample.utilizationPercent) *
        100;
      trendPercent = roundToOne(delta);
    }

    fleetUtilizationTrendHistory.set(cacheKey, {
      utilizationPercent,
      recordedAt: Date.now(),
    });

    const response = {
      utilizationPercent,
      trendPercent,
      total,
      active: totalActive,
      available: totalAvailable,
      service: totalMaintenance,
      types,
    };

    fleetUtilizationCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + UTILIZATION_CACHE_TTL_MS,
    });

    return response;
  }
}

module.exports = FleetService;


