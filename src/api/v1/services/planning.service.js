const PlanningSheet = require("../models/planningSheet.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

const PLANNING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const planningCache = new Map();

const buildCacheKey = ({ organizationId, date }) => `${organizationId || "unscoped"}::${date}`;
const DEFAULT_PLANNING_COLUMNS = [
  "#",
  "Time",
  "Driver",
  "Vehicle",
  "Customer",
  "Job Details",
  "Pickup Location",
  "Delivery Location",
];
const ALIGNMENTS = new Set(["left", "center", "right"]);
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const DEFAULT_COLUMN_KEY_MAP = {
  "#": "rowNumber",
  Time: "time",
  Driver: "driver",
  Vehicle: "vehicle",
  Customer: "customer",
  "Job Details": "jobDetails",
  "Pickup Location": "pickupLocation",
  "Delivery Location": "deliveryLocation",
};

const isPlainObject = (value) => {
  return Object.prototype.toString.call(value) === "[object Object]";
};

const labelToColumnKey = (label) => {
  if (!label || typeof label !== "string") {
    return "";
  }

  if (DEFAULT_COLUMN_KEY_MAP[label]) {
    return DEFAULT_COLUMN_KEY_MAP[label];
  }

  const normalized = label
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");

  return normalized;
};

const sanitizeColumnFormats = (columnFormats, columns) => {
  if (!columnFormats) return {};
  if (!isPlainObject(columnFormats)) {
    throw new AppError("columnFormats must be an object", HttpStatusCodes.BAD_REQUEST);
  }

  const columnSet = new Set((columns || DEFAULT_PLANNING_COLUMNS).map((col) => String(col)));
  const sanitized = {};

  Object.entries(columnFormats).forEach(([label, config]) => {
    if (!columnSet.has(label)) {
      // Ignore formatting for unknown columns (frontend may sync later)
      return;
    }

    if (!isPlainObject(config)) {
      throw new AppError(`Invalid columnFormats entry for '${label}'`, HttpStatusCodes.BAD_REQUEST);
    }

    const formattedConfig = {};

    if (typeof config.bold === "boolean") {
      formattedConfig.bold = config.bold;
    }

    if (typeof config.italic === "boolean") {
      formattedConfig.italic = config.italic;
    }

    if (config.align !== undefined) {
      if (typeof config.align !== "string" || !ALIGNMENTS.has(config.align)) {
        throw new AppError(
          `Invalid alignment '${config.align}' for column '${label}'`,
          HttpStatusCodes.BAD_REQUEST
        );
      }
      formattedConfig.align = config.align;
    }

    if (config.color !== undefined) {
      if (typeof config.color !== "string" || !HEX_COLOR_REGEX.test(config.color)) {
        throw new AppError(
          `Invalid color '${config.color}' for column '${label}'. Expected hex color.`,
          HttpStatusCodes.BAD_REQUEST
        );
      }
      formattedConfig.color = config.color;
    }

    // Only persist if at least one property is present
    if (Object.keys(formattedConfig).length > 0) {
      sanitized[label] = formattedConfig;
    }
  });

  return sanitized;
};

const formatColumnFormatsForResponse = (columns, storedFormats = {}) => {
  const resolved = {};
  (columns || DEFAULT_PLANNING_COLUMNS).forEach((label) => {
    resolved[label] = storedFormats[label] || {};
  });
  return resolved;
};

class PlanningService {
  /**
   * Get planning sheet for a specific date
   * @param {Object} query - Query parameters (date, organizationId)
   * @param {Object} user - User object (for organization context)
   * @returns {Object} Planning sheet data
   */
  static async getPlanningSheet(query, user) {
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
    const cached = planningCache.get(cacheKey);
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

    let planningSheet = await PlanningSheet.findOne(filter).lean();

    // If no planning sheet exists, return default structure
    if (!planningSheet) {
      const defaultColumns = [...DEFAULT_PLANNING_COLUMNS];
      const defaultData = {
        date,
        columns: defaultColumns,
        columnFormats: formatColumnFormatsForResponse(defaultColumns, {}),
        rows: [],
      };

      // Cache the default response
      planningCache.set(cacheKey, {
        data: defaultData,
        expiresAt: Date.now() + PLANNING_CACHE_TTL_MS,
      });

      return defaultData;
    }

    // Format date back to YYYY-MM-DD string
    const formattedDate = planningSheet.date.toISOString().split("T")[0];
    const resolvedColumns =
      planningSheet.columns && planningSheet.columns.length > 0
        ? planningSheet.columns
        : [...DEFAULT_PLANNING_COLUMNS];

    const response = {
      date: formattedDate,
      columns: resolvedColumns,
      columnFormats: formatColumnFormatsForResponse(resolvedColumns, planningSheet.columnFormats || {}),
      rows: planningSheet.rows || [],
    };

    // Cache the response
    planningCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + PLANNING_CACHE_TTL_MS,
    });

    return response;
  }

  /**
   * Save planning sheet for a specific date
   * @param {Object} body - Request body (date, columns, rows)
   * @param {Object} user - User object (for organization context and audit)
   * @returns {Object} Saved planning sheet data
   */
  static async savePlanningSheet(body, user) {
    const { date, columns, rows, columnFormats } = body;

    if (!date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new AppError("Invalid date format. Expected YYYY-MM-DD", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = user.activeOrganizationId || null;

    // Validate columns and rows structure
    if (columns && !Array.isArray(columns)) {
      throw new AppError("Columns must be an array", HttpStatusCodes.BAD_REQUEST);
    }

    if (rows && !Array.isArray(rows)) {
      throw new AppError("Rows must be an array", HttpStatusCodes.BAD_REQUEST);
    }

    // Limit rows to prevent abuse (e.g., max 1000 rows)
    if (rows && rows.length > 1000) {
      throw new AppError("Maximum 1000 rows allowed", HttpStatusCodes.BAD_REQUEST);
    }

    // Limit columns to prevent abuse (e.g., max 50 columns)
    if (columns && columns.length > 50) {
      throw new AppError("Maximum 50 columns allowed", HttpStatusCodes.BAD_REQUEST);
    }

    // Parse date to Date object (start of day in UTC)
    const dateObj = new Date(date + "T00:00:00.000Z");

    // Validate each row has required fields
    if (rows) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.id) {
          throw new AppError(`Row ${i + 1} is missing required field 'id'`, HttpStatusCodes.BAD_REQUEST);
        }
        if (typeof row.rowNumber !== "number") {
          throw new AppError(`Row ${i + 1} is missing required field 'rowNumber'`, HttpStatusCodes.BAD_REQUEST);
        }
      }
    }

    // Prepare update data
    const effectiveColumns =
      columns && Array.isArray(columns) && columns.length > 0 ? columns : [...DEFAULT_PLANNING_COLUMNS];

    const sanitizedColumnFormats = sanitizeColumnFormats(columnFormats || {}, effectiveColumns);

    const updateData = {
      date: dateObj,
      columns: effectiveColumns,
      columnFormats: sanitizedColumnFormats,
      rows: rows || [],
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

    // Upsert planning sheet
    const planningSheet = await PlanningSheet.findOneAndUpdate(
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
    const formattedDate = planningSheet.date.toISOString().split("T")[0];

    const response = {
      date: formattedDate,
      columns: planningSheet.columns,
      columnFormats: formatColumnFormatsForResponse(planningSheet.columns, planningSheet.columnFormats || {}),
      rows: planningSheet.rows,
    };

    // Invalidate cache for this date
    const cacheKey = buildCacheKey({ organizationId: orgId, date });
    planningCache.delete(cacheKey);

    return response;
  }

  /**
   * Delete planning sheet row
   */
  static async deletePlanningRow(params, user) {
    const { rowId, date, organizationId } = params;

    if (!rowId) {
      throw new AppError("rowId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new AppError("Invalid date format. Expected YYYY-MM-DD", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = organizationId || user.activeOrganizationId || null;
    const dateObj = new Date(date + "T00:00:00.000Z");

    const filter = { date: dateObj };
    if (orgId) {
      filter.organizationId = new mongoose.Types.ObjectId(orgId);
    } else {
      filter.organizationId = null;
    }

    const planningSheet = await PlanningSheet.findOne(filter);

    if (!planningSheet) {
      throw new AppError("Planning sheet not found", HttpStatusCodes.NOT_FOUND);
    }

    const rows = planningSheet.rows || [];
    const updatedRows = rows.filter((row) => row.id !== rowId);

    if (updatedRows.length === rows.length) {
      throw new AppError("Row not found", HttpStatusCodes.NOT_FOUND);
    }

    // Optional: renumber rows to keep sequence tidy
    const renumberedRows = updatedRows.map((row, index) => {
      const clonedRow = { ...row };
      if (typeof clonedRow.rowNumber === "number") {
        clonedRow.rowNumber = index + 1;
      }
      return clonedRow;
    });

    planningSheet.rows = renumberedRows;
    planningSheet.updatedBy = user._id || user.id;
    await planningSheet.save();

    const cacheKey = buildCacheKey({ organizationId: orgId, date });
    planningCache.delete(cacheKey);

    return { removedRowId: rowId };
  }

  /**
   * Delete planning sheet column
   */
  static async deletePlanningColumn(params, user) {
    const { columnKey, date, organizationId } = params;

    if (!columnKey) {
      throw new AppError("columnKey is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new AppError("Invalid date format. Expected YYYY-MM-DD", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = organizationId || user.activeOrganizationId || null;
    const dateObj = new Date(date + "T00:00:00.000Z");

    const filter = { date: dateObj };
    if (orgId) {
      filter.organizationId = new mongoose.Types.ObjectId(orgId);
    } else {
      filter.organizationId = null;
    }

    const planningSheet = await PlanningSheet.findOne(filter);

    if (!planningSheet) {
      throw new AppError("Planning sheet not found", HttpStatusCodes.NOT_FOUND);
    }

    const columns = planningSheet.columns || [];
    const keptColumns = columns.filter((label) => labelToColumnKey(label) !== columnKey);

    if (keptColumns.length === columns.length) {
      throw new AppError("Column not found", HttpStatusCodes.NOT_FOUND);
    }

    const rows = (planningSheet.rows || []).map((row) => {
      if (row && Object.prototype.hasOwnProperty.call(row, columnKey)) {
        const clonedRow = { ...row };
        delete clonedRow[columnKey];
        return clonedRow;
      }
      return row;
    });

    const columnFormats = planningSheet.columnFormats || {};
    const updatedColumnFormats = Object.entries(columnFormats).reduce((acc, [label, config]) => {
      if (labelToColumnKey(label) !== columnKey) {
        acc[label] = config;
      }
      return acc;
    }, {});

    planningSheet.columns = keptColumns;
    planningSheet.rows = rows;
    planningSheet.columnFormats = updatedColumnFormats;
    planningSheet.updatedBy = user._id || user.id;
    await planningSheet.save();

    const cacheKey = buildCacheKey({ organizationId: orgId, date });
    planningCache.delete(cacheKey);

    return {
      removedColumnKey: columnKey,
      columns: keptColumns,
    };
  }
}

module.exports = PlanningService;

