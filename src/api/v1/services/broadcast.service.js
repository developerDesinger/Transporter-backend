const Broadcast = require("../models/broadcast.model");
const ClientBroadcast = require("../models/clientBroadcast.model");
const Customer = require("../models/customer.model");
const User = require("../models/user.model");
const Driver = require("../models/driver.model");
const Party = require("../models/party.model");
const VehicleType = require("../models/vehicleType.model");
const ServiceCode = require("../models/serviceCode.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");
const sgMail = require("@sendgrid/mail");

class BroadcastService {
  /**
   * Get broadcast history for organization
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of broadcast objects
   */
  static async getBroadcasts(user) {
    const organizationId = user.activeOrganizationId || null;

    // Build filter
    const filter = {};
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Query broadcasts with populated user information
    const broadcasts = await Broadcast.find(filter)
      .populate({
        path: "sentByUserId",
        model: "User",
        select: "firstName lastName fullName email",
      })
      .sort({ sentAt: -1, createdAt: -1 })
      .lean();

    // Format response
    const formattedBroadcasts = broadcasts.map((broadcast) => {
      // Get sentBy name from populated user or use fallback
      let sentBy = "Unknown User";
      if (broadcast.sentByUserId) {
        const user = broadcast.sentByUserId;
        sentBy =
          user.fullName ||
          (user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`.trim()
            : user.email || "Unknown User");
      }

      return {
        id: broadcast._id.toString(),
        subject: broadcast.subject,
        message: broadcast.message,
        method: broadcast.method,
        totalRecipients: broadcast.totalRecipients || 0,
        emailsSent: broadcast.emailsSent || 0,
        emailsFailed: broadcast.emailsFailed || 0,
        smsSent: broadcast.smsSent || 0,
        smsFailed: broadcast.smsFailed || 0,
        status: broadcast.status || "SENT",
        sentBy: sentBy,
        sentAt: broadcast.sentAt.toISOString(),
        createdAt: broadcast.createdAt.toISOString(),
      };
    });

    return formattedBroadcasts;
  }

  /**
   * Get vehicle type codes for broadcast filtering
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of vehicle type codes (strings)
   */
  static async getVehicleTypes(user) {
    const organizationId = user.activeOrganizationId || null;

    // Option 1: Try VehicleType model first (recommended if available)
    const vehicleTypeFilter = {
      isActive: true,
    };

    if (organizationId) {
      vehicleTypeFilter.$or = [
        { organizationId: new mongoose.Types.ObjectId(organizationId) },
        { organizationId: null }, // Global vehicle types
      ];
    } else {
      vehicleTypeFilter.organizationId = null;
    }

    const vehicleTypes = await VehicleType.find(vehicleTypeFilter)
      .select("code")
      .sort({ sortOrder: 1, code: 1 })
      .lean();

    if (vehicleTypes && vehicleTypes.length > 0) {
      // Extract codes and filter out null/empty values
      const codes = vehicleTypes
        .map((vt) => vt.code)
        .filter((code) => code && code.trim() !== "");

      if (codes.length > 0) {
        return codes;
      }
    }

    // Option 2: Fallback to ServiceCode vehicleClass field
    const serviceCodeFilter = {
      vehicleClass: { $ne: null, $ne: "" },
      isActive: true,
    };

    if (organizationId) {
      serviceCodeFilter.$or = [
        { organizationId: new mongoose.Types.ObjectId(organizationId) },
        { organizationId: null }, // Global service codes
      ];
    } else {
      serviceCodeFilter.organizationId = null;
    }

    // Get distinct vehicle classes from service codes
    const vehicleClasses = await ServiceCode.distinct("vehicleClass", serviceCodeFilter);

    // Filter out null/empty values and sort
    const codes = vehicleClasses
      .filter((code) => code && code.trim() !== "")
      .sort();

    return codes;
  }

  /**
   * Preview drivers matching filter criteria for broadcast
   * @param {Object} data - Filter criteria
   * @param {Object} user - Authenticated user
   * @returns {Object} Count and list of matching drivers
   */
  static async previewBroadcast(data, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate request
    const errors = [];

    if (data.filterVehicleTypes !== undefined && !Array.isArray(data.filterVehicleTypes)) {
      errors.push({
        field: "filterVehicleTypes",
        message: "filterVehicleTypes must be an array",
      });
    }

    if (data.filterStates !== undefined && !Array.isArray(data.filterStates)) {
      errors.push({
        field: "filterStates",
        message: "filterStates must be an array",
      });
    }

    if (data.filterSuburbs !== undefined && !Array.isArray(data.filterSuburbs)) {
      errors.push({
        field: "filterSuburbs",
        message: "filterSuburbs must be an array",
      });
    }

    if (data.filterServiceTypes !== undefined && !Array.isArray(data.filterServiceTypes)) {
      errors.push({
        field: "filterServiceTypes",
        message: "filterServiceTypes must be an array",
      });
    }

    if (data.filterContactTypes !== undefined && !Array.isArray(data.filterContactTypes)) {
      errors.push({
        field: "filterContactTypes",
        message: "filterContactTypes must be an array",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Invalid filter data", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Extract filter arrays (default to empty arrays)
    const filterVehicleTypes = data.filterVehicleTypes || [];
    const filterStates = data.filterStates || [];
    const filterSuburbs = data.filterSuburbs || [];
    const filterServiceTypes = data.filterServiceTypes || [];
    const filterContactTypes = data.filterContactTypes || [];

    // Build aggregation pipeline for efficient filtering
    const pipeline = [];

    // Match stage: Base driver filters
    // Note: isActive defaults to false in Driver model
    // We'll filter by isActive: true, but also include drivers where isActive is not set (for backward compatibility)
    const matchConditions = [
      {
        $or: [
          { isActive: true },
          { isActive: { $exists: false } }, // Include drivers where isActive doesn't exist
          { isActive: null }, // Include drivers where isActive is null
        ],
      },
    ];

    // Vehicle types filter (array contains any)
    // For array fields, $in checks if the array contains any of the specified values
    if (filterVehicleTypes.length > 0) {
      matchConditions.push({
        vehicleTypesInFleet: {
          $in: filterVehicleTypes,
        },
      });
    }

    // Service types filter (array contains any)
    // For array fields, $in checks if the array contains any of the specified values
    if (filterServiceTypes.length > 0) {
      matchConditions.push({
        servicesProvided: {
          $in: filterServiceTypes,
        },
      });
    }

    // Contact types filter
    if (filterContactTypes.length > 0) {
      matchConditions.push({
        contactType: { $in: filterContactTypes },
      });
    }

    // Combine all match conditions with $and
    const matchStage = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

    pipeline.push({ $match: matchStage });

    // Lookup stage: Join with Party collection
    pipeline.push({
      $lookup: {
        from: "parties", // MongoDB collection name (lowercase, pluralized)
        localField: "partyId",
        foreignField: "_id",
        as: "party",
      },
    });

    // Unwind party array (should be single party per driver)
    pipeline.push({
      $unwind: {
        path: "$party",
        preserveNullAndEmptyArrays: true, // Keep drivers even if party not found
      },
    });

    // Filter by states (from Party.stateRegion) - case-insensitive
    if (filterStates.length > 0) {
      // Use $expr with $in for case-insensitive matching
      pipeline.push({
        $match: {
          $expr: {
            $in: [
              { $toUpper: { $ifNull: ["$party.stateRegion", ""] } },
              filterStates.map((s) => s.toUpperCase()),
            ],
          },
        },
      });
    }

    // Filter by suburbs (case-insensitive, from Party.suburb)
    if (filterSuburbs.length > 0) {
      // Use $expr with $in for case-insensitive matching
      const suburbLower = filterSuburbs.map((s) => s.toLowerCase());
      pipeline.push({
        $match: {
          $expr: {
            $in: [
              { $toLower: { $ifNull: ["$party.suburb", ""] } },
              suburbLower,
            ],
          },
        },
      });
    }

    // Sort by driverCode
    pipeline.push({
      $sort: { driverCode: 1 },
    });

    // Get total count (before limiting)
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Driver.aggregate(countPipeline);
    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    // Limit results for preview (first 100 drivers)
    pipeline.push({ $limit: 100 });

    // Project stage: Select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        driverCode: 1,
        vehicleTypesInFleet: 1,
        servicesProvided: 1,
        contactType: 1,
        "party.firstName": 1,
        "party.lastName": 1,
        "party.email": 1,
        "party.phone": 1,
        "party.companyName": 1,
        "party.suburb": 1,
        "party.stateRegion": 1,
      },
    });

    // Execute aggregation
    const drivers = await Driver.aggregate(pipeline);

    // Format response
    const formattedDrivers = drivers.map((driver) => {
      const party = driver.party || {};

      return {
        id: driver._id.toString(),
        driverNumber: driver.driverCode || "",
        firstName: party.firstName || "",
        lastName: party.lastName || "",
        email: party.email || "",
        phone: party.phone || "",
        companyName: party.companyName || "",
        stateRegion: party.stateRegion || "",
        suburb: party.suburb || "",
        vehicleTypesInFleet: driver.vehicleTypesInFleet || [],
        servicesProvided: driver.servicesProvided || [],
        contactType: driver.contactType || "",
      };
    });

    return {
      count: totalCount,
      drivers: formattedDrivers,
    };
  }

  /**
   * Send broadcast to drivers matching filter criteria
   * @param {Object} data - Broadcast data (subject, message, method, filters)
   * @param {Object} user - Authenticated user
   * @returns {Object} Delivery statistics
   */
  static async sendBroadcast(data, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required fields
    if (!data.subject || !data.subject.trim()) {
      throw new AppError("Subject is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.message || !data.message.trim()) {
      throw new AppError("Message is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.method || !["EMAIL", "SMS", "BOTH"].includes(data.method)) {
      throw new AppError(
        "Method must be EMAIL, SMS, or BOTH",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate filter arrays (same as preview)
    const errors = [];

    if (data.filterVehicleTypes !== undefined && !Array.isArray(data.filterVehicleTypes)) {
      errors.push({
        field: "filterVehicleTypes",
        message: "filterVehicleTypes must be an array",
      });
    }

    if (data.filterStates !== undefined && !Array.isArray(data.filterStates)) {
      errors.push({
        field: "filterStates",
        message: "filterStates must be an array",
      });
    }

    if (data.filterSuburbs !== undefined && !Array.isArray(data.filterSuburbs)) {
      errors.push({
        field: "filterSuburbs",
        message: "filterSuburbs must be an array",
      });
    }

    if (data.filterServiceTypes !== undefined && !Array.isArray(data.filterServiceTypes)) {
      errors.push({
        field: "filterServiceTypes",
        message: "filterServiceTypes must be an array",
      });
    }

    if (data.filterContactTypes !== undefined && !Array.isArray(data.filterContactTypes)) {
      errors.push({
        field: "filterContactTypes",
        message: "filterContactTypes must be an array",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Invalid filter data", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Extract filter arrays (default to empty arrays)
    const filterVehicleTypes = data.filterVehicleTypes || [];
    const filterStates = data.filterStates || [];
    const filterSuburbs = data.filterSuburbs || [];
    const filterServiceTypes = data.filterServiceTypes || [];
    const filterContactTypes = data.filterContactTypes || [];

    // Build aggregation pipeline (same as preview, but no limit)
    const pipeline = [];

    // Match stage: Base driver filters
    // Note: isActive defaults to false in Driver model
    // We'll filter by isActive: true, but also include drivers where isActive is not set (for backward compatibility)
    const matchConditions = [
      {
        $or: [
          { isActive: true },
          { isActive: { $exists: false } }, // Include drivers where isActive doesn't exist
          { isActive: null }, // Include drivers where isActive is null
        ],
      },
    ];

    // Vehicle types filter
    if (filterVehicleTypes.length > 0) {
      matchConditions.push({
        vehicleTypesInFleet: {
          $in: filterVehicleTypes,
        },
      });
    }

    // Service types filter
    if (filterServiceTypes.length > 0) {
      matchConditions.push({
        servicesProvided: {
          $in: filterServiceTypes,
        },
      });
    }

    // Contact types filter
    if (filterContactTypes.length > 0) {
      matchConditions.push({
        contactType: { $in: filterContactTypes },
      });
    }

    // Combine all match conditions with $and
    const matchStage = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

    pipeline.push({ $match: matchStage });

    // Lookup stage: Join with Party collection
    pipeline.push({
      $lookup: {
        from: "parties",
        localField: "partyId",
        foreignField: "_id",
        as: "party",
      },
    });

    // Unwind party array
    pipeline.push({
      $unwind: {
        path: "$party",
        preserveNullAndEmptyArrays: true,
      },
    });

    // Filter by states (case-insensitive)
    if (filterStates.length > 0) {
      pipeline.push({
        $match: {
          $expr: {
            $in: [
              { $toUpper: { $ifNull: ["$party.stateRegion", ""] } },
              filterStates.map((s) => s.toUpperCase()),
            ],
          },
        },
      });
    }

    // Filter by suburbs (case-insensitive)
    if (filterSuburbs.length > 0) {
      const suburbLower = filterSuburbs.map((s) => s.toLowerCase());
      pipeline.push({
        $match: {
          $expr: {
            $in: [
              { $toLower: { $ifNull: ["$party.suburb", ""] } },
              suburbLower,
            ],
          },
        },
      });
    }

    // Get total count
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Driver.aggregate(countPipeline);
    const totalRecipients = countResult.length > 0 ? countResult[0].total : 0;

    if (totalRecipients === 0) {
      throw new AppError(
        "No drivers match the filter criteria",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Project stage: Select needed fields for sending
    pipeline.push({
      $project: {
        _id: 1,
        driverCode: 1,
        "party.email": 1,
        "party.phone": 1,
        "party.phoneAlt": 1,
      },
    });

    // Execute aggregation to get all matching drivers
    const drivers = await Driver.aggregate(pipeline);

    // Create broadcast record
    const sentAt = new Date();
    const broadcast = await Broadcast.create({
      subject: data.subject.trim(),
      message: data.message.trim(),
      method: data.method,
      totalRecipients: totalRecipients,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      status: "PENDING",
      sentByUserId: user._id || user.id,
      sentAt: sentAt,
      organizationId: organizationId
        ? new mongoose.Types.ObjectId(organizationId)
        : null,
      filters: {
        vehicleTypes: filterVehicleTypes,
        states: filterStates,
        suburbs: filterSuburbs,
        serviceTypes: filterServiceTypes,
        contactTypes: filterContactTypes,
      },
    });

    // Initialize SendGrid if API key is available
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    }

    // Track delivery statistics
    let emailsSent = 0;
    let emailsFailed = 0;
    let smsSent = 0;
    let smsFailed = 0;

    // Send messages to each driver
    for (const driver of drivers) {
      const party = driver.party || {};
      const email = party.email;
      const phone = party.phone || party.phoneAlt;

      // Send email if method includes EMAIL
      if (data.method === "EMAIL" || data.method === "BOTH") {
        if (email && email.trim()) {
          try {
            const mailOptions = {
              to: email.trim(),
              from: process.env.FROM_EMAIL || "noreply@transporter.digital",
              subject: data.subject.trim(),
              text: data.message.trim(),
              html: data.message.trim().replace(/\n/g, "<br>"),
            };

            if (process.env.SENDGRID_API_KEY) {
              await sgMail.send(mailOptions);
              emailsSent++;
            } else {
              // Log if SendGrid not configured
              console.log(`📧 Would send email to ${email}:`, data.subject);
              emailsSent++; // Count as sent for development
            }
          } catch (error) {
            console.error(`❌ Failed to send email to ${email}:`, error.message);
            emailsFailed++;
          }
        } else {
          emailsFailed++;
        }
      }

      // Send SMS if method includes SMS
      if (data.method === "SMS" || data.method === "BOTH") {
        if (phone && phone.trim()) {
          try {
            // TODO: Integrate with actual SMS service (Twilio, AWS SNS, etc.)
            // For now, just log the SMS
            const smsMessage = `${data.subject.trim()}\n\n${data.message.trim()}`;
            console.log(`📱 Sending SMS to ${phone}:`, smsMessage);

            // In production, call SMS service:
            // await sendSMS(phone, smsMessage);

            smsSent++; // Count as sent for development
          } catch (error) {
            console.error(`❌ Failed to send SMS to ${phone}:`, error.message);
            smsFailed++;
          }
        } else {
          smsFailed++;
        }
      }
    }

    // Determine final status
    let status = "SENT";
    if (emailsFailed + smsFailed > 0) {
      if (emailsSent + smsSent === 0) {
        status = "FAILED";
      } else {
        status = "PARTIAL";
      }
    }

    // Update broadcast record with delivery statistics
    await Broadcast.findByIdAndUpdate(broadcast._id, {
      emailsSent,
      emailsFailed,
      smsSent,
      smsFailed,
      status,
    });

    return {
      totalRecipients,
      emailsSent,
      emailsFailed,
      smsSent,
      smsFailed,
    };
  }

  /**
   * Get client broadcast history for organization
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of formatted client broadcast objects
   */
  static async getClientBroadcasts(user) {
    const organizationId = user.activeOrganizationId || null;

    // Build query filter
    const filter = {};
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      // If no organizationId, include broadcasts with null organizationId
      filter.organizationId = null;
    }

    // Query broadcasts with populated user information
    const broadcasts = await ClientBroadcast.find(filter)
      .populate({
        path: "sentByUserId",
        model: "User",
        select: "firstName lastName fullName email",
      })
      .sort({ sentAt: -1, createdAt: -1 })
      .lean();

    // Format response
    const formattedBroadcasts = broadcasts.map((broadcast) => {
      // Get sentBy name from populated user or use fallback
      let sentBy = "Unknown User";
      if (broadcast.sentByUserId) {
        const user = broadcast.sentByUserId;
        sentBy =
          user.fullName ||
          (user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`.trim()
            : user.email || "Unknown User");
      }

      // Extract filter criteria from filters object
      const filters = broadcast.filters || {};
      const filterStates = filters.states || [];
      const filterWorkTypes = filters.workTypes || [];
      const filterCities = filters.cities || [];

      return {
        id: broadcast._id.toString(),
        subject: broadcast.subject,
        message: broadcast.message,
        method: broadcast.method,
        filterStates: filterStates,
        filterWorkTypes: filterWorkTypes,
        filterCities: filterCities,
        totalRecipients: broadcast.totalRecipients || 0,
        emailsSent: broadcast.emailsSent || 0,
        emailsFailed: broadcast.emailsFailed || 0,
        smsSent: broadcast.smsSent || 0,
        smsFailed: broadcast.smsFailed || 0,
        status: broadcast.status || "SENT",
        sentBy: sentBy,
        sentAt: broadcast.sentAt.toISOString(),
        createdAt: broadcast.createdAt.toISOString(),
      };
    });

    return formattedBroadcasts;
  }

