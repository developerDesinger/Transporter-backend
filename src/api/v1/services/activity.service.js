const mongoose = require("mongoose");
const ActivityEvent = require("../models/activityEvent.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const ACTIVITY_CACHE_TTL_MS = 30 * 1000;
const activityCache = new Map();

class ActivityService {
  static async getRecentActivity(query, user) {
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

    const limit =
      query.limit && !Number.isNaN(parseInt(query.limit, 10))
        ? Math.min(Math.max(parseInt(query.limit, 10), 1), 50)
        : 10;

    const typeFilter = query.type ? query.type.toString().toLowerCase() : null;
    const sinceTimestamp = query.since ? new Date(query.since) : null;

    if (sinceTimestamp && Number.isNaN(sinceTimestamp.getTime())) {
      throw new AppError("Invalid since timestamp", HttpStatusCodes.BAD_REQUEST);
    }

    const cacheKey = JSON.stringify({
      org: organizationObjectId?.toString() || "unscoped",
      typeFilter,
      since: sinceTimestamp ? sinceTimestamp.toISOString() : "none",
      limit,
    });

    const cached = activityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const matchStage = {};

    if (organizationObjectId) {
      matchStage.organizationId = organizationObjectId;
    }

    if (typeFilter) {
      matchStage.eventType = typeFilter;
    }

    if (sinceTimestamp) {
      matchStage.timestamp = { $gt: sinceTimestamp };
    }

    const events = await ActivityEvent.find(matchStage)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const totalCount = await ActivityEvent.countDocuments(matchStage);

    const formattedEvents = events.map((event) => ({
      id: event._id.toString(),
      title: event.title,
      description: event.description || "",
      type: event.eventType || "update",
      timestamp: event.timestamp ? event.timestamp.toISOString() : null,
      entityId: event.entityId || null,
      entityType: event.entityType || "OTHER",
    }));

    const response = {
      events: formattedEvents,
      count: totalCount,
    };

    activityCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS,
    });

    return response;
  }
}

module.exports = ActivityService;


