const DailyNotes = require("../models/dailyNotes.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

const NOTES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const notesCache = new Map();

const buildCacheKey = ({ organizationId, date }) => `notes::${organizationId || "unscoped"}::${date}`;

class DailyNotesService {
  /**
   * Get daily notes for a specific date
   * @param {Object} query - Query parameters (date, organizationId)
   * @param {Object} user - User object (for organization context)
   * @returns {Object} Daily notes data
   */
  static async getDailyNotes(query, user) {
    const { date, organizationId } = query;

    if (!date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new AppError("Invalid date format. Expected YYYY-MM-DD", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = organizationId || user.activeOrganizationId || null;

    // Check cache
    const cacheKey = buildCacheKey({ organizationId: orgId, date });
    const cached = notesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Parse date to Date object (start of day in UTC)
    const dateObj = new Date(date + "T00:00:00.000Z");

    const filter = {
      date: dateObj,
    };

    if (orgId) {
      filter.organizationId = new mongoose.Types.ObjectId(orgId);
    } else {
      filter.organizationId = null;
    }

    let dailyNotes = await DailyNotes.findOne(filter).lean();

    // If no notes exist, return default structure
    if (!dailyNotes) {
      const defaultData = {
        date,
        notes: "",
      };

      // Cache the default response
      notesCache.set(cacheKey, {
        data: defaultData,
        expiresAt: Date.now() + NOTES_CACHE_TTL_MS,
      });

      return defaultData;
    }

    // Format date back to YYYY-MM-DD string
    const formattedDate = dailyNotes.date.toISOString().split("T")[0];

    const response = {
      date: formattedDate,
      notes: dailyNotes.notes || "",
    };

    // Cache the response
    notesCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + NOTES_CACHE_TTL_MS,
    });

    return response;
  }

  /**
   * Save daily notes for a specific date
   * @param {Object} body - Request body (date, notes)
   * @param {Object} user - User object (for organization context and audit)
   * @returns {Object} Saved daily notes data
   */
  static async saveDailyNotes(body, user) {
    const { date, notes } = body;

    if (!date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new AppError("Invalid date format. Expected YYYY-MM-DD", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = user.activeOrganizationId || null;

    // Validate notes (optional, but sanitize if provided)
    const sanitizedNotes = notes || "";

    // Limit notes length to prevent abuse (e.g., max 100,000 characters)
    if (sanitizedNotes.length > 100000) {
      throw new AppError("Notes exceed maximum length of 100,000 characters", HttpStatusCodes.BAD_REQUEST);
    }

    // Parse date to Date object (start of day in UTC)
    const dateObj = new Date(date + "T00:00:00.000Z");

    // Prepare update data
    const updateData = {
      date: dateObj,
      notes: sanitizedNotes,
      updatedBy: user._id || user.id,
    };

    // Build filter for upsert
    const upsertFilter = {
      date: dateObj,
    };

    if (orgId) {
      upsertFilter.organizationId = new mongoose.Types.ObjectId(orgId);
    } else {
      upsertFilter.organizationId = null;
    }

    // Upsert daily notes
    const dailyNotes = await DailyNotes.findOneAndUpdate(
      upsertFilter,
      {
        $set: updateData,
        $setOnInsert: {
          organizationId: orgId ? new mongoose.Types.ObjectId(orgId) : null,
          createdBy: user._id || user.id,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    ).lean();

    // Format date back to YYYY-MM-DD string
    const formattedDate = dailyNotes.date.toISOString().split("T")[0];

    const response = {
      date: formattedDate,
      notes: dailyNotes.notes || "",
    };

    // Invalidate cache for this date
    const cacheKey = buildCacheKey({ organizationId: orgId, date });
    notesCache.delete(cacheKey);

    return response;
  }
}

module.exports = DailyNotesService;