  /**
   * Preview customers matching filter criteria for client broadcast
   * @param {Object} data - Filter criteria
   * @param {Object} user - Authenticated user
   * @returns {Object} Count and list of matching customers
   */
  static async previewClientBroadcast(data, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate request
    const errors = [];

    if (data.filterStates !== undefined && !Array.isArray(data.filterStates)) {
      errors.push({
        field: "filterStates",
        message: "filterStates must be an array",
      });
    }

    if (data.filterWorkTypes !== undefined && !Array.isArray(data.filterWorkTypes)) {
      errors.push({
        field: "filterWorkTypes",
        message: "filterWorkTypes must be an array",
      });
    }

    if (data.filterCities !== undefined && !Array.isArray(data.filterCities)) {
      errors.push({
        field: "filterCities",
        message: "filterCities must be an array",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Invalid filter data", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Extract filter arrays (default to empty arrays)
    const filterStates = data.filterStates || [];
    const filterWorkTypes = data.filterWorkTypes || [];
    const filterCities = data.filterCities || [];

    // Build aggregation pipeline for efficient filtering
    const pipeline = [];

    // Match stage: Base customer filters
    // Note: Customer model doesn't have organizationId directly
    // Filter by active customers
    const matchConditions = [
      {
        isActive: true,
      },
    ];

    // States filter (array contains any)
    if (filterStates.length > 0) {
      matchConditions.push({
        serviceStates: {
          $in: filterStates,
        },
      });
    }

    // Work types filter (array contains any)
    // serviceTypes can contain "INTERSTATE" or "METRO"
    if (filterWorkTypes.length > 0) {
      matchConditions.push({
        serviceTypes: {
          $in: filterWorkTypes,
        },
      });
    }

    // Cities filter (array contains any, case-insensitive)
    if (filterCities.length > 0) {
      // Convert cities to uppercase for case-insensitive matching
      const citiesUpper = filterCities.map((city) => city.trim().toUpperCase());
      matchConditions.push({
        serviceCities: {
          $in: citiesUpper,
        },
      });
    }

    // Combine all match conditions with $and
    const matchStage = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

    pipeline.push({ $match: matchStage });

    // Lookup stage: Join with Party collection
    pipeline.push({
      $lookup: {
        from: "parties",
        localField: "partyId",
        foreignField: "_id",
        as: "party",
      },
    });

    // Unwind party array
    pipeline.push({
      $unwind: {
        path: "$party",
        preserveNullAndEmptyArrays: true,
      },
    });

    // Sort by company name (from Party or Customer)
    pipeline.push({
      $sort: {
        "party.companyName": 1,
        tradingName: 1,
        legalCompanyName: 1,
      },
    });

    // Get total count (before limiting)
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Customer.aggregate(countPipeline);
    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    // Limit results for preview (first 100 customers)
    pipeline.push({ $limit: 100 });

    // Project stage: Select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        tradingName: 1,
        legalCompanyName: 1,
        state: 1,
        "party.companyName": 1,
        "party.email": 1,
        "party.phone": 1,
        "party.state": 1,
      },
    });

    // Execute aggregation
    const customers = await Customer.aggregate(pipeline);

    // Format response
    const formattedCustomers = customers.map((customer) => {
      const party = customer.party || {};

      // Get company name from party or customer fields
      const companyName =
        party.companyName ||
        customer.tradingName ||
        customer.legalCompanyName ||
        "";

      // Get state from customer or party
      const state = customer.state || party.state || "";

      // Get email and phone from party
      const email = party.email || "";
      const phone = party.phone || "";

      return {
        id: customer._id.toString(),
        companyName: companyName,
        state: state,
        email: email,
        phone: phone,
      };
    });

    return {
      count: totalCount,
      customers: formattedCustomers,
    };
  }

  /**
   * Send client broadcast to customers matching filter criteria
   * @param {Object} data - Broadcast data (subject, message, method, filters)
   * @param {Object} user - Authenticated user
   * @returns {Object} Delivery statistics
   */
  static async sendClientBroadcast(data, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required fields
    if (!data.subject || !data.subject.trim()) {
      throw new AppError("Subject is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.message || !data.message.trim()) {
      throw new AppError("Message is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.method || !["EMAIL", "SMS", "BOTH"].includes(data.method)) {
      throw new AppError(
        "Method must be EMAIL, SMS, or BOTH",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate filter arrays (same as preview)
    const errors = [];

    if (data.filterStates !== undefined && !Array.isArray(data.filterStates)) {
      errors.push({
        field: "filterStates",
        message: "filterStates must be an array",
      });
    }

    if (data.filterWorkTypes !== undefined && !Array.isArray(data.filterWorkTypes)) {
      errors.push({
        field: "filterWorkTypes",
        message: "filterWorkTypes must be an array",
      });
    }

    if (data.filterCities !== undefined && !Array.isArray(data.filterCities)) {
      errors.push({
        field: "filterCities",
        message: "filterCities must be an array",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Invalid filter data", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Extract filter arrays (default to empty arrays)
    const filterStates = data.filterStates || [];
    const filterWorkTypes = data.filterWorkTypes || [];
    const filterCities = data.filterCities || [];

    // Build aggregation pipeline (same as preview, but no limit)
    const pipeline = [];

    // Match stage: Base customer filters
    // Note: Customer model doesn't have organizationId directly
    // Filter by active customers
    const matchConditions = [
      {
        isActive: true,
      },
    ];

    // States filter (array contains any)
    if (filterStates.length > 0) {
      matchConditions.push({
        serviceStates: {
          $in: filterStates,
        },
      });
    }

    // Work types filter (array contains any)
    if (filterWorkTypes.length > 0) {
      matchConditions.push({
        serviceTypes: {
          $in: filterWorkTypes,
        },
      });
    }

    // Cities filter (array contains any, case-insensitive)
    if (filterCities.length > 0) {
      const citiesUpper = filterCities.map((city) => city.trim().toUpperCase());
      matchConditions.push({
        serviceCities: {
          $in: citiesUpper,
        },
      });
    }

    // Combine all match conditions with $and
    const matchStage = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

    pipeline.push({ $match: matchStage });

    // Lookup stage: Join with Party collection
    pipeline.push({
      $lookup: {
        from: "parties",
        localField: "partyId",
        foreignField: "_id",
        as: "party",
      },
    });

    // Unwind party array
    pipeline.push({
      $unwind: {
        path: "$party",
        preserveNullAndEmptyArrays: true,
      },
    });

    // Get total count
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Customer.aggregate(countPipeline);
    const totalRecipients = countResult.length > 0 ? countResult[0].total : 0;

    if (totalRecipients === 0) {
      throw new AppError(
        "No customers match the filter criteria",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Project stage: Select needed fields for sending
    pipeline.push({
      $project: {
        _id: 1,
        "party.email": 1,
        "party.phone": 1,
        "party.phoneAlt": 1,
      },
    });

    // Execute aggregation to get all matching customers
    const customers = await Customer.aggregate(pipeline);

    // Create broadcast record
    const sentAt = new Date();
    const broadcast = await ClientBroadcast.create({
      subject: data.subject.trim(),
      message: data.message.trim(),
      method: data.method,
      totalRecipients: totalRecipients,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      status: "PENDING",
      sentByUserId: user._id || user.id,
      sentAt: sentAt,
      organizationId: organizationId
        ? new mongoose.Types.ObjectId(organizationId)
        : null,
      filters: {
        states: filterStates,
        workTypes: filterWorkTypes,
        cities: filterCities,
      },
    });

    // Initialize SendGrid if API key is available
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    }

    // Track delivery statistics
    let emailsSent = 0;
    let emailsFailed = 0;
    let smsSent = 0;
    let smsFailed = 0;

    // Send messages to each customer
    for (const customer of customers) {
      const party = customer.party || {};
      const email = party.email;
      const phone = party.phone || party.phoneAlt;

      // Send email if method includes EMAIL
      if (data.method === "EMAIL" || data.method === "BOTH") {
        if (email && email.trim()) {
          try {
            const mailOptions = {
              to: email.trim(),
              from: process.env.FROM_EMAIL || "noreply@transporter.digital",
              subject: data.subject.trim(),
              text: data.message.trim(),
              html: data.message.trim().replace(/\n/g, "<br>"),
            };

            if (process.env.SENDGRID_API_KEY) {
              await sgMail.send(mailOptions);
              emailsSent++;
            } else {
              // Log if SendGrid not configured
              console.log(`📧 Would send email to ${email}:`, data.subject);
              emailsSent++; // Count as sent for development
            }
          } catch (error) {
            console.error(`❌ Failed to send email to ${email}:`, error.message);
            emailsFailed++;
          }
        } else {
          emailsFailed++;
        }
      }

      // Send SMS if method includes SMS
      if (data.method === "SMS" || data.method === "BOTH") {
        if (phone && phone.trim()) {
          try {
            // TODO: Integrate with actual SMS service (Twilio, AWS SNS, etc.)
            // For now, just log the SMS
            const smsMessage = `${data.subject.trim()}\n\n${data.message.trim()}`;
            console.log(`📱 Sending SMS to ${phone}:`, smsMessage);

            // In production, call SMS service:
            // await sendSMS(phone, smsMessage);

            smsSent++; // Count as sent for development
          } catch (error) {
            console.error(`❌ Failed to send SMS to ${phone}:`, error.message);
            smsFailed++;
          }
        } else {
          smsFailed++;
        }
      }
    }

    // Determine final status
    let status = "SENT";
    if (emailsFailed + smsFailed > 0) {
      if (emailsSent + smsSent === 0) {
        status = "FAILED";
      } else {
        status = "PARTIAL";
      }
    }

    // Update broadcast record with delivery statistics
    await ClientBroadcast.findByIdAndUpdate(broadcast._id, {
      emailsSent,
      emailsFailed,
      smsSent,
      smsFailed,
      status,
    });

    return {
      totalRecipients,
      emailsSent,
      emailsFailed,
      smsSent,
      smsFailed,
    };
  }
}

module.exports = BroadcastService;

