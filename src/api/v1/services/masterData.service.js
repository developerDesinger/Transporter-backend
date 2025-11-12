const Driver = require("../models/driver.model");
const Customer = require("../models/customer.model");
const Party = require("../models/party.model");
const RateCard = require("../models/rateCard.model");
const DriverRate = require("../models/driverRate.model");
const ServiceCode = require("../models/serviceCode.model");
const FuelLevy = require("../models/fuelLevy.model");
const Ancillary = require("../models/ancillary.model");
const DocumentTemplate = require("../models/documentTemplate.model");
const Zone = require("../models/zone.model");
const VehicleType = require("../models/vehicleType.model");
const Induction = require("../models/induction.model");
const DriverInduction = require("../models/driverInduction.model");
const DriverDocument = require("../models/driverDocument.model");
const Application = require("../models/application.model");
const InductionToken = require("../models/inductionToken.model");
const CustomerOnboardingToken = require("../models/customerOnboardingToken.model");
const CustomerDocument = require("../models/customerDocument.model");
const CustomerLinkedDocument = require("../models/customerLinkedDocument.model");
const DriverLinkedDocument = require("../models/driverLinkedDocument.model");
const OperationsContact = require("../models/operationsContact.model");
const BillingContact = require("../models/billingContact.model");
const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");
const { uploadFileToS3 } = require("./aws.service");
const { sendDriverApplicationEmail, sendDriverInductionSubmittedEmail, sendDriverInductionApprovedEmail, sendCustomerOnboardingEmail, sendLinkedDocumentEmail } = require("../utils/email");
const path = require("path");
const fs = require("fs").promises;

const DRIVER_PORTAL_PERMISSIONS = [
  "driver.portal.view",
  "operations.dashboard.view",
  "driver.messages.view",
  "driver.messages.send",
  "driver.daily-board.view",
  "driver.induction.manage",
];

const ensureDriverPermissions = (existingPermissions = []) => {
  const current = Array.isArray(existingPermissions)
    ? existingPermissions
    : [];
  return Array.from(new Set([...current, ...DRIVER_PORTAL_PERMISSIONS]));
};

class MasterDataService {
  // ==================== DRIVERS ====================

  /**
   * Get TMS drivers with payment terms information
   * @param {Object} query - Query parameters (cohortDays, status, isActive)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of driver objects with payment terms
   */
  static async getTmsDrivers(query, user) {
    const errors = [];

    // Validation
    if (query.cohortDays) {
      const cohortValue = parseInt(query.cohortDays);
      if (![7, 14, 21, 30].includes(cohortValue)) {
        errors.push({
          field: "cohortDays",
          message: "cohortDays must be 7, 14, 21, or 30",
        });
      }
    }

    if (query.isActive !== undefined && query.isActive !== "true" && query.isActive !== "false") {
      errors.push({
        field: "isActive",
        message: "isActive must be true or false",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Build query
    const filter = {};

    // Note: Driver model doesn't have organizationId field directly
    // Multi-tenancy can be handled through user relationship if needed

    // Filter by payment terms cohort
    if (query.cohortDays) {
      filter.payTermsDays = parseInt(query.cohortDays);
    }

    // Filter by active status
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive === "true";
    }

    // Filter by status
    if (query.status) {
      if (query.status === "active") {
        filter.isActive = true;
      } else if (query.status === "inactive") {
        filter.isActive = false;
      } else if (query.status === "COMPLIANT") {
        // For COMPLIANT, check both driverStatus and complianceStatus
        filter.$or = [
          { driverStatus: "COMPLIANT" },
          { complianceStatus: "COMPLIANT" },
        ];
      } else if (["PENDING_RECRUIT", "NEW_RECRUIT", "PENDING_INDUCTION"].includes(query.status)) {
        filter.driverStatus = query.status;
      }
    }

    // Fetch drivers with populated party and user
    const drivers = await Driver.find(filter)
      .populate("party")
      .populate("userId")
      .sort({ driverCode: 1 })
      .lean();

    // Transform response
    const transformedDrivers = drivers.map((driver) => ({
      id: driver._id.toString(),
      userId: driver.userId ? driver.userId._id.toString() : null,
      partyId: driver.partyId ? driver.partyId.toString() : null,
      driverCode: driver.driverCode || null,
      driverStatus: driver.driverStatus || null,
      complianceStatus: driver.complianceStatus || null,
      isActive: driver.isActive || false,
      payTermsDays: driver.payTermsDays || 7, // Default to 7 if not set
      payAnchorDate: driver.payAnchorDate
        ? driver.payAnchorDate.toISOString().split("T")[0]
        : null,
      remittanceEmail: driver.remittanceEmail || null,
      party: driver.party
        ? {
            id: driver.party._id.toString(),
            firstName: driver.party.firstName || null,
            lastName: driver.party.lastName || null,
            companyName: driver.party.companyName || null,
            email: driver.party.email || null,
            phone: driver.party.phone || null,
          }
        : null,
      user: driver.userId
        ? {
            id: driver.userId._id.toString(),
            email: driver.userId.email || null,
            username: driver.userId.userName || driver.userId.username || null,
            role: driver.userId.role || null,
            status: driver.userId.status || null,
            fullName: driver.userId.fullName || driver.userId.name || null,
          }
        : null,
      organizationId: null, // Driver model doesn't have organizationId directly
      createdAt: driver.createdAt.toISOString(),
      updatedAt: driver.updatedAt.toISOString(),
    }));

    return transformedDrivers;
  }

  static async getAllDrivers(query, user) {
    const filter = {};

    // Note: Driver model doesn't have organizationId field directly
    // Multi-tenancy can be handled through user relationship if needed

    // If userId is provided, filter by userId (for drivers viewing their own data)
    if (query.userId) {
      // Convert string userId to ObjectId if needed
      filter.userId = mongoose.Types.ObjectId.isValid(query.userId)
        ? new mongoose.Types.ObjectId(query.userId)
        : query.userId;
    }

    // Apply status filter
    if (query.status) {
      if (query.status === "active") {
        filter.isActive = true;
      } else if (query.status === "inactive") {
        filter.isActive = false;
      } else if (["PENDING_RECRUIT", "NEW_RECRUIT", "PENDING_INDUCTION", "COMPLIANT"].includes(query.status)) {
        filter.driverStatus = query.status;
      }
    }

    const drivers = await Driver.find(filter)
      .populate("party")
      .populate("userId", "id email userName role status fullName")
      .sort({ createdAt: -1 })
      .lean();

    // If userId was provided, return single driver or first match
    if (query.userId) {
      const driver = drivers.find((d) => d.userId && d.userId._id.toString() === query.userId) || drivers[0];
      
      if (!driver) {
        return null; // Driver not found
      }

      return {
        id: driver._id.toString(),
        userId: driver.userId ? driver.userId._id.toString() : null,
        partyId: driver.partyId ? driver.partyId.toString() : null,
        driverStatus: driver.driverStatus || null,
        complianceStatus: driver.complianceStatus || null,
        isActive: driver.isActive,
        party: driver.party
          ? {
              id: driver.party._id.toString(),
              firstName: driver.party.firstName,
              lastName: driver.party.lastName,
              email: driver.party.email,
              phone: driver.party.phone,
              companyName: driver.party.companyName,
              suburb: driver.party.suburb,
              state: driver.party.state,
              postcode: driver.party.postcode,
            }
          : null,
        user: driver.userId
          ? {
              id: driver.userId._id.toString(),
              email: driver.userId.email,
              username: driver.userId.userName,
              role: driver.userId.role,
              status: driver.userId.status,
              fullName: driver.userId.fullName,
            }
          : null,
        employmentType: driver.employmentType,
        driverCode: driver.driverCode,
        createdAt: driver.createdAt ? driver.createdAt.toISOString() : new Date().toISOString(),
        updatedAt: driver.updatedAt ? driver.updatedAt.toISOString() : new Date().toISOString(),
      };
    }

    // Return all matching drivers
    return drivers.map((driver) => ({
      id: driver._id.toString(),
      userId: driver.userId ? driver.userId._id.toString() : null,
      partyId: driver.partyId ? driver.partyId.toString() : null,
      driverStatus: driver.driverStatus || null,
      complianceStatus: driver.complianceStatus || null,
      party: driver.party
        ? {
            id: driver.party._id.toString(),
            firstName: driver.party.firstName,
            lastName: driver.party.lastName,
            email: driver.party.email,
            phone: driver.party.phone,
            companyName: driver.party.companyName,
            suburb: driver.party.suburb,
            state: driver.party.state,
            postcode: driver.party.postcode,
          }
        : null,
      user: driver.userId
        ? {
            id: driver.userId._id.toString(),
            email: driver.userId.email,
            username: driver.userId.userName,
            role: driver.userId.role,
            status: driver.userId.status,
          }
        : null,
      employmentType: driver.employmentType,
      isActive: driver.isActive,
      driverCode: driver.driverCode,
      licenseExpiry: driver.licenseExpiry,
      motorInsuranceExpiry: driver.motorInsuranceExpiry,
      publicLiabilityExpiry: driver.publicLiabilityExpiry,
      marineCargoExpiry: driver.marineCargoExpiry,
      workersCompExpiry: driver.workersCompExpiry,
      createdAt: driver.createdAt ? driver.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: driver.updatedAt ? driver.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  static async getDriverById(driverId) {
    const driver = await Driver.findById(driverId).populate("party");
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get driver documents to find document URLs (fallback to DriverDocument if not in driver model)
    const documents = await DriverDocument.find({ driverId }).lean();
    const documentMap = {};
    documents.forEach((doc) => {
      if (doc.documentType === "LICENSE_FRONT") {
        documentMap.licenseDocumentFront = doc.fileUrl;
      } else if (doc.documentType === "LICENSE_BACK") {
        documentMap.licenseDocumentBack = doc.fileUrl;
      } else if (doc.documentType === "MOTOR_INSURANCE") {
        documentMap.motorInsuranceDocument = doc.fileUrl;
      } else if (doc.documentType === "PUBLIC_LIABILITY") {
        documentMap.publicLiabilityDocument = doc.fileUrl;
      } else if (doc.documentType === "MARINE_CARGO_INSURANCE") {
        documentMap.marineCargoInsuranceDocument = doc.fileUrl;
      } else if (doc.documentType === "WORKERS_COMP") {
        documentMap.workersCompDocument = doc.fileUrl;
      }
    });

    // Use driver model fields first, fallback to DriverDocument
    if (driver.licenseDocumentFront) {
      documentMap.licenseDocumentFront = driver.licenseDocumentFront;
    }
    if (driver.licenseDocumentBack) {
      documentMap.licenseDocumentBack = driver.licenseDocumentBack;
    }
    if (driver.motorInsuranceDocument) {
      documentMap.motorInsuranceDocument = driver.motorInsuranceDocument;
    }
    if (driver.publicLiabilityDocument) {
      documentMap.publicLiabilityDocument = driver.publicLiabilityDocument;
    }
    if (driver.marineCargoInsuranceDocument) {
      documentMap.marineCargoInsuranceDocument = driver.marineCargoInsuranceDocument;
    }
    if (driver.workersCompDocument) {
      documentMap.workersCompDocument = driver.workersCompDocument;
    }

    // Format bank details
    const bankDetails =
      driver.bankName || driver.accountName || driver.bsb || driver.accountNumber
        ? {
            bankName: driver.bankName || null,
            accountName: driver.accountName || null,
            bsb: driver.bsb || null,
            accountNumber: driver.accountNumber || null,
          }
        : null;

    return {
      id: driver._id.toString(),
      partyId: driver.partyId ? driver.partyId.toString() : null,
      party: driver.party
        ? {
            id: driver.party._id.toString(),
            firstName: driver.party.firstName,
            lastName: driver.party.lastName,
            email: driver.party.email,
            phone: driver.party.phone,
            companyName: driver.party.companyName,
            abn: driver.party.abn,
            suburb: driver.party.suburb,
            state: driver.party.state,
            postcode: driver.party.postcode,
            city: driver.party.suburb, // Using suburb as city
            status: driver.isActive ? "active" : "inactive",
          }
        : null,
      employmentType: driver.employmentType,
      contactType: driver.contactType,
      driverNumber: driver.driverCode,
      isActive: driver.isActive,
      complianceStatus: driver.complianceStatus,
      inductionStatus: "COMPLETED", // TODO: Calculate from DriverInduction records
      defaultVehicleType: driver.vehicleTypesInFleet?.[0] || null,
      payMethod: "BOTH", // TODO: Determine from rates
      baseHourlyRate: null, // TODO: Get from rates
      baseFtlRate: null, // TODO: Get from rates
      minHours: null,
      payTermsDays: null,
      gstRegistered: driver.gstRegistered,
      rctiAgreementAccepted: false, // TODO: Add to model if needed
      driverFuelLevyPct: driver.driverFuelLevyPct || null,
      licenseExpiry: driver.licenseExpiry,
      licenseDocumentFront: documentMap.licenseDocumentFront || null,
      licenseDocumentBack: documentMap.licenseDocumentBack || null,
      motorInsurancePolicyNumber: driver.motorInsurancePolicyNumber,
      motorInsuranceDocument: documentMap.motorInsuranceDocument || null,
      motorInsuranceExpiry: driver.motorInsuranceExpiry,
      publicLiabilityPolicyNumber: driver.publicLiabilityPolicyNumber,
      publicLiabilityDocument: documentMap.publicLiabilityDocument || null,
      publicLiabilityExpiry: driver.publicLiabilityExpiry,
      marineCargoInsurancePolicyNumber: driver.marineCargoInsurancePolicyNumber,
      marineCargoInsuranceDocument: documentMap.marineCargoInsuranceDocument || null,
      marineCargoInsuranceExpiry: driver.marineCargoExpiry,
      workersCompPolicyNumber: driver.workersCompPolicyNumber,
      workersCompDocument: documentMap.workersCompDocument || null,
      workersCompExpiry: driver.workersCompExpiry,
      bankDetails: bankDetails,
      fleetOwnerId: null, // TODO: Add to model if needed
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
    };
  }

  static async createDriver(data) {
    // Validate required fields
    if (!data.party || !data.party.firstName || !data.party.lastName) {
      throw new AppError(
        "First name and last name are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!data.fullName) {
      throw new AppError("Full name is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate email format if provided
    if (data.party.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.party.email)) {
        throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Check for duplicate email
    if (data.party.email) {
      const existingParty = await Party.findOne({
        email: data.party.email.toLowerCase().trim(),
      });
      if (existingParty) {
        const existingDriver = await Driver.findOne({ partyId: existingParty._id });
        if (existingDriver) {
          throw new AppError(
            "Driver with this email already exists",
            HttpStatusCodes.CONFLICT
          );
        }
      }
    }

    // Create or find party
    let party = await Party.findOne({
      email: data.party.email?.toLowerCase().trim(),
    });
    if (!party) {
      party = await Party.create({
        ...data.party,
        email: data.party.email?.toLowerCase().trim(),
      });
    } else {
      // Update party data
      Object.assign(party, data.party);
      if (data.party.email) {
        party.email = data.party.email.toLowerCase().trim();
      }
      await party.save();
    }

    // Generate driver code if not provided
    let driverCode = data.driverNumber || data.driverCode;
    if (!driverCode) {
      const count = await Driver.countDocuments();
      driverCode = `DRV${String(count + 1).padStart(4, "0")}`;
    }

    // Check uniqueness
    const existing = await Driver.findOne({ driverCode });
    if (existing) {
      throw new AppError(
        "Driver code already exists.",
        HttpStatusCodes.CONFLICT
      );
    }

    // Prepare driver data
    const driverData = {
      partyId: party._id,
      driverCode: driverCode.toUpperCase(),
      employmentType: data.employmentType || "CONTRACTOR",
      isActive: data.isActive !== undefined ? data.isActive : true,
      contactType: data.contactType,
      abn: data.party?.abn || data.abn,
      bankName: data.bankDetails?.bankName || data.bankName,
      accountName: data.bankDetails?.accountName || data.accountName,
      bsb: data.bankDetails?.bsb || data.bsb,
      accountNumber: data.bankDetails?.accountNumber || data.accountNumber,
      servicesProvided: data.servicesProvided,
      vehicleTypesInFleet: data.vehicleTypesInFleet,
      fleetSize: data.fleetSize,
      gstRegistered: data.gstRegistered || false,
      driverFuelLevyPct: data.driverFuelLevyPct || null,
      motorInsurancePolicyNumber: data.motorInsurancePolicyNumber,
      marineCargoInsurancePolicyNumber: data.marineCargoInsurancePolicyNumber,
      publicLiabilityPolicyNumber: data.publicLiabilityPolicyNumber,
      workersCompPolicyNumber: data.workersCompPolicyNumber,
    };

    // Handle date fields
    const dateFields = [
      "licenseExpiry",
      "motorInsuranceExpiry",
      "publicLiabilityExpiry",
      "marineCargoExpiry",
      "workersCompExpiry",
    ];
    dateFields.forEach((field) => {
      if (data[field]) {
        const dateValue = new Date(data[field]);
        driverData[field] = isNaN(dateValue.getTime()) ? null : dateValue;
      }
    });

    // Handle document URL fields
    const documentFields = [
      "licenseDocumentFront",
      "licenseDocumentBack",
      "motorInsuranceDocument",
      "publicLiabilityDocument",
      "marineCargoInsuranceDocument",
      "workersCompDocument",
    ];
    documentFields.forEach((field) => {
      if (data[field] !== undefined) {
        driverData[field] = data[field] || null;
      }
    });

    const driver = await Driver.create(driverData);

    const populated = await Driver.findById(driver._id).populate("party");

    return {
      success: true,
      message: "Driver created successfully",
      user: await this.getDriverById(driver._id.toString()),
    };
  }

  static async toggleDriverStatus(driverId, isActive) {
    const driver = await Driver.findById(driverId).populate("party");
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    driver.isActive = isActive;
    await driver.save();

    return {
      success: true,
      message: "Driver status updated successfully",
      driver: {
        id: driver._id.toString(),
        party: driver.party,
        isActive: driver.isActive,
      },
    };
  }

  static async updateDriver(driverId, data) {
    const driver = await Driver.findById(driverId).populate("party");
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Handle fullName recalculation if firstName or lastName is updated
    if (data.firstName || data.lastName) {
      const firstName = data.firstName ?? driver.party?.firstName ?? "";
      const lastName = data.lastName ?? driver.party?.lastName ?? "";
      data.fullName = `${firstName} ${lastName}`.trim() || "Unknown";
    }

    // Handle date fields - convert strings to Date objects or null
    const dateFields = [
      "licenseExpiry",
      "motorInsuranceExpiry",
      "publicLiabilityExpiry",
      "marineCargoExpiry",
      "workersCompExpiry",
    ];

    dateFields.forEach((field) => {
      if (field in data) {
        const value = data[field];
        if (!value || value === "") {
          data[field] = null;
        } else if (typeof value === "string") {
          const dateObj = new Date(value);
          data[field] = isNaN(dateObj.getTime()) ? null : dateObj;
        }
      }
    });

    // Handle document URL fields - convert empty strings to null
    const documentFields = [
      "licenseDocumentFront",
      "licenseDocumentBack",
      "motorInsuranceDocument",
      "publicLiabilityDocument",
      "marineCargoInsuranceDocument",
      "workersCompDocument",
    ];
    documentFields.forEach((field) => {
      if (field in data) {
        const value = data[field];
        if (!value || value === "") {
          data[field] = null;
        }
      }
    });

    // Separate party fields from driver fields
    const partyFields = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "companyName",
      "abn",
      "suburb",
      "state",
      "postcode",
      "city",
      "fullName",
    ];
    const partyUpdateData = {};
    const driverUpdateData = {};

    Object.keys(data).forEach((key) => {
      if (partyFields.includes(key)) {
        partyUpdateData[key] = data[key];
      } else if (key === "bankDetails") {
        // Handle bank details object
        if (data.bankDetails) {
          driverUpdateData.bankName = data.bankDetails.bankName;
          driverUpdateData.accountName = data.bankDetails.accountName;
          driverUpdateData.bsb = data.bankDetails.bsb;
          driverUpdateData.accountNumber = data.bankDetails.accountNumber;
        }
      } else if (key !== "party") {
        driverUpdateData[key] = data[key];
      }
    });

    // Update party if party fields are provided
    if (Object.keys(partyUpdateData).length > 0 && driver.party) {
      if (partyUpdateData.email) {
        partyUpdateData.email = partyUpdateData.email.toLowerCase().trim();
      }
      Object.assign(driver.party, partyUpdateData);
      await driver.party.save();
    }

    // Update driver
    if (Object.keys(driverUpdateData).length > 0) {
      Object.assign(driver, driverUpdateData);
      await driver.save();
    }

    return await this.getDriverById(driverId);
  }

  // ==================== DRIVER RATES ====================

  static async getDriverRates(driverId) {
    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get only current rates (effectiveTo is null)
    const rates = await DriverRate.find({
      driverId,
      effectiveTo: null, // Only get current rates
    })
      .sort({ createdAt: -1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      driverId: rate.driverId.toString(),
      serviceCode: rate.serviceCode || rate.laneKey || null, // For FTL, use laneKey as serviceCode
      payPerHour: rate.payPerHour ? rate.payPerHour.toString() : null,
      payFtl: rate.flatRate ? rate.flatRate.toString() : null, // Map flatRate to payFtl
      minHours: null, // Not in model currently, but included for API compatibility
      lockedAt: rate.lockedAt ? rate.lockedAt.toISOString() : null,
      effectiveFrom: rate.effectiveFrom ? rate.effectiveFrom.toISOString() : rate.createdAt.toISOString(),
      effectiveTo: rate.effectiveTo ? rate.effectiveTo.toISOString() : null,
      createdAt: rate.createdAt ? rate.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  // ==================== DRIVER LINKED DOCUMENTS ====================

  static async getDriverLinkedDocuments(driverId) {
    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all linked documents with template information
    const linkedDocuments = await DriverLinkedDocument.find({ driverId })
      .populate("template")
      .sort({ createdAt: -1 })
      .lean();

    return linkedDocuments.map((linkedDoc) => ({
      id: linkedDoc._id.toString(),
      driverId: linkedDoc.driverId.toString(),
      templateId: linkedDoc.templateId.toString(),
      template: linkedDoc.template
        ? {
            id: linkedDoc.template._id.toString(),
            documentKey: linkedDoc.template.documentKey,
            title: linkedDoc.template.title,
            category: linkedDoc.template.category,
            content: linkedDoc.template.content,
            isActive: linkedDoc.template.isActive,
          }
        : null,
      customizedContent: linkedDoc.customizedContent,
      status: linkedDoc.status,
      sentAt: linkedDoc.sentAt,
      sentTo: linkedDoc.sentTo,
      createdAt: linkedDoc.createdAt,
      updatedAt: linkedDoc.updatedAt,
    }));
  }

  static async linkDocumentTemplateToDriver(driverId, data) {
    const { templateId } = data;

    // Validate templateId
    if (!templateId) {
      throw new AppError("Template ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify template exists
    const template = await DocumentTemplate.findById(templateId);
    if (!template) {
      throw new AppError("Template not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if template is already linked
    const existingLink = await DriverLinkedDocument.findOne({
      driverId: driverId,
      templateId: templateId,
    });

    if (existingLink) {
      throw new AppError(
        "This template is already linked to this driver",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create linked document
    const linkedDocument = await DriverLinkedDocument.create({
      driverId: driverId,
      templateId: templateId,
      status: "DRAFT",
    });

    // Fetch with template details
    const linkedDocWithTemplate = await DriverLinkedDocument.findById(
      linkedDocument._id
    )
      .populate("template")
      .lean();

    return {
      id: linkedDocWithTemplate._id.toString(),
      driverId: linkedDocWithTemplate.driverId.toString(),
      templateId: linkedDocWithTemplate.templateId.toString(),
      template: linkedDocWithTemplate.template
        ? {
            id: linkedDocWithTemplate.template._id.toString(),
            documentKey: linkedDocWithTemplate.template.documentKey,
            title: linkedDocWithTemplate.template.title,
            category: linkedDocWithTemplate.template.category,
            content: linkedDocWithTemplate.template.content,
            isActive: linkedDocWithTemplate.template.isActive,
          }
        : null,
      customizedContent: linkedDocWithTemplate.customizedContent,
      status: linkedDocWithTemplate.status,
      sentAt: linkedDocWithTemplate.sentAt,
      sentTo: linkedDocWithTemplate.sentTo,
      createdAt: linkedDocWithTemplate.createdAt,
      updatedAt: linkedDocWithTemplate.updatedAt,
    };
  }

  static async updateLinkedDocument(docId, data) {
    const { customizedContent } = data;

    // Try to find in driver linked documents first
    let linkedDoc = await DriverLinkedDocument.findById(docId).populate(
      "template"
    );
    let isDriverDoc = true;

    // If not found, try customer linked documents
    if (!linkedDoc) {
      linkedDoc = await CustomerLinkedDocument.findById(docId).populate(
        "template"
      );
      isDriverDoc = false;
    }

    if (!linkedDoc) {
      throw new AppError(
        "Linked document not found.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Update linked document
    if (customizedContent !== undefined) {
      linkedDoc.customizedContent = customizedContent;
    }
    await linkedDoc.save();

    return {
      id: linkedDoc._id.toString(),
      driverId: isDriverDoc ? linkedDoc.driverId?.toString() : null,
      customerId: !isDriverDoc ? linkedDoc.customerId?.toString() : null,
      templateId: linkedDoc.templateId.toString(),
      customizedContent: linkedDoc.customizedContent,
      status: linkedDoc.status,
      updatedAt: linkedDoc.updatedAt,
    };
  }

  static async deleteLinkedDocument(docId) {
    // Try to find in driver linked documents first
    let linkedDoc = await DriverLinkedDocument.findById(docId);

    // If not found, try customer linked documents
    if (!linkedDoc) {
      linkedDoc = await CustomerLinkedDocument.findById(docId);
    }

    if (!linkedDoc) {
      throw new AppError(
        "Linked document not found.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Delete linked document (works for both models)
    if (linkedDoc.driverId) {
      await DriverLinkedDocument.deleteOne({ _id: docId });
    } else {
      await CustomerLinkedDocument.deleteOne({ _id: docId });
    }

    return {
      success: true,
      message: "Linked document deleted successfully",
    };
  }

  // ==================== DRIVER DOCUMENT UPLOAD ====================

  static async uploadFile(file, context = "drivers") {
    if (!file) {
      throw new AppError("File is required", HttpStatusCodes.BAD_REQUEST);
    }

    // File is already uploaded by multer diskStorage
    // Convert absolute path to relative path
    let fileUrl = file.path;
    if (file.path.startsWith(process.cwd())) {
      fileUrl = file.path.replace(process.cwd(), "");
    }
    // Ensure it starts with /uploads
    if (!fileUrl.startsWith("/uploads")) {
      const uploadsIndex = fileUrl.indexOf("uploads");
      if (uploadsIndex !== -1) {
        fileUrl = "/" + fileUrl.substring(uploadsIndex);
      } else {
        fileUrl = `/uploads/${context}/${file.filename}`;
      }
    }

    return {
      url: fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    };
  }

  static async updateDriverDocument(driverId, data) {
    const { expiryField, documentField, expiryDate, documentUrl } = data;

    // Validate required fields
    if (!expiryField || !documentField || !expiryDate || !documentUrl) {
      throw new AppError("All fields are required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format
    const expiryDateObj = new Date(expiryDate);
    if (isNaN(expiryDateObj.getTime())) {
      throw new AppError("Invalid expiry date format", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate field names (security check)
    const validExpiryFields = [
      "licenseExpiry",
      "motorInsuranceExpiry",
      "publicLiabilityExpiry",
      "marineCargoExpiry",
      "workersCompExpiry",
    ];
    const validDocumentFields = [
      "licenseDocumentFront",
      "licenseDocumentBack",
      "motorInsuranceDocument",
      "publicLiabilityDocument",
      "marineCargoInsuranceDocument",
      "workersCompDocument",
    ];

    if (!validExpiryFields.includes(expiryField)) {
      throw new AppError("Invalid expiry field name", HttpStatusCodes.BAD_REQUEST);
    }
    if (!validDocumentFields.includes(documentField)) {
      throw new AppError("Invalid document field name", HttpStatusCodes.BAD_REQUEST);
    }

    // Update driver record
    driver[documentField] = documentUrl;
    driver[expiryField] = expiryDateObj;
    await driver.save();

    return {
      success: true,
      message: "Document updated successfully",
    };
  }

  static async uploadDriverDocument(driverId, file, policyType) {
    if (!file) {
      throw new AppError("File is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!driverId) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Driver ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!policyType) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Policy type is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Map policy type to document field
    const policyTypeMap = {
      "drivers-licence": {
        documentField: "licenseDocumentFront",
        expiryField: "licenseExpiry",
        documentType: "LICENSE_FRONT",
      },
      "motor-insurance": {
        documentField: "motorInsuranceDocument",
        expiryField: "motorInsuranceExpiry",
        documentType: "MOTOR_INSURANCE",
      },
      "public-liability-insurance": {
        documentField: "publicLiabilityDocument",
        expiryField: "publicLiabilityExpiry",
        documentType: "PUBLIC_LIABILITY",
      },
      "marine-cargo-insurance": {
        documentField: "marineCargoInsuranceDocument",
        expiryField: "marineCargoExpiry",
        documentType: "MARINE_CARGO_INSURANCE",
      },
      "workers-comp-insurance": {
        documentField: "workersCompDocument",
        expiryField: "workersCompExpiry",
        documentType: "WORKERS_COMP",
      },
    };

    const fieldMapping = policyTypeMap[policyType];
    if (!fieldMapping) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Invalid policy type", HttpStatusCodes.BAD_REQUEST);
    }

    const documentUrl = `/uploads/drivers/${driverId}/${file.filename}`;

    // Update driver record with document URL
    driver[fieldMapping.documentField] = documentUrl;
    await driver.save();

    // Also create/update DriverDocument record
    await DriverDocument.findOneAndUpdate(
      {
        driverId: driverId,
        documentType: fieldMapping.documentType,
      },
      {
        driverId: driverId,
        documentType: fieldMapping.documentType,
        fileName: file.originalname,
        fileUrl: documentUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date(),
        status: "PENDING", // Default status for new uploads
        reviewedAt: null,
        reviewedBy: null,
      },
      { upsert: true, new: true }
    );

    return {
      success: true,
      message: "Document uploaded successfully",
      documentUrl: documentUrl,
    };
  }

  static async sendLinkedDocument(docId, data) {
    const { recipientEmail } = data;

    // Validate recipientEmail
    if (!recipientEmail) {
      throw new AppError(
        "Valid recipient email is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
    }

    // Try to find in driver linked documents first
    let linkedDoc = await DriverLinkedDocument.findById(docId).populate(
      "template"
    );

    // If not found, try customer linked documents
    if (!linkedDoc) {
      linkedDoc = await CustomerLinkedDocument.findById(docId).populate(
        "template"
      );
    }

    if (!linkedDoc) {
      throw new AppError(
        "Linked document not found.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Get document content (use customizedContent if available, otherwise template content)
    const documentContent =
      linkedDoc.customizedContent || linkedDoc.template?.content || "";

    // Send email
    try {
      await sendLinkedDocumentEmail({
        to: recipientEmail,
        subject: linkedDoc.template?.title || "Document",
        content: documentContent,
        documentName: linkedDoc.template?.title || "Document",
      });
    } catch (emailError) {
      console.error("Error sending linked document email:", emailError);
      throw new AppError(
        "Failed to send document email. Please try again later.",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Update linked document status
    linkedDoc.status = "SENT";
    linkedDoc.sentAt = new Date();
    linkedDoc.sentTo = recipientEmail;
    await linkedDoc.save();

    return {
      success: true,
      message: "Document sent successfully",
      sentAt: new Date().toISOString(),
      sentTo: recipientEmail,
    };
  }

  static async createDriverRate(driverId, data) {
    const { serviceCode, vehicleType, payPerHour, payFtl, effectiveFrom } = data;

    // Validate required fields
    if (!serviceCode || !vehicleType) {
      throw new AppError(
        "Service code and vehicle type are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!payPerHour && !payFtl) {
      throw new AppError(
        "Either payPerHour or payFtl must be provided",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if rates are locked (only check current rates)
    const existingRates = await DriverRate.find({
      driverId,
      isLocked: true,
      effectiveTo: null, // Only check current rates
    });
    if (existingRates.length > 0) {
      throw new AppError(
        "Rates are locked. Unlock before creating new rates.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Determine rate type
    const rateType = payPerHour ? "HOURLY" : "FTL";

    // Check for duplicate rate (only check current rates)
    const duplicateQuery = {
      driverId,
      vehicleType,
      rateType,
      effectiveTo: null, // Only check current rates
    };

    if (rateType === "HOURLY") {
      duplicateQuery.serviceCode = serviceCode;
    } else {
      duplicateQuery.laneKey = serviceCode; // For FTL, serviceCode is actually laneKey
    }

    const duplicateRate = await DriverRate.findOne(duplicateQuery);

    if (duplicateRate) {
      throw new AppError(
        "Rate already exists for this service code and vehicle type",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create new rate
    const rateData = {
      driverId,
      vehicleType,
      rateType,
      serviceCode: rateType === "HOURLY" ? serviceCode : null,
      laneKey: rateType === "FTL" ? serviceCode : null,
      payPerHour: payPerHour ? parseFloat(payPerHour) : null,
      flatRate: payFtl ? parseFloat(payFtl) : null,
      isLocked: false,
      lockedAt: null,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      effectiveTo: null,
    };

    const rate = await DriverRate.create(rateData);

    return {
      id: rate._id.toString(),
      driverId: rate.driverId.toString(),
      serviceCode: rate.serviceCode || rate.laneKey || null,
      vehicleType: rate.vehicleType,
      payPerHour: rate.payPerHour ? rate.payPerHour.toString() : null,
      payFtl: rate.flatRate ? rate.flatRate.toString() : null,
      lockedAt: rate.lockedAt ? rate.lockedAt.toISOString() : null,
      effectiveFrom: rate.effectiveFrom ? rate.effectiveFrom.toISOString() : rate.createdAt.toISOString(),
      effectiveTo: rate.effectiveTo ? rate.effectiveTo.toISOString() : null,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }

  static async updateDriverRate(driverId, rateId, data) {
    const rate = await DriverRate.findOne({
      _id: rateId,
      driverId,
      effectiveTo: null, // Only update current rates
    });

    if (!rate) {
      throw new AppError("Rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked) {
      throw new AppError(
        "Rates are locked. Unlock before updating.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update only provided fields
    if (data.serviceCode !== undefined) {
      if (rate.rateType === "HOURLY") {
        rate.serviceCode = data.serviceCode;
      } else {
        rate.laneKey = data.serviceCode; // For FTL, serviceCode is laneKey
      }
    }
    if (data.vehicleType !== undefined) {
      rate.vehicleType = data.vehicleType;
    }
    if (data.payPerHour !== undefined) {
      rate.payPerHour = data.payPerHour ? parseFloat(data.payPerHour) : null;
    }
    if (data.payFtl !== undefined) {
      rate.flatRate = data.payFtl ? parseFloat(data.payFtl) : null;
    }

    await rate.save();

    return {
      id: rate._id.toString(),
      driverId: rate.driverId.toString(),
      serviceCode: rate.serviceCode || rate.laneKey || null,
      vehicleType: rate.vehicleType,
      payPerHour: rate.payPerHour ? rate.payPerHour.toString() : null,
      payFtl: rate.flatRate ? rate.flatRate.toString() : null,
      lockedAt: rate.lockedAt ? rate.lockedAt.toISOString() : null,
      effectiveFrom: rate.effectiveFrom ? rate.effectiveFrom.toISOString() : rate.createdAt.toISOString(),
      effectiveTo: rate.effectiveTo ? rate.effectiveTo.toISOString() : null,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }

  static async deleteDriverRate(driverId, rateId) {
    const rate = await DriverRate.findOne({
      _id: rateId,
      driverId,
      effectiveTo: null, // Only delete current rates
    });

    if (!rate) {
      throw new AppError("Rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked) {
      throw new AppError(
        "Rates are locked. Unlock before deleting.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    await DriverRate.findByIdAndDelete(rateId);

    return {
      success: true,
      message: "Driver rate deleted successfully",
    };
  }

  static async lockDriverRates(driverId) {
    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all current rates
    const rates = await DriverRate.find({ driverId, isLocked: false });

    if (rates.length === 0) {
      throw new AppError(
        "No rates found to lock",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Lock all rates
    const lockedAt = new Date();
    await DriverRate.updateMany(
      { driverId, effectiveTo: null }, // Only lock current rates
      { isLocked: true, lockedAt: lockedAt }
    );

    return {
      success: true,
      message: "Driver rates locked successfully",
      lockedAt: lockedAt.toISOString(),
    };
  }

  static async unlockDriverRates(driverId) {
    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all current locked rates
    const rates = await DriverRate.find({
      driverId,
      isLocked: true,
      effectiveTo: null, // Only unlock current rates
    });

    if (rates.length === 0) {
      throw new AppError(
        "Rates are not locked",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Unlock all rates
    await DriverRate.updateMany(
      { driverId, effectiveTo: null },
      { isLocked: false, lockedAt: null }
    );

    return {
      success: true,
      message: "Driver rates unlocked successfully",
    };
  }

  static async applyCPIToDriverRates(driverId, percentage, effectiveFrom, createNewVersion) {
    // Validate percentage
    if (!percentage || isNaN(percentage) || percentage <= 0) {
      throw new AppError(
        "Percentage must be greater than 0",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all current rates (not expired, not locked)
    const rates = await DriverRate.find({
      driverId,
      isLocked: false,
      effectiveTo: null, // Only current rates
    });

    if (rates.length === 0) {
      throw new AppError(
        "No rates found to update",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check if any rates are locked
    const lockedRates = await DriverRate.find({
      driverId,
      isLocked: true,
      effectiveTo: null,
    });

    if (lockedRates.length > 0) {
      throw new AppError(
        "Rates are locked. Unlock before applying CPI increase.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (createNewVersion) {
      // Create new versions with updated rates
      const newEffectiveFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

      // Set effectiveTo on old rates
      await DriverRate.updateMany(
        { driverId, _id: { $in: rates.map((r) => r._id) } },
        { effectiveTo: newEffectiveFrom }
      );

      // Create new rate versions
      const newRates = rates.map((rate) => ({
        driverId: rate.driverId,
        serviceCode: rate.serviceCode,
        vehicleType: rate.vehicleType,
        rateType: rate.rateType,
        laneKey: rate.laneKey,
        payPerHour: rate.payPerHour
          ? parseFloat((rate.payPerHour * (1 + percentage / 100)).toFixed(2))
          : null,
        flatRate: rate.flatRate
          ? parseFloat((rate.flatRate * (1 + percentage / 100)).toFixed(2))
          : null,
        isLocked: false,
        lockedAt: null,
        effectiveFrom: newEffectiveFrom,
        effectiveTo: null,
      }));

      await DriverRate.insertMany(newRates);
    } else {
      // Update in place
      for (const rate of rates) {
        if (rate.payPerHour) {
          rate.payPerHour = parseFloat(
            (rate.payPerHour * (1 + percentage / 100)).toFixed(2)
          );
        }
        if (rate.flatRate) {
          rate.flatRate = parseFloat(
            (rate.flatRate * (1 + percentage / 100)).toFixed(2)
          );
        }
        await rate.save();
      }
    }

    return {
      success: true,
      message: "CPI increase applied successfully",
      affectedCount: rates.length,
      percentage,
    };
  }

  static async copyHourlyHouseRates(driverId, rateIds) {
    // Validate rateIds
    if (!Array.isArray(rateIds) || rateIds.length === 0) {
      throw new AppError("Rate IDs array is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if rates are locked (only check current rates)
    const existingRates = await DriverRate.find({
      driverId,
      isLocked: true,
      effectiveTo: null, // Only check current rates
    });
    if (existingRates.length > 0) {
      throw new AppError(
        "Rates are locked. Unlock before copying rates.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Find house driver (driver with contactType = "house")
    const houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      throw new AppError("House driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get house hourly rates (only current rates)
    const houseRates = await DriverRate.find({
      driverId: houseDriver._id,
      _id: { $in: rateIds },
      rateType: "HOURLY",
      payPerHour: { $ne: null },
      effectiveTo: null, // Only get current rates
    });

    if (houseRates.length !== rateIds.length) {
      throw new AppError(
        "One or more house rates not found",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Copy rates to driver
    let copiedCount = 0;
    for (const houseRate of houseRates) {
      // Check if rate already exists for this driver (only current rates)
      const existingRate = await DriverRate.findOne({
        driverId: driverId,
        serviceCode: houseRate.serviceCode,
        vehicleType: houseRate.vehicleType,
        rateType: "HOURLY",
        effectiveTo: null, // Only check current rates
      });

      if (!existingRate) {
        await DriverRate.create({
          driverId: driverId,
          serviceCode: houseRate.serviceCode,
          vehicleType: houseRate.vehicleType,
          rateType: "HOURLY",
          payPerHour: houseRate.payPerHour,
          flatRate: null,
          laneKey: null,
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copiedCount++;
      }
    }

    return {
      success: true,
      message: "Hourly rates copied successfully",
      copiedCount,
    };
  }

  static async copyFtlHouseRates(driverId, rateIds) {
    // Validate rateIds
    if (!Array.isArray(rateIds) || rateIds.length === 0) {
      throw new AppError("Rate IDs array is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if rates are locked (only check current rates)
    const existingRates = await DriverRate.find({
      driverId,
      isLocked: true,
      effectiveTo: null, // Only check current rates
    });
    if (existingRates.length > 0) {
      throw new AppError(
        "Rates are locked. Unlock before copying rates.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Find house driver (driver with contactType = "house")
    const houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      throw new AppError("House driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get house FTL rates (only current rates)
    const houseRates = await DriverRate.find({
      driverId: houseDriver._id,
      _id: { $in: rateIds },
      rateType: "FTL",
      flatRate: { $ne: null },
      effectiveTo: null, // Only get current rates
    });

    if (houseRates.length !== rateIds.length) {
      throw new AppError(
        "One or more house rates not found",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Copy rates to driver
    let copiedCount = 0;
    for (const houseRate of houseRates) {
      // Check if rate already exists for this driver (only current rates)
      const existingRate = await DriverRate.findOne({
        driverId: driverId,
        laneKey: houseRate.laneKey,
        vehicleType: houseRate.vehicleType,
        rateType: "FTL",
        effectiveTo: null, // Only check current rates
      });

      if (!existingRate) {
        await DriverRate.create({
          driverId: driverId,
          serviceCode: null,
          vehicleType: houseRate.vehicleType,
          rateType: "FTL",
          payPerHour: null,
          flatRate: houseRate.flatRate,
          laneKey: houseRate.laneKey,
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copiedCount++;
      }
    }

    return {
      success: true,
      message: "FTL rates copied successfully",
      copiedCount,
    };
  }

  static async updateDriverFuelLevy(driverId, data) {
    const { driverFuelLevyPct } = data;

    // Validate fuel levy
    if (!driverFuelLevyPct && driverFuelLevyPct !== "0") {
      throw new AppError(
        "driverFuelLevyPct is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const fuelLevyNum = parseFloat(driverFuelLevyPct);
    if (isNaN(fuelLevyNum) || fuelLevyNum < 0) {
      throw new AppError(
        "Fuel levy percentage must be a valid number",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Update fuel levy
    driver.driverFuelLevyPct = driverFuelLevyPct;
    await driver.save();

    // Return formatted driver
    const formattedDriver = await this.getDriverById(driverId);

    return {
      success: true,
      message: "Driver fuel levy updated successfully",
      driver: formattedDriver,
    };
  }

  // ==================== CUSTOMERS ====================

  static async getAllCustomers(query) {
    const filter = {};

    if (query.status === "active") {
      filter.isActive = true;
    } else if (query.status === "inactive") {
      filter.isActive = false;
    }

    const customers = await Customer.find(filter)
      .populate("party")
      .sort({ createdAt: -1 })
      .lean();

    return customers.map((customer) => ({
      id: customer._id.toString(),
      partyId: customer.partyId ? customer.partyId.toString() : null,
      party: customer.party
        ? {
            id: customer.party._id.toString(),
            companyName: customer.party.companyName,
            email: customer.party.email,
            phone: customer.party.phone,
            phoneAlt: customer.party.phoneAlt,
            contactName: customer.party.contactName,
            suburb: customer.party.suburb,
            state: customer.party.state,
            postcode: customer.party.postcode,
            address: customer.party.address,
            registeredAddress: customer.party.registeredAddress,
            abn: customer.party.abn,
          }
        : null,
      // Company Information
      acn: customer.acn,
      legalCompanyName: customer.legalCompanyName,
      tradingName: customer.tradingName,
      websiteUrl: customer.websiteUrl,
      registeredAddress: customer.registeredAddress,
      city: customer.city,
      state: customer.state,
      postcode: customer.postcode,
      // Primary Contact
      primaryContactName: customer.primaryContactName,
      primaryContactPosition: customer.primaryContactPosition,
      primaryContactEmail: customer.primaryContactEmail,
      primaryContactPhone: customer.primaryContactPhone,
      primaryContactMobile: customer.primaryContactMobile,
      // Accounts Contact
      accountsName: customer.accountsName,
      accountsEmail: customer.accountsEmail,
      accountsPhone: customer.accountsPhone,
      accountsMobile: customer.accountsMobile,
      // Billing & Payment
      termsDays: customer.termsDays,
      defaultFuelLevyPct: customer.defaultFuelLevyPct,
      customFuelLevyMetroPct: customer.customFuelLevyMetroPct || null,
      customFuelLevyInterstatePct: customer.customFuelLevyInterstatePct || null,
      invoiceGrouping: customer.invoiceGrouping,
      invoicePrefix: customer.invoicePrefix,
      // Onboarding
      onboardingStatus: customer.onboardingStatus,
      onboardingSentAt: customer.onboardingSentAt,
      // Service Information
      serviceStates: customer.serviceStates || [],
      serviceCities: customer.serviceCities || [],
      serviceTypes: customer.serviceTypes || [],
      // Pallet Information
      palletsUsed: customer.palletsUsed,
      chepAccountNumber: customer.chepAccountNumber,
      loscamAccountNumber: customer.loscamAccountNumber,
      palletControllerName: customer.palletControllerName,
      palletControllerEmail: customer.palletControllerEmail,
      // Status
      isActive: customer.isActive,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    }));
  }

  static async createCustomer(data) {
    // Handle both nested (data.party) and flat (data) structures
    const partyData = data.party || data;
    
    // Validate required fields
    if (!partyData.email) {
      throw new AppError("Email is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Create or find party
    let party = await Party.findOne({ email: partyData.email.toLowerCase().trim() });
    if (!party) {
      party = await Party.create({
        firstName: partyData.firstName || "",
        lastName: partyData.lastName || "",
        email: partyData.email.toLowerCase().trim(),
        phone: partyData.phone || "",
        phoneAlt: partyData.phoneAlt || null,
        companyName: partyData.companyName || null,
        suburb: partyData.suburb || null,
        state: partyData.state || null,
        postcode: partyData.postcode || null,
        abn: partyData.abn || null,
      });
    } else {
      // Update existing party with new data
      if (partyData.firstName) party.firstName = partyData.firstName;
      if (partyData.lastName) party.lastName = partyData.lastName;
      if (partyData.phone) party.phone = partyData.phone;
      if (partyData.phoneAlt !== undefined) party.phoneAlt = partyData.phoneAlt;
      if (partyData.companyName !== undefined) party.companyName = partyData.companyName;
      if (partyData.suburb !== undefined) party.suburb = partyData.suburb;
      if (partyData.state !== undefined) party.state = partyData.state;
      if (partyData.postcode !== undefined) party.postcode = partyData.postcode;
      if (partyData.abn !== undefined) party.abn = partyData.abn;
      await party.save();
    }

    // Check if customer already exists
    let customer = await Customer.findOne({ partyId: party._id });
    if (!customer) {
      customer = await Customer.create({
        partyId: party._id,
        isActive: data.isActive !== undefined ? data.isActive : true,
      });
    } else {
      // Update existing customer
      if (data.isActive !== undefined) {
        customer.isActive = data.isActive;
        await customer.save();
      }
    }

    const populated = await Customer.findById(customer._id).populate("party");

    return {
      success: true,
      message: "Customer created successfully",
      customer: {
        id: populated._id.toString(),
        party: populated.party,
        ...populated.toObject(),
      },
    };
  }

  static async toggleCustomerStatus(customerId, isActive) {
    const customer = await Customer.findById(customerId).populate("party");
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    customer.isActive = isActive;
    await customer.save();

    return {
      success: true,
      message: "Customer status updated successfully",
      customer: {
        id: customer._id.toString(),
        party: customer.party,
        isActive: customer.isActive,
      },
    };
  }

  static async getCustomerById(customerId) {
    const customer = await Customer.findById(customerId)
      .populate("party")
      .lean();

    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Format customer response
    const formattedCustomer = {
      id: customer._id.toString(),
      partyId: customer.partyId.toString(),
      party: customer.party
        ? {
            id: customer.party._id.toString(),
            companyName: customer.party.companyName,
            email: customer.party.email,
            phone: customer.party.phone,
            phoneAlt: customer.party.phoneAlt,
            contactName: customer.party.contactName,
            suburb: customer.party.suburb,
            state: customer.party.state,
            postcode: customer.party.postcode,
            address: customer.party.address,
            registeredAddress: customer.party.registeredAddress,
            abn: customer.party.abn,
          }
        : null,
      acn: customer.acn,
      legalCompanyName: customer.legalCompanyName,
      tradingName: customer.tradingName,
      websiteUrl: customer.websiteUrl,
      registeredAddress: customer.registeredAddress,
      city: customer.city,
      state: customer.state,
      postcode: customer.postcode,
      primaryContactName: customer.primaryContactName,
      primaryContactPosition: customer.primaryContactPosition,
      primaryContactEmail: customer.primaryContactEmail,
      primaryContactPhone: customer.primaryContactPhone,
      primaryContactMobile: customer.primaryContactMobile,
      accountsName: customer.accountsName,
      accountsEmail: customer.accountsEmail,
      accountsPhone: customer.accountsPhone,
      accountsMobile: customer.accountsMobile,
      termsDays: customer.termsDays,
      defaultFuelLevyPct: customer.defaultFuelLevyPct,
      customFuelLevyMetroPct: customer.customFuelLevyMetroPct || null,
      customFuelLevyInterstatePct: customer.customFuelLevyInterstatePct || null,
      invoiceGrouping: customer.invoiceGrouping,
      invoicePrefix: customer.invoicePrefix,
      onboardingStatus: customer.onboardingStatus,
      onboardingSentAt: customer.onboardingSentAt,
      serviceStates: customer.serviceStates || [],
      serviceCities: customer.serviceCities || [],
      serviceTypes: customer.serviceTypes || [],
      palletsUsed: customer.palletsUsed,
      chepAccountNumber: customer.chepAccountNumber,
      loscamAccountNumber: customer.loscamAccountNumber,
      palletControllerName: customer.palletControllerName,
      palletControllerEmail: customer.palletControllerEmail,
      isActive: customer.isActive,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };

    return formattedCustomer;
  }

  static async getCustomerDocuments(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all documents for this customer
    const documents = await CustomerDocument.find({ customerId })
      .populate("uploadedBy", "fullName name")
      .sort({ createdAt: -1 })
      .lean();

    return documents.map((doc) => ({
      id: doc._id.toString(),
      customerId: doc.customerId.toString(),
      documentType: doc.documentType,
      title: doc.title,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      uploadedBy: doc.uploadedBy ? doc.uploadedBy._id.toString() : null,
      uploadedByName: doc.uploadedBy
        ? doc.uploadedBy.fullName || doc.uploadedBy.name || "Unknown"
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  static async uploadCustomerDocument(customerId, file, data, userId) {
    const { documentType, title } = data;

    // Validate required fields
    if (!file) {
      throw new AppError("File is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!documentType) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Document type is required", HttpStatusCodes.BAD_REQUEST);
    }

    const validDocumentTypes = ["APPLICATION_PDF", "CONTRACT", "INSURANCE", "OTHER"];
    if (!validDocumentTypes.includes(documentType)) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError(
        `Invalid document type. Must be one of: ${validDocumentTypes.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!title || !title.trim()) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Title is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      // Clean up uploaded file
      try {
        await fs.unlink(file.path);
      } catch (error) {
        // Ignore cleanup errors
      }
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get user name for uploadedBy
    const user = await User.findById(userId).select("fullName name");
    const uploadedByName = user
      ? user.fullName || user.name || "Unknown"
      : "Unknown";

    // Create document record
    const document = await CustomerDocument.create({
      customerId: customerId,
      documentType: documentType,
      title: title.trim(),
      fileName: file.originalname,
      fileUrl: `/uploads/customers/${customerId}/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: userId,
    });

    return {
      id: document._id.toString(),
      customerId: document.customerId.toString(),
      documentType: document.documentType,
      title: document.title,
      fileName: document.fileName,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      uploadedBy: document.uploadedBy.toString(),
      uploadedByName: uploadedByName,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  static async deleteCustomerDocument(customerId, documentId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Find document
    const document = await CustomerDocument.findOne({
      _id: documentId,
      customerId: customerId,
    });

    if (!document) {
      throw new AppError("Document not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Delete physical file
    const filePath = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      document.fileUrl
    );

    try {
      await fs.unlink(filePath);
    } catch (fileError) {
      console.error("Error deleting file:", fileError);
      // Continue with database deletion even if file deletion fails
    }

    // Delete document record
    await CustomerDocument.deleteOne({ _id: documentId });

    return {
      success: true,
      message: "Document deleted successfully",
    };
  }

  static async downloadCustomerDocument(customerId, documentId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Find document
    const document = await CustomerDocument.findOne({
      _id: documentId,
      customerId: customerId,
    });

    if (!document) {
      throw new AppError("Document not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Construct file path
    const filePath = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      document.fileUrl
    );

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new AppError("File not found on server", HttpStatusCodes.NOT_FOUND);
    }

    return {
      filePath: filePath,
      fileName: document.fileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
    };
  }

  static async getCustomerLinkedDocuments(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all linked documents with template information
    const linkedDocuments = await CustomerLinkedDocument.find({ customerId })
      .populate("template")
      .sort({ createdAt: -1 })
      .lean();

    return linkedDocuments.map((linkedDoc) => ({
      id: linkedDoc._id.toString(),
      customerId: linkedDoc.customerId.toString(),
      templateId: linkedDoc.templateId.toString(),
      template: linkedDoc.template
        ? {
            id: linkedDoc.template._id.toString(),
            documentKey: linkedDoc.template.documentKey,
            title: linkedDoc.template.title,
            category: linkedDoc.template.category,
            content: linkedDoc.template.content,
            isActive: linkedDoc.template.isActive,
          }
        : null,
      customizedContent: linkedDoc.customizedContent,
      status: linkedDoc.status,
      sentAt: linkedDoc.sentAt,
      sentTo: linkedDoc.sentTo,
      createdAt: linkedDoc.createdAt,
      updatedAt: linkedDoc.updatedAt,
    }));
  }

  // ==================== OPERATIONS CONTACTS ====================

  static async getOperationsContacts(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all operations contacts for this customer
    const contacts = await OperationsContact.find({ customerId })
      .sort({ createdAt: -1 })
      .lean();

    return contacts.map((contact) => ({
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    }));
  }

  static async createOperationsContact(customerId, data) {
    const { name, position, email, phone, mobile } = data;

    // Validate required fields
    if (!name || name.trim() === "") {
      throw new AppError("Name is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate email format if provided
    if (email && email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Create contact
    const contact = await OperationsContact.create({
      customerId,
      name: name.trim(),
      position: position?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      mobile: mobile?.trim() || null,
    });

    return {
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  static async updateOperationsContact(customerId, contactId, data) {
    const { name, position, email, phone, mobile } = data;

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify contact exists and belongs to customer
    const contact = await OperationsContact.findOne({
      _id: contactId,
      customerId: customerId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate email format if provided
    if (email !== undefined && email !== null && email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Update contact (only provided fields)
    if (name !== undefined) contact.name = name.trim();
    if (position !== undefined) contact.position = position?.trim() || null;
    if (email !== undefined) contact.email = email?.trim() || null;
    if (phone !== undefined) contact.phone = phone?.trim() || null;
    if (mobile !== undefined) contact.mobile = mobile?.trim() || null;

    await contact.save();

    return {
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  static async deleteOperationsContact(customerId, contactId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify contact exists and belongs to customer
    const contact = await OperationsContact.findOne({
      _id: contactId,
      customerId: customerId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Delete contact
    await OperationsContact.deleteOne({ _id: contactId });

    return {
      success: true,
      message: "Contact deleted successfully",
    };
  }

  // ==================== BILLING CONTACTS ====================

  static async getBillingContacts(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all billing contacts for this customer
    const contacts = await BillingContact.find({ customerId })
      .sort({ createdAt: -1 })
      .lean();

    return contacts.map((contact) => ({
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      isInvoiceReceiver: contact.isInvoiceReceiver || false,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    }));
  }

  static async createBillingContact(customerId, data) {
    const { name, position, email, phone, mobile, isInvoiceReceiver } = data;

    // Validate required fields
    if (!name || name.trim() === "") {
      throw new AppError("Name is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate email format if provided
    if (email && email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Create contact
    const contact = await BillingContact.create({
      customerId,
      name: name.trim(),
      position: position?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      mobile: mobile?.trim() || null,
      isInvoiceReceiver: isInvoiceReceiver !== undefined ? isInvoiceReceiver : false,
    });

    return {
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      isInvoiceReceiver: contact.isInvoiceReceiver || false,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  static async updateBillingContact(customerId, contactId, data) {
    const { name, position, email, phone, mobile, isInvoiceReceiver } = data;

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify contact exists and belongs to customer
    const contact = await BillingContact.findOne({
      _id: contactId,
      customerId: customerId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate email format if provided
    if (email !== undefined && email !== null && email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError("Invalid email format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Update contact (only provided fields)
    if (name !== undefined) contact.name = name.trim();
    if (position !== undefined) contact.position = position?.trim() || null;
    if (email !== undefined) contact.email = email?.trim() || null;
    if (phone !== undefined) contact.phone = phone?.trim() || null;
    if (mobile !== undefined) contact.mobile = mobile?.trim() || null;
    if (isInvoiceReceiver !== undefined) contact.isInvoiceReceiver = isInvoiceReceiver;

    await contact.save();

    return {
      id: contact._id.toString(),
      customerId: contact.customerId.toString(),
      name: contact.name,
      position: contact.position || null,
      email: contact.email || null,
      phone: contact.phone || null,
      mobile: contact.mobile || null,
      isInvoiceReceiver: contact.isInvoiceReceiver || false,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  static async deleteBillingContact(customerId, contactId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify contact exists and belongs to customer
    const contact = await BillingContact.findOne({
      _id: contactId,
      customerId: customerId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Delete contact
    await BillingContact.deleteOne({ _id: contactId });

    return {
      success: true,
      message: "Contact deleted successfully",
    };
  }

  // ==================== CUSTOMER FUEL LEVY ====================

  static async updateCustomerFuelLevy(customerId, data) {
    const { metroPct, interstatePct } = data;

    // Validate required fields
    if (!metroPct || !interstatePct) {
      throw new AppError("metroPct and interstatePct are required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate percentage format and range
    const metroValue = parseFloat(metroPct);
    const interstateValue = parseFloat(interstatePct);

    if (isNaN(metroValue) || isNaN(interstateValue)) {
      throw new AppError("Percentages must be valid numbers", HttpStatusCodes.BAD_REQUEST);
    }

    if (metroValue < 0 || metroValue > 100 || interstateValue < 0 || interstateValue > 100) {
      throw new AppError("Percentages must be between 0 and 100", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Update customer fuel levy (format to 2 decimal places)
    customer.customFuelLevyMetroPct = parseFloat(metroPct).toFixed(2);
    customer.customFuelLevyInterstatePct = parseFloat(interstatePct).toFixed(2);
    await customer.save();

    return {
      id: customer._id.toString(),
      customFuelLevyMetroPct: customer.customFuelLevyMetroPct,
      customFuelLevyInterstatePct: customer.customFuelLevyInterstatePct,
      updatedAt: customer.updatedAt,
    };
  }

  // ==================== CUSTOMER HOURLY RATES ====================

  static async getCustomerHourlyRates(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all hourly rates for this customer
    const rates = await RateCard.find({
      customerId: customerId,
      rateType: "HOURLY",
    })
      .sort({ serviceCode: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      customerId: rate.customerId ? rate.customerId.toString() : null,
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toFixed(2) : "0.00",
      version: 1, // Default version if not in model
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || null,
      isLocked: rate.isLocked || false,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    }));
  }

  static async createCustomerHourlyRate(customerId, data) {
    const { serviceCode, vehicleType, rateExGst, description } = data;

    // Validate required fields
    if (!vehicleType || !rateExGst) {
      throw new AppError(
        "Vehicle Type and Rate Ex GST are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate rateExGst
    const rateValue = parseFloat(rateExGst);
    if (isNaN(rateValue) || rateValue < 0) {
      throw new AppError("Invalid rate value", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check for duplicate rate (same serviceCode + vehicleType for this customer)
    const existingRate = await RateCard.findOne({
      customerId: customerId,
      rateType: "HOURLY",
      serviceCode: serviceCode || null,
      vehicleType: vehicleType.trim(),
    });

    if (existingRate) {
      throw new AppError(
        "A rate with this service code and vehicle type already exists",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create new rate
    const rate = await RateCard.create({
      customerId: customerId,
      rateType: "HOURLY",
      serviceCode: serviceCode?.trim() || null,
      vehicleType: vehicleType.trim(),
      rateExGst: parseFloat(rateExGst),
      description: description?.trim() || null,
      effectiveFrom: new Date(),
      isLocked: false,
    });

    return {
      id: rate._id.toString(),
      customerId: rate.customerId ? rate.customerId.toString() : null,
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toFixed(2) : "0.00",
      version: 1,
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || null,
      isLocked: rate.isLocked || false,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }

  static async updateCustomerHourlyRate(customerId, rateId, data) {
    const { serviceCode, vehicleType, rateExGst } = data;

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify rate exists and belongs to customer
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: customerId,
      rateType: "HOURLY",
    });

    if (!rate) {
      throw new AppError("Rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if rate is locked
    if (rate.isLocked) {
      throw new AppError(
        "Rate is locked and cannot be updated",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Validate rateExGst if provided
    if (rateExGst !== undefined) {
      const rateValue = parseFloat(rateExGst);
      if (isNaN(rateValue) || rateValue < 0) {
        throw new AppError("Invalid rate value", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Update rate (only provided fields)
    if (serviceCode !== undefined) rate.serviceCode = serviceCode.trim();
    if (vehicleType !== undefined) rate.vehicleType = vehicleType.trim();
    if (rateExGst !== undefined) rate.rateExGst = parseFloat(rateExGst);

    await rate.save();

    return {
      id: rate._id.toString(),
      customerId: rate.customerId ? rate.customerId.toString() : null,
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toFixed(2) : "0.00",
      version: 1,
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || null,
      isLocked: rate.isLocked || false,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }

  static async deleteCustomerHourlyRate(customerId, rateId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Verify rate exists and belongs to customer
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: customerId,
      rateType: "HOURLY",
    });

    if (!rate) {
      throw new AppError("Rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if rate is locked
    if (rate.isLocked) {
      throw new AppError(
        "Rate is locked and cannot be deleted",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Delete rate
    await RateCard.deleteOne({ _id: rateId });

    return {
      success: true,
      message: "Hourly rate deleted successfully",
    };
  }

  // ==================== CUSTOMER FTL RATES ====================

  static async getCustomerFtlRates(customerId) {
    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get all FTL rates for this customer
    const rates = await RateCard.find({
      customerId: customerId,
      rateType: "FTL",
    })
      .sort({ laneKey: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      customerId: rate.customerId ? rate.customerId.toString() : null,
      laneKey: rate.laneKey,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toFixed(2) : "0.00",
      version: 1, // Default version if not in model
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || null,
      isLocked: rate.isLocked || false,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    }));
  }

  static async createCustomerFtlRate(customerId, data) {
    const { laneKey, vehicleType, rateExGst, description } = data;

    // Validate required fields
    if (!laneKey || !vehicleType || !rateExGst) {
      throw new AppError(
        "Vehicle Type, Rate Ex GST, and Lane Key are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate laneKey format
    if (!laneKey.includes("-")) {
      throw new AppError(
        "Lane Key must be in format ORIGIN-DESTINATION (e.g., SYD-MEL)",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate rateExGst
    const rateValue = parseFloat(rateExGst);
    if (isNaN(rateValue) || rateValue < 0) {
      throw new AppError("Invalid rate value", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check for duplicate rate (same laneKey + vehicleType for this customer)
    const existingRate = await RateCard.findOne({
      customerId: customerId,
      rateType: "FTL",
      laneKey: laneKey.trim(),
      vehicleType: vehicleType.trim(),
    });

    if (existingRate) {
      throw new AppError(
        "A rate with this lane key and vehicle type already exists",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create new rate
    const rate = await RateCard.create({
      customerId: customerId,
      rateType: "FTL",
      laneKey: laneKey.trim(),
      vehicleType: vehicleType.trim(),
      rateExGst: parseFloat(rateExGst),
      description: description?.trim() || null,
      effectiveFrom: new Date(),
      isLocked: false,
    });

    return {
      id: rate._id.toString(),
      customerId: rate.customerId ? rate.customerId.toString() : null,
      laneKey: rate.laneKey,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toFixed(2) : "0.00",
      version: 1,
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || null,
      isLocked: rate.isLocked || false,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }

  // ==================== CUSTOMER ONBOARDING ====================

  static async sendCustomerOnboarding(customerId, data) {
    const { companyName, email } = data;

    // Validate required fields
    if (!companyName || !email) {
      throw new AppError(
        "Company Name and Email are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError(
        "Invalid email address format",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify customer exists
    const customer = await Customer.findById(customerId).populate("party");
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Generate secure token for onboarding link
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create or update onboarding token record
    await CustomerOnboardingToken.findOneAndUpdate(
      { customerId: customerId, email: email.toLowerCase().trim() },
      {
        customerId: customerId,
        email: email.toLowerCase().trim(),
        token: token,
        expiresAt: expiresAt,
        used: false,
        usedAt: null,
      },
      { upsert: true, new: true }
    );

    // Generate onboarding link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const onboardingLink = `${frontendUrl}/onboarding?token=${token}&customerId=${customerId}`;

    // Update customer record
    customer.onboardingStatus = "SENT";
    customer.onboardingSentAt = new Date();
    // Optionally update primary contact email if different
    if (email !== customer.primaryContactEmail) {
      customer.primaryContactEmail = email;
    }
    await customer.save();

    // Send email notification
    try {
      await sendCustomerOnboardingEmail({
        to: email,
        companyName: companyName,
        onboardingLink: onboardingLink,
        customerId: customerId,
      });
    } catch (emailError) {
      console.error("Error sending customer onboarding email:", emailError);
      // Rollback customer status update
      customer.onboardingStatus = "DRAFT";
      customer.onboardingSentAt = null;
      await customer.save();
      throw new AppError(
        "Failed to send onboarding email. Please try again later.",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return {
      success: true,
      message: "Onboarding link sent successfully",
      email: email,
      sentAt: new Date().toISOString(),
    };
  }

  static async updateCustomer(customerId, data) {
    const customer = await Customer.findById(customerId).populate("party");
    if (!customer) {
      throw new AppError("Customer not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Fields that belong to Party model
    const partyFields = [
      "companyName",
      "firstName",
      "lastName",
      "email",
      "phone",
      "phoneAlt",
      "contactName",
      "suburb",
      "state",
      "postcode",
      "address",
      "registeredAddress",
      "abn",
      "stateRegion",
    ];

    // Update party - handle both nested party object and root-level party fields
    if (customer.party) {
      const partyUpdates = {};

      // If party data is nested in data.party
      if (data.party && typeof data.party === "object") {
        Object.assign(partyUpdates, data.party);
      }

      // Also check for party fields at root level
      partyFields.forEach((field) => {
        if (data[field] !== undefined) {
          partyUpdates[field] = data[field];
        }
      });

      // Apply updates to party if any
      if (Object.keys(partyUpdates).length > 0) {
        Object.assign(customer.party, partyUpdates);
        await customer.party.save();
      }
    }

    // Update customer fields (exclude party fields and nested party object)
    const customerFields = { ...data };
    delete customerFields.party;
    // Remove party fields from customerFields
    partyFields.forEach((field) => {
      delete customerFields[field];
    });

    // Only update if there are customer-specific fields
    if (Object.keys(customerFields).length > 0) {
      Object.assign(customer, customerFields);
      await customer.save();
    }

    const populated = await Customer.findById(customer._id).populate("party");

    return {
      success: true,
      message: "Customer updated successfully",
      customer: {
        id: populated._id.toString(),
        party: populated.party,
        ...populated.toObject(),
      },
    };
  }

  // ==================== RATE CARDS ====================

  static async getAllRateCards(query, user) {
    const filter = {
      effectiveTo: null, // Only current rates by default
    };

    if (query.customerId) {
      filter.customerId = query.customerId;
    }

    if (query.rateType) {
      filter.rateType = query.rateType;
    }

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const rateCards = await RateCard.find(filter)
      .populate("customerId")
      .sort({ createdAt: -1 })
      .lean();

    return rateCards.map((card) => ({
      id: card._id.toString(),
      customerId: card.customerId ? card.customerId._id.toString() : null,
      rateType: card.rateType,
      serviceCode: card.serviceCode,
      vehicleType: card.vehicleType,
      laneKey: card.laneKey,
      rateExGst: card.rateExGst ? card.rateExGst.toString() : "0.00",
      effectiveFrom: card.effectiveFrom ? card.effectiveFrom.toISOString() : new Date().toISOString(),
      description: card.description,
      isLocked: card.isLocked || false,
      lockedAt: card.lockedAt ? card.lockedAt.toISOString() : null,
      createdAt: card.createdAt ? card.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  static async createRateCard(data, user) {
    const Customer = require("../models/customer.model");
    const Party = require("../models/party.model");

    // Validate required fields
    if (!data.rateType || !data.vehicleType || !data.rateExGst) {
      throw new AppError(
        "rateType, vehicleType, and rateExGst are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify customer exists if customerId provided
    if (data.customerId) {
      const customer = await Customer.findById(data.customerId);
      if (!customer) {
        throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
      }

      // Check organization access (multi-tenant)
      if (
        !user.isSuperAdmin &&
        user.activeOrganizationId &&
        customer.organizationId &&
        customer.organizationId.toString() !== user.activeOrganizationId.toString()
      ) {
        throw new AppError(
          "Access denied to this customer",
          HttpStatusCodes.FORBIDDEN
        );
      }
    }

    // Prepare rate card data
    const rateCardData = {
      customerId: data.customerId || null,
      rateType: data.rateType,
      rateExGst: parseFloat(data.rateExGst),
      vehicleType: data.vehicleType,
      serviceCode: data.serviceCode || null,
      laneKey: data.laneKey || null,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      effectiveTo: null, // New rates are current
      description: data.description || null,
      isLocked: false,
      lockedAt: null,
      organizationId: user.activeOrganizationId || null,
    };

    const rateCard = await RateCard.create(rateCardData);

    return {
      id: rateCard._id.toString(),
      customerId: rateCard.customerId ? rateCard.customerId.toString() : null,
      rateType: rateCard.rateType,
      rate: rateCard.rateExGst.toString(),
      rateExGst: rateCard.rateExGst.toString(),
      serviceCode: rateCard.serviceCode,
      vehicleType: rateCard.vehicleType,
      createdAt: rateCard.createdAt.toISOString(),
    };
  }

  static async updateRateCard(rateCardId, data) {
    const rateCard = await RateCard.findById(rateCardId);

    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rateCard.isLocked || rateCard.lockedAt) {
      throw new AppError(
        "Cannot update locked rate card.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update only provided fields
    if (data.rateExGst !== undefined) {
      rateCard.rateExGst = parseFloat(data.rateExGst);
    }
    if (data.serviceCode !== undefined) rateCard.serviceCode = data.serviceCode;
    if (data.vehicleType !== undefined) rateCard.vehicleType = data.vehicleType;
    if (data.laneKey !== undefined) rateCard.laneKey = data.laneKey;
    if (data.description !== undefined) rateCard.description = data.description;

    await rateCard.save();

    return {
      success: true,
      message: "Rate card updated successfully",
      rateCard: rateCard.toObject(),
    };
  }

  static async deleteRateCard(rateCardId) {
    const rateCard = await RateCard.findById(rateCardId);

    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rateCard.isLocked) {
      throw new AppError(
        "Cannot delete locked rate card.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    await RateCard.findByIdAndDelete(rateCardId);

    return {
      success: true,
      message: "Rate card deleted successfully",
    };
  }

  static async lockRateCard(rateCardId) {
    const rateCard = await RateCard.findById(rateCardId);
    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rateCard.isLocked || rateCard.lockedAt) {
      throw new AppError(
        "Rate card is already locked.",
        HttpStatusCodes.CONFLICT
      );
    }

    const lockedAt = new Date();
    rateCard.isLocked = true;
    rateCard.lockedAt = lockedAt;
    await rateCard.save();

    return {
      success: true,
      message: "Rate card locked successfully",
      lockedAt: lockedAt.toISOString(),
    };
  }

  static async unlockRateCard(rateCardId) {
    const rateCard = await RateCard.findById(rateCardId);
    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    rateCard.isLocked = false;
    rateCard.lockedAt = null;
    await rateCard.save();

    return {
      success: true,
      message: "Rate card unlocked successfully",
    };
  }

  static async applyCPIToRateCards(data, user) {
    const Customer = require("../models/customer.model");
    const Party = require("../models/party.model");
    const {
      partyId,
      rateType,
      percentage,
      createNewVersion,
      effectiveFrom,
      versionNotes,
    } = data;

    // Validate required fields
    if (!partyId || !rateType || !percentage || createNewVersion === undefined) {
      throw new AppError(
        "partyId, rateType, percentage, and createNewVersion are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate percentage
    if (!percentage || isNaN(percentage) || percentage <= 0) {
      throw new AppError(
        "Percentage must be greater than 0",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Get party
    const party = await Party.findById(partyId);
    if (!party) {
      throw new AppError("Party not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get customer for this party
    const customer = await Customer.findOne({ partyId: party._id });
    if (!customer) {
      throw new AppError("Customer not found for this party", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      customer.organizationId &&
      customer.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this customer",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Get all current rates for this customer and rate type
    const filter = {
      customerId: customer._id,
      rateType: rateType,
      effectiveTo: null, // Only current rates
      isLocked: false, // Only unlocked rates
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const rateCards = await RateCard.find(filter);

    if (rateCards.length === 0) {
      throw new AppError(
        "No rates found to update",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    let updatedCount = 0;
    let newVersionCount = 0;
    const newEffectiveFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

    if (createNewVersion) {
      // Set effectiveTo on old rates
      await RateCard.updateMany(
        { _id: { $in: rateCards.map((r) => r._id) } },
        { effectiveTo: newEffectiveFrom }
      );

      // Create new rate versions
      const newRates = rateCards.map((card) => ({
        customerId: card.customerId,
        rateType: card.rateType,
        serviceCode: card.serviceCode,
        vehicleType: card.vehicleType,
        laneKey: card.laneKey,
        rateExGst: parseFloat(
          (card.rateExGst * (1 + percentage / 100)).toFixed(2)
        ),
        effectiveFrom: newEffectiveFrom,
        effectiveTo: null,
        description: versionNotes || card.description || null,
        isLocked: false,
        lockedAt: null,
        organizationId: card.organizationId || user.activeOrganizationId || null,
      }));

      await RateCard.insertMany(newRates);
      newVersionCount = newRates.length;
    } else {
      // Update in place
      for (const card of rateCards) {
        card.rateExGst = parseFloat(
          (card.rateExGst * (1 + percentage / 100)).toFixed(2)
        );
        if (versionNotes) {
          card.description = versionNotes;
        }
        await card.save();
        updatedCount++;
      }
    }

    return {
      success: true,
      message: "CPI increase applied successfully",
      updatedCount: updatedCount,
      newVersionCount: newVersionCount,
    };
  }

  static async uploadRateCards(csvData, rateType, customerId) {
    // Parse CSV data (simple CSV parser)
    const lines = csvData.split("\n").filter((line) => line.trim());
    if (lines.length < 2) {
      throw new AppError("CSV file is empty or invalid.", HttpStatusCodes.BAD_REQUEST);
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const errors = [];
    let uploaded = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || "";
      });

      try {
        const rateCardData = {
          customerId: customerId || null,
          rateType,
          rateExGst: parseFloat(row.rateexgst || row.rate_ex_gst),
          vehicleType: row.vehicletype || row.vehicle_type,
          effectiveFrom: row.effectivefrom
            ? new Date(row.effectivefrom)
            : new Date(),
          effectiveTo: null, // New rates are current
          description: row.description || "",
          isLocked: false,
          lockedAt: null,
          organizationId: user ? (user.activeOrganizationId || null) : null,
        };

        if (rateType === "HOURLY") {
          rateCardData.serviceCode = row.servicecode || row.service_code;
        } else if (rateType === "FTL") {
          rateCardData.laneKey = row.lanekey || row.lane_key;
        }

        await RateCard.create(rateCardData);
        uploaded++;
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      message: "Rates uploaded successfully",
      uploaded,
      errors,
    };
  }

  static async uploadFtlHouseRates(csvData, customerId, user) {
    // Parse CSV data - FTL format: FROM ZONE,TO ZONE,VEHICLE TYPE,RATE
    const lines = csvData.split("\n").filter((line) => line.trim());
    if (lines.length < 2) {
      throw new AppError("CSV file is empty or invalid.", HttpStatusCodes.BAD_REQUEST);
    }

    const headers = lines[0].split(",").map((h) => h.trim().toUpperCase());
    const errors = [];
    let count = 0;

    // Find column indices
    const fromZoneIndex = headers.findIndex(
      (h) => h.includes("FROM") && h.includes("ZONE")
    );
    const toZoneIndex = headers.findIndex(
      (h) => h.includes("TO") && h.includes("ZONE")
    );
    const vehicleTypeIndex = headers.findIndex(
      (h) => h.includes("VEHICLE") && h.includes("TYPE")
    );
    const rateIndex = headers.findIndex((h) => h.includes("RATE"));

    if (
      fromZoneIndex === -1 ||
      toZoneIndex === -1 ||
      vehicleTypeIndex === -1 ||
      rateIndex === -1
    ) {
      throw new AppError(
        "CSV must contain: FROM ZONE, TO ZONE, VEHICLE TYPE, RATE columns",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      if (values.length < headers.length) continue;

      try {
        const fromZone = values[fromZoneIndex];
        const toZone = values[toZoneIndex];
        const vehicleType = values[vehicleTypeIndex];
        const rateExGst = parseFloat(values[rateIndex]);

        if (!fromZone || !toZone || !vehicleType || isNaN(rateExGst)) {
          errors.push({
            row: i + 1,
            error: "Missing required fields or invalid rate",
          });
          continue;
        }

        // Construct laneKey from zones
        const laneKey = `${fromZone}-${toZone}`;

        const rateCardData = {
          customerId: customerId || null,
          rateType: "FTL",
          laneKey: laneKey,
          vehicleType: vehicleType,
          rateExGst: rateExGst,
          effectiveFrom: new Date(),
          effectiveTo: null,
          isLocked: false,
          lockedAt: null,
          organizationId: user.activeOrganizationId || null,
        };

        await RateCard.create(rateCardData);
        count++;
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      count: count,
      errors: errors,
    };
  }

  static async copyFTLRatesToDriverPay(user) {
    const Party = require("../models/party.model");
    const Customer = require("../models/customer.model");
    const Driver = require("../models/driver.model");

    // Find House party (as per documentation)
    const houseParty = await Party.findOne({ companyName: "House" });
    if (!houseParty) {
      throw new AppError(
        "House party not found. Please create House party first.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Find House customer for this party
    const houseCustomer = await Customer.findOne({ partyId: houseParty._id });
    if (!houseCustomer) {
      throw new AppError(
        "House customer not found. Please create House customer first.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      houseCustomer.organizationId &&
      houseCustomer.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to House customer",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Get all FTL rates for House customer (or customerId = null for backward compatibility)
    const ftlRates = await RateCard.find({
      $or: [
        { customerId: houseCustomer._id, rateType: "FTL", effectiveTo: null },
        { customerId: null, rateType: "FTL", effectiveTo: null }, // Backward compatibility
      ],
    });

    if (ftlRates.length === 0) {
      throw new AppError(
        "No FTL rates found for House customer",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Find or create House driver
    let houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      // Create house driver if doesn't exist
      const driverParty = await Party.create({
        companyName: "House Driver",
        email: "house@system.local",
      });
      houseDriver = await Driver.create({
        partyId: driverParty._id,
        driverCode: "HOUSE",
        contactType: "house",
        employmentType: "EMPLOYEE",
        isActive: true,
        organizationId: user.activeOrganizationId || null,
      });
    }

    let copiedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const rate of ftlRates) {
      try {
        // Check if driver rate already exists (only current rates)
        const existing = await DriverRate.findOne({
          driverId: houseDriver._id,
          rateType: "FTL",
          vehicleType: rate.vehicleType,
          laneKey: rate.laneKey,
          effectiveTo: null, // Only check current rates
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        // Create driver rate
        await DriverRate.create({
          driverId: houseDriver._id,
          rateType: "FTL",
          vehicleType: rate.vehicleType,
          laneKey: rate.laneKey,
          flatRate: rate.rateExGst, // Map rateExGst to flatRate (payFtl)
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copiedCount++;
      } catch (error) {
        errors.push({ rate: rate._id.toString(), error: error.message });
      }
    }

    return {
      success: true,
      message: "Rates copied successfully",
      copiedCount: copiedCount,
      skippedCount: skippedCount,
      errors: errors,
    };
  }

  static async copyHourlyRatesToDriverPay(user) {
    const Party = require("../models/party.model");
    const Customer = require("../models/customer.model");
    const Driver = require("../models/driver.model");

    // Find House party (as per documentation)
    const houseParty = await Party.findOne({ companyName: "House" });
    if (!houseParty) {
      throw new AppError(
        "House party not found. Please create House party first.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Find House customer for this party
    const houseCustomer = await Customer.findOne({ partyId: houseParty._id });
    if (!houseCustomer) {
      throw new AppError(
        "House customer not found. Please create House customer first.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      houseCustomer.organizationId &&
      houseCustomer.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to House customer",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Get all hourly rates for House customer (or customerId = null for backward compatibility)
    const hourlyRates = await RateCard.find({
      $or: [
        { customerId: houseCustomer._id, rateType: "HOURLY", effectiveTo: null },
        { customerId: null, rateType: "HOURLY", effectiveTo: null }, // Backward compatibility
      ],
    });

    if (hourlyRates.length === 0) {
      throw new AppError(
        "No hourly rates found for House customer",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Find or create House driver
    let houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      // Create house driver if doesn't exist
      const driverParty = await Party.create({
        companyName: "House Driver",
        email: "house@system.local",
      });
      houseDriver = await Driver.create({
        partyId: driverParty._id,
        driverCode: "HOUSE",
        contactType: "house",
        employmentType: "EMPLOYEE",
        isActive: true,
        organizationId: user.activeOrganizationId || null,
      });
    }

    let copiedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const rate of hourlyRates) {
      try {
        // Check if driver rate already exists (only current rates)
        const existing = await DriverRate.findOne({
          driverId: houseDriver._id,
          rateType: "HOURLY",
          serviceCode: rate.serviceCode,
          vehicleType: rate.vehicleType,
          effectiveTo: null, // Only check current rates
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        // Create driver rate
        await DriverRate.create({
          driverId: houseDriver._id,
          rateType: "HOURLY",
          serviceCode: rate.serviceCode,
          vehicleType: rate.vehicleType,
          payPerHour: rate.rateExGst, // Map rateExGst to payPerHour
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copiedCount++;
      } catch (error) {
        errors.push({ rate: rate._id.toString(), error: error.message });
      }
    }

    return {
      success: true,
      message: "Rates copied successfully",
      copiedCount: copiedCount,
      skippedCount: skippedCount,
      errors: errors,
    };
  }

  // ==================== HOURLY HOUSE RATES ====================
  static async getAllHourlyHouseRates(query, user) {
    // Get only current rates (effectiveTo is null)
    const filter = {
      customerId: null,
      rateType: "HOURLY",
      effectiveTo: null, // Only current rates
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const rates = await RateCard.find(filter)
      .sort({ serviceCode: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      customerId: null, // Always null for house rates
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toString() : "0.00",
      createdAt: rate.createdAt ? rate.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: rate.updatedAt ? rate.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  // ==================== FTL HOUSE RATES ====================
  static async getFtlHouseRates(query, user) {
    // Get only current rates (effectiveTo is null)
    const filter = {
      customerId: null,
      rateType: "FTL",
      effectiveTo: null, // Only current rates
    };

    // Filter by customerId if provided (for customer-specific FTL rates)
    if (query && query.customerId) {
      filter.customerId = query.customerId;
    }

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const rates = await RateCard.find(filter)
      .sort({ laneKey: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => {
      // Parse laneKey to extract fromZone and toZone
      // Format: "SYDNEY-MELBOURNE" or "SYD-MEL"
      const laneParts = rate.laneKey ? rate.laneKey.split("-") : [];
      const fromZone = laneParts[0] || null;
      const toZone = laneParts.slice(1).join("-") || null;

      return {
        id: rate._id.toString(),
        customerId: rate.customerId ? rate.customerId.toString() : null,
        fromZone: fromZone,
        toZone: toZone,
        vehicleType: rate.vehicleType,
        rateExGst: rate.rateExGst ? rate.rateExGst.toString() : "0.00",
        createdAt: rate.createdAt ? rate.createdAt.toISOString() : new Date().toISOString(),
        updatedAt: rate.updatedAt ? rate.updatedAt.toISOString() : new Date().toISOString(),
      };
    });
  }

  static async updateHourlyHouseRate(rateId, data) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "HOURLY",
      effectiveTo: null, // Only update current rates
    });

    if (!rate) {
      throw new AppError("Hourly house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked || rate.lockedAt) {
      throw new AppError(
        "Cannot update locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update only provided fields
    if (data.serviceCode !== undefined) rate.serviceCode = data.serviceCode;
    if (data.vehicleType !== undefined) rate.vehicleType = data.vehicleType;
    if (data.rateExGst !== undefined) {
      rate.rateExGst = parseFloat(data.rateExGst);
    }

    await rate.save();

    return {
      id: rate._id.toString(),
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toString() : "0.00",
      updatedAt: rate.updatedAt ? rate.updatedAt.toISOString() : new Date().toISOString(),
    };
  }

  static async deleteHourlyHouseRate(rateId) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "HOURLY",
      effectiveTo: null, // Only delete current rates
    });

    if (!rate) {
      throw new AppError("Hourly house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked || rate.lockedAt) {
      throw new AppError(
        "Cannot delete locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    await RateCard.findByIdAndDelete(rateId);

    return {
      success: true,
      message: "Rate deleted successfully",
    };
  }

  static async updateFtlHouseRate(rateId, data) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "FTL",
      effectiveTo: null, // Only update current rates
    });

    if (!rate) {
      throw new AppError("FTL house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked || rate.lockedAt) {
      throw new AppError(
        "Cannot update locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update only provided fields
    if (data.fromZone !== undefined || data.toZone !== undefined) {
      // Reconstruct laneKey from fromZone and toZone
      const fromZone = data.fromZone || (rate.laneKey ? rate.laneKey.split("-")[0] : "");
      const toZone = data.toZone || (rate.laneKey ? rate.laneKey.split("-").slice(1).join("-") : "");
      rate.laneKey = `${fromZone}-${toZone}`;
    }
    if (data.vehicleType !== undefined) rate.vehicleType = data.vehicleType;
    if (data.rateExGst !== undefined) {
      rate.rateExGst = parseFloat(data.rateExGst);
    }

    await rate.save();

    // Parse laneKey for response
    const laneParts = rate.laneKey ? rate.laneKey.split("-") : [];
    const fromZone = laneParts[0] || null;
    const toZone = laneParts.slice(1).join("-") || null;

    return {
      id: rate._id.toString(),
      fromZone: fromZone,
      toZone: toZone,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst ? rate.rateExGst.toString() : "0.00",
      updatedAt: rate.updatedAt ? rate.updatedAt.toISOString() : new Date().toISOString(),
    };
  }

  static async deleteFtlHouseRate(rateId) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "FTL",
      effectiveTo: null, // Only delete current rates
    });

    if (!rate) {
      throw new AppError("FTL house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked || rate.lockedAt) {
      throw new AppError(
        "Cannot delete locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    await RateCard.findByIdAndDelete(rateId);

    return {
      success: true,
      message: "Rate deleted successfully",
    };
  }

  // ==================== FUEL LEVIES ====================

  static async getAllFuelLevies(user) {
    const filter = {};

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const levies = await FuelLevy.find(filter)
      .sort({ version: -1 }) // Order by version descending
      .lean();

    return levies.map((levy) => ({
      id: levy._id.toString(),
      version: levy.version,
      metroPct: levy.metroPct,
      interstatePct: levy.interstatePct,
      effectiveFrom: levy.effectiveFrom ? levy.effectiveFrom.toISOString() : new Date().toISOString(),
      effectiveTo: levy.effectiveTo ? levy.effectiveTo.toISOString() : null,
      notes: levy.notes || null,
      pegDateFuelPrice: levy.pegDateFuelPrice || null,
      newRefFuelPrice: levy.newRefFuelPrice || null,
      lineHaulWeighting: levy.lineHaulWeighting || null,
      localWeighting: levy.localWeighting || null,
      createdAt: levy.createdAt ? levy.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: levy.updatedAt ? levy.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  static async getCurrentFuelLevy(user) {
    const filter = {
      effectiveTo: null, // Current active fuel levy
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const levy = await FuelLevy.findOne(filter).sort({ version: -1 }).lean();

    if (!levy) {
      return null; // Return null if no active fuel levy exists
    }

    return {
      id: levy._id.toString(),
      version: levy.version,
      metroPct: levy.metroPct,
      interstatePct: levy.interstatePct,
      effectiveFrom: levy.effectiveFrom ? levy.effectiveFrom.toISOString() : new Date().toISOString(),
      effectiveTo: null,
      notes: levy.notes || null,
      pegDateFuelPrice: levy.pegDateFuelPrice || null,
      newRefFuelPrice: levy.newRefFuelPrice || null,
      lineHaulWeighting: levy.lineHaulWeighting || null,
      localWeighting: levy.localWeighting || null,
      createdAt: levy.createdAt ? levy.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: levy.updatedAt ? levy.updatedAt.toISOString() : new Date().toISOString(),
    };
  }

  static async getCurrentFuelLevies(user) {
    // Get current fuel levy (new structure has both metroPct and interstatePct in one record)
    const currentLevy = await this.getCurrentFuelLevy(user);

    if (!currentLevy) {
      return {
        hourly: null,
        ftl: null,
      };
    }

    // Return in legacy format for backward compatibility
    return {
      hourly: {
        id: currentLevy.id,
        metroPct: currentLevy.metroPct,
        interstatePct: null,
        effectiveFrom: currentLevy.effectiveFrom,
        effectiveTo: currentLevy.effectiveTo,
        version: currentLevy.version,
      },
      ftl: {
        id: currentLevy.id,
        metroPct: null,
        interstatePct: currentLevy.interstatePct,
        effectiveFrom: currentLevy.effectiveFrom,
        effectiveTo: currentLevy.effectiveTo,
        version: currentLevy.version,
      },
    };
  }

  static async createFuelLevy(data, user) {
    const {
      metroPct,
      interstatePct,
      effectiveFrom,
      notes,
      pegDateFuelPrice,
      newRefFuelPrice,
      lineHaulWeighting,
      localWeighting,
    } = data;

    // Validate required fields
    if (!metroPct || !interstatePct || !effectiveFrom) {
      throw new AppError(
        "metroPct, interstatePct, and effectiveFrom are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate percentages
    const metroValue = parseFloat(metroPct);
    const interstateValue = parseFloat(interstatePct);

    if (isNaN(metroValue) || isNaN(interstateValue)) {
      throw new AppError(
        "Percentages must be valid numbers",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (
      metroValue < 0 ||
      metroValue > 100 ||
      interstateValue < 0 ||
      interstateValue > 100
    ) {
      throw new AppError(
        "Percentages must be between 0 and 100",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate effectiveFrom date
    const effectiveFromDate = new Date(effectiveFrom);
    if (isNaN(effectiveFromDate.getTime())) {
      throw new AppError(
        "effectiveFrom must be a valid date",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Get current active fuel levy
    const filter = {
      effectiveTo: null,
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const currentFuelLevy = await FuelLevy.findOne(filter);

    // If current active fuel levy exists, set its effectiveTo
    if (currentFuelLevy) {
      // Set effectiveTo to the day before new effectiveFrom
      const newEffectiveFrom = new Date(effectiveFrom);
      const previousEffectiveTo = new Date(newEffectiveFrom);
      previousEffectiveTo.setDate(previousEffectiveTo.getDate() - 1);
      previousEffectiveTo.setHours(23, 59, 59, 999); // End of day

      currentFuelLevy.effectiveTo = previousEffectiveTo;
      await currentFuelLevy.save();
    }

    // Get highest version number for this organization
    const versionFilter = {};
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      versionFilter.organizationId = user.activeOrganizationId;
    }

    const highestVersion = await FuelLevy.findOne(versionFilter)
      .sort({ version: -1 })
      .select("version")
      .lean();

    const newVersion = (highestVersion?.version || 0) + 1;

    // Create new fuel levy
    const newFuelLevy = await FuelLevy.create({
      version: newVersion,
      metroPct: metroPct.trim(),
      interstatePct: interstatePct.trim(),
      effectiveFrom: effectiveFromDate,
      effectiveTo: null, // New active fuel levy
      notes: notes ? notes.trim() : null,
      pegDateFuelPrice: pegDateFuelPrice ? pegDateFuelPrice.trim() : null,
      newRefFuelPrice: newRefFuelPrice ? newRefFuelPrice.trim() : null,
      lineHaulWeighting: lineHaulWeighting ? lineHaulWeighting.trim() : null,
      localWeighting: localWeighting ? localWeighting.trim() : null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: newFuelLevy._id.toString(),
      version: newFuelLevy.version,
      metroPct: newFuelLevy.metroPct,
      interstatePct: newFuelLevy.interstatePct,
      effectiveFrom: newFuelLevy.effectiveFrom.toISOString(),
      effectiveTo: null,
      notes: newFuelLevy.notes || null,
      pegDateFuelPrice: newFuelLevy.pegDateFuelPrice || null,
      newRefFuelPrice: newFuelLevy.newRefFuelPrice || null,
      lineHaulWeighting: newFuelLevy.lineHaulWeighting || null,
      localWeighting: newFuelLevy.localWeighting || null,
      createdAt: newFuelLevy.createdAt.toISOString(),
      updatedAt: newFuelLevy.updatedAt.toISOString(),
    };
  }

  static async updateFuelLevy(levyId, data) {
    const levy = await FuelLevy.findById(levyId);
    if (!levy) {
      throw new AppError("Fuel levy not found.", HttpStatusCodes.NOT_FOUND);
    }

    Object.assign(levy, data);
    await levy.save();

    return {
      success: true,
      message: "Fuel levy updated successfully",
      fuelLevy: levy.toObject(),
    };
  }

  // ==================== SERVICE CODES ====================

  static async getAllServiceCodes(user, query = {}) {
    const filter = {};

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    // Optional: Filter by isActive if provided
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive === "true" || query.isActive === true;
    }

    const codes = await ServiceCode.find(filter)
      .sort({ sortOrder: 1, code: 1 }) // Sort by sortOrder first, then by code
      .lean();

    return codes.map((code) => ({
      id: code._id.toString(),
      code: code.code,
      name: code.name,
      vehicleClass: code.vehicleClass || null,
      body: code.body || null,
      pallets: code.pallets || null,
      features: code.features || null,
      isActive: code.isActive !== undefined ? code.isActive : true,
      sortOrder: code.sortOrder || null,
      createdAt: code.createdAt ? code.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: code.updatedAt ? code.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  static async createServiceCode(data, user) {
    const { code, name, vehicleClass, body, pallets, features, sortOrder } = data;

    // Validate required fields
    if (!code || !name) {
      throw new AppError(
        "code and name are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const trimmedCode = code.trim();
    const trimmedName = name.trim();

    if (!trimmedCode || !trimmedName) {
      throw new AppError(
        "code and name cannot be empty",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check for duplicate code within organization
    const filter = {
      code: trimmedCode,
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const existingCode = await ServiceCode.findOne(filter);

    if (existingCode) {
      throw new AppError(
        "A service code with this code already exists",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create new service code
    const newServiceCode = await ServiceCode.create({
      code: trimmedCode,
      name: trimmedName,
      vehicleClass: vehicleClass ? vehicleClass.trim() : null,
      body: body ? body.trim() : null,
      pallets: pallets ? pallets.trim() : null,
      features: features ? features.trim() : null,
      isActive: true,
      sortOrder: sortOrder !== undefined ? sortOrder : null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: newServiceCode._id.toString(),
      code: newServiceCode.code,
      name: newServiceCode.name,
      vehicleClass: newServiceCode.vehicleClass || null,
      body: newServiceCode.body || null,
      pallets: newServiceCode.pallets || null,
      features: newServiceCode.features || null,
      isActive: newServiceCode.isActive,
      sortOrder: newServiceCode.sortOrder || null,
      createdAt: newServiceCode.createdAt.toISOString(),
      updatedAt: newServiceCode.updatedAt.toISOString(),
    };
  }

  static async updateServiceCode(codeId, data, user) {
    const code = await ServiceCode.findById(codeId);
    if (!code) {
      throw new AppError("Service code not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      code.organizationId &&
      code.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this service code",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // If code is being changed, check for duplicates
    if (data.code && data.code.trim() !== code.code) {
      const trimmedCode = data.code.trim();
      const filter = {
        code: trimmedCode,
      };

      // Multi-tenant: Filter by organization if not super admin
      if (!user.isSuperAdmin && user.activeOrganizationId) {
        filter.organizationId = user.activeOrganizationId;
      }

      const existingCode = await ServiceCode.findOne({
        ...filter,
        _id: { $ne: codeId },
      });

      if (existingCode) {
        throw new AppError(
          "A service code with this code already exists",
          HttpStatusCodes.CONFLICT
        );
      }
    }

    // Update only provided fields
    if (data.code !== undefined) code.code = data.code.trim();
    if (data.name !== undefined) code.name = data.name.trim();
    if (data.vehicleClass !== undefined)
      code.vehicleClass = data.vehicleClass ? data.vehicleClass.trim() : null;
    if (data.body !== undefined) code.body = data.body ? data.body.trim() : null;
    if (data.pallets !== undefined)
      code.pallets = data.pallets ? data.pallets.trim() : null;
    if (data.features !== undefined)
      code.features = data.features ? data.features.trim() : null;
    if (data.isActive !== undefined) code.isActive = data.isActive;
    if (data.sortOrder !== undefined) code.sortOrder = data.sortOrder;

    await code.save();

    return {
      id: code._id.toString(),
      code: code.code,
      name: code.name,
      vehicleClass: code.vehicleClass || null,
      body: code.body || null,
      pallets: code.pallets || null,
      features: code.features || null,
      isActive: code.isActive,
      sortOrder: code.sortOrder || null,
      createdAt: code.createdAt.toISOString(),
      updatedAt: code.updatedAt.toISOString(),
    };
  }

  static async deleteServiceCode(codeId, user) {
    const code = await ServiceCode.findById(codeId);
    if (!code) {
      throw new AppError("Service code not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      code.organizationId &&
      code.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this service code",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Optional: Check if service code is referenced by rates
    const RateCard = require("../models/rateCard.model");
    const DriverRate = require("../models/driverRate.model");

    const referencedRates = await RateCard.countDocuments({
      serviceCode: code.code,
    });

    const referencedDriverRates = await DriverRate.countDocuments({
      serviceCode: code.code,
    });

    if (referencedRates > 0 || referencedDriverRates > 0) {
      const totalReferences = referencedRates + referencedDriverRates;
      throw new AppError(
        `Cannot delete service code: it is referenced by ${totalReferences} rate(s)`,
        HttpStatusCodes.CONFLICT
      );
    }

    await ServiceCode.findByIdAndDelete(codeId);

    return {
      success: true,
      message: "Service code deleted successfully",
    };
  }

  // ==================== ANCILLARIES ====================

  static async getAllAncillaries(user, query = {}) {
    const filter = {};

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    // Optional: Filter by isActive if provided
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive === "true" || query.isActive === true;
    }

    const ancillaries = await Ancillary.find(filter)
      .sort({ sortOrder: 1, code: 1 }) // Sort by sortOrder first, then by code
      .lean();

    return ancillaries.map((ancillary) => ({
      id: ancillary._id.toString(),
      code: ancillary.code,
      name: ancillary.name,
      description: ancillary.description || null,
      category: ancillary.category || null,
      defaultUnit: ancillary.defaultUnit || null,
      isActive: ancillary.isActive !== undefined ? ancillary.isActive : true,
      sortOrder: ancillary.sortOrder || null,
      createdAt: ancillary.createdAt ? ancillary.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: ancillary.updatedAt ? ancillary.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  static async createAncillary(data, user) {
    const { code, name, description, category, defaultUnit, isActive, sortOrder } = data;

    // Validate required fields
    if (!code || !name) {
      throw new AppError(
        "code and name are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const trimmedCode = code.trim();
    const trimmedName = name.trim();

    if (!trimmedCode || !trimmedName) {
      throw new AppError(
        "code and name cannot be empty",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate code length (max 20 characters)
    if (trimmedCode.length > 20) {
      throw new AppError(
        "code must be 20 characters or less",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate category if provided
    const validCategories = ["TRAVEL", "WAITING", "SURCHARGE", "TOLL", "DEMURRAGE"];
    if (category && !validCategories.includes(category)) {
      throw new AppError(
        `category must be one of: ${validCategories.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate defaultUnit if provided
    const validUnits = ["HOUR", "OCCURRENCE", "KM", "EACH", "DAY"];
    if (defaultUnit && !validUnits.includes(defaultUnit)) {
      throw new AppError(
        `defaultUnit must be one of: ${validUnits.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check for duplicate code within organization
    const filter = {
      code: trimmedCode,
    };

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const existingAncillary = await Ancillary.findOne(filter);

    if (existingAncillary) {
      throw new AppError(
        "An ancillary with this code already exists",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create new ancillary
    const newAncillary = await Ancillary.create({
      code: trimmedCode,
      name: trimmedName,
      description: description ? description.trim() : null,
      category: category || null,
      defaultUnit: defaultUnit || null,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder !== undefined ? sortOrder : null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: newAncillary._id.toString(),
      code: newAncillary.code,
      name: newAncillary.name,
      description: newAncillary.description || null,
      category: newAncillary.category || null,
      defaultUnit: newAncillary.defaultUnit || null,
      isActive: newAncillary.isActive,
      sortOrder: newAncillary.sortOrder || null,
      createdAt: newAncillary.createdAt.toISOString(),
      updatedAt: newAncillary.updatedAt.toISOString(),
    };
  }

  static async updateAncillary(ancillaryId, data, user) {
    const ancillary = await Ancillary.findById(ancillaryId);
    if (!ancillary) {
      throw new AppError("Ancillary not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      ancillary.organizationId &&
      ancillary.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this ancillary",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // If code is being changed, check for duplicates and validate length
    if (data.code && data.code.trim() !== ancillary.code) {
      const trimmedCode = data.code.trim();

      if (trimmedCode.length > 20) {
        throw new AppError(
          "code must be 20 characters or less",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      const filter = {
        code: trimmedCode,
      };

      // Multi-tenant: Filter by organization if not super admin
      if (!user.isSuperAdmin && user.activeOrganizationId) {
        filter.organizationId = user.activeOrganizationId;
      }

      const existingAncillary = await Ancillary.findOne({
        ...filter,
        _id: { $ne: ancillaryId },
      });

      if (existingAncillary) {
        throw new AppError(
          "An ancillary with this code already exists",
          HttpStatusCodes.CONFLICT
        );
      }
    }

    // Validate category if provided
    const validCategories = ["TRAVEL", "WAITING", "SURCHARGE", "TOLL", "DEMURRAGE"];
    if (data.category && !validCategories.includes(data.category)) {
      throw new AppError(
        `category must be one of: ${validCategories.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate defaultUnit if provided
    const validUnits = ["HOUR", "OCCURRENCE", "KM", "EACH", "DAY"];
    if (data.defaultUnit && !validUnits.includes(data.defaultUnit)) {
      throw new AppError(
        `defaultUnit must be one of: ${validUnits.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update only provided fields
    if (data.code !== undefined) ancillary.code = data.code.trim();
    if (data.name !== undefined) ancillary.name = data.name.trim();
    if (data.description !== undefined)
      ancillary.description = data.description ? data.description.trim() : null;
    if (data.category !== undefined) ancillary.category = data.category || null;
    if (data.defaultUnit !== undefined) ancillary.defaultUnit = data.defaultUnit || null;
    if (data.isActive !== undefined) ancillary.isActive = data.isActive;
    if (data.sortOrder !== undefined) ancillary.sortOrder = data.sortOrder;

    await ancillary.save();

    return {
      id: ancillary._id.toString(),
      code: ancillary.code,
      name: ancillary.name,
      description: ancillary.description || null,
      category: ancillary.category || null,
      defaultUnit: ancillary.defaultUnit || null,
      isActive: ancillary.isActive,
      sortOrder: ancillary.sortOrder || null,
      createdAt: ancillary.createdAt.toISOString(),
      updatedAt: ancillary.updatedAt.toISOString(),
    };
  }

  static async deleteAncillary(ancillaryId, user) {
    const ancillary = await Ancillary.findById(ancillaryId);
    if (!ancillary) {
      throw new AppError("Ancillary not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      ancillary.organizationId &&
      ancillary.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this ancillary",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Optional: Check if ancillary is referenced by jobs or rate cards
    // Note: This depends on your job/rate card structure
    // For now, we'll skip this check, but you can add it if needed:
    // const Job = require("../models/job.model");
    // const referencedJobs = await Job.countDocuments({
    //   "ancillaryCharges.code": ancillary.code,
    // });
    // if (referencedJobs > 0) {
    //   throw new AppError(
    //     `Cannot delete ancillary: it is referenced by ${referencedJobs} job(s)`,
    //     HttpStatusCodes.CONFLICT
    //   );
    // }

    await Ancillary.findByIdAndDelete(ancillaryId);

    return {
      success: true,
      message: "Ancillary deleted successfully",
    };
  }

  // ==================== DOCUMENT TEMPLATES ====================

  static async getAllDocumentTemplates() {
    const templates = await DocumentTemplate.find()
      .sort({ category: 1, title: 1 })
      .lean();

    return templates.map((template) => ({
      id: template._id.toString(),
      documentKey: template.documentKey,
      title: template.title,
      category: template.category,
      content: template.content,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));
  }

  static async createDocumentTemplate(data) {
    const template = await DocumentTemplate.create(data);

    return {
      success: true,
      message: "Document template created successfully",
      template: template.toObject(),
    };
  }

  static async updateDocumentTemplate(templateId, data) {
    const template = await DocumentTemplate.findById(templateId);
    if (!template) {
      throw new AppError("Document template not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Don't allow changing documentKey
    delete data.documentKey;

    Object.assign(template, data);
    await template.save();

    return {
      success: true,
      message: "Document template updated successfully",
      template: template.toObject(),
    };
  }

  static async deleteDocumentTemplate(templateId) {
    const template = await DocumentTemplate.findById(templateId);
    if (!template) {
      throw new AppError("Document template not found.", HttpStatusCodes.NOT_FOUND);
    }

    await DocumentTemplate.findByIdAndDelete(templateId);

    return {
      success: true,
      message: "Document template deleted successfully",
    };
  }

  // ==================== ZONES ====================

  static async getAllZones() {
    const zones = await Zone.find().sort({ zoneName: 1, suburb: 1 }).lean();

    return zones.map((zone) => ({
      id: zone._id.toString(),
      zoneName: zone.zoneName,
      suburb: zone.suburb,
      state: zone.state,
      postcode: zone.postcode,
      createdAt: zone.createdAt,
    }));
  }

  static async createZone(data) {
    const zone = await Zone.create(data);

    return {
      success: true,
      message: "Zone created successfully",
      zone: zone.toObject(),
    };
  }

  static async updateZone(zoneId, data) {
    const zone = await Zone.findById(zoneId);
    if (!zone) {
      throw new AppError("Zone not found.", HttpStatusCodes.NOT_FOUND);
    }

    Object.assign(zone, data);
    await zone.save();

    return {
      success: true,
      message: "Zone updated successfully",
      zone: zone.toObject(),
    };
  }

  static async deleteZone(zoneId) {
    const zone = await Zone.findById(zoneId);
    if (!zone) {
      throw new AppError("Zone not found.", HttpStatusCodes.NOT_FOUND);
    }

    await Zone.findByIdAndDelete(zoneId);

    return {
      success: true,
      message: "Zone deleted successfully",
    };
  }

  // ==================== VEHICLE TYPES ====================

  /**
   * Get all active vehicle types
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of vehicle type objects
   */
  static async getAllVehicleTypes(user) {
    // Build query filter
    // For backward compatibility: include records where isActive doesn't exist OR isActive is true
    // Only exclude records where isActive is explicitly false
    const filter = {
      $or: [
        { isActive: { $exists: false } }, // Include records without isActive field (backward compatibility)
        { isActive: true }, // Include active records
      ],
    };

    // Multi-tenant support - filter by organizationId if user has one
    if (user && user.activeOrganizationId) {
      // If user has organization, return vehicle types for that organization OR without organization (global)
      // Combine with $and to ensure both conditions are met
      filter.$and = [
        {
          $or: [
            { organizationId: user.activeOrganizationId },
            { organizationId: null },
            { organizationId: { $exists: false } }, // Backward compatibility
          ],
        },
      ];
    } else if (user) {
      // If user has no active organization, only return vehicle types without organization (global)
      filter.$and = [
        {
          $or: [
            { organizationId: null },
            { organizationId: { $exists: false } }, // Backward compatibility
          ],
        },
      ];
    }

    // Debug: Log the filter to help diagnose issues
    console.log("🔍 Vehicle Types Query Filter:", JSON.stringify(filter, null, 2));

    // Fetch vehicle types, sorted by sortOrder then by code
    const types = await VehicleType.find(filter)
      .sort({ sortOrder: 1, code: 1 })
      .lean();

    console.log(`✅ Found ${types.length} vehicle types`);

    return types.map((type) => ({
      id: type._id.toString(),
      code: type.code,
      fullName: type.fullName,
      sortOrder: type.sortOrder || 0,
    }));
  }

  // ==================== PERMANENT ASSIGNMENTS ====================

  /**
   * Get all permanent assignments for a board type
   * @param {Object} query - Query parameters (boardType)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of permanent assignment objects
   */
  static async getAllPermanentAssignments(query, user) {
    const PermanentAssignment = require("../models/permanentAssignment.model");

    // Validate boardType
    if (!query.boardType) {
      throw new AppError("boardType is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!["PUD", "LINEHAUL"].includes(query.boardType)) {
      throw new AppError(
        "boardType must be 'PUD' or 'LINEHAUL'",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build filter
    const filter = {
      boardType: query.boardType,
      isActive: true, // Only return active assignments
    };

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Fetch permanent assignments, sorted by displayOrder then createdAt
    const assignments = await PermanentAssignment.find(filter)
      .populate("driverId", "partyId driverCode")
      .populate({
        path: "driverId",
        populate: {
          path: "party",
          select: "firstName lastName companyName code",
        },
      })
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

    return assignments.map((assignment) => ({
      id: assignment._id.toString(),
      driverId: assignment.driverId ? assignment.driverId._id.toString() : null,
      boardType: assignment.boardType,
      routeCode: assignment.routeCode,
      routeDescription: assignment.routeDescription,
      defaultVehicleType: assignment.defaultVehicleType,
      dayOfWeek: assignment.dayOfWeek,
      defaultPickupTime: assignment.defaultPickupTime,
      defaultDropTime: assignment.defaultDropTime,
      startLocation: assignment.startLocation,
      endLocation: assignment.endLocation,
      notes: assignment.notes,
      isActive: assignment.isActive,
      displayOrder: assignment.displayOrder,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new permanent assignment
   * @param {Object} data - Permanent assignment data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created permanent assignment
   */
  static async createPermanentAssignment(data, user) {
    const PermanentAssignment = require("../models/permanentAssignment.model");
    const Driver = require("../models/driver.model");
    const VehicleType = require("../models/vehicleType.model");

    const errors = [];

    // Validation
    if (!data.driverId) {
      errors.push({ field: "driverId", message: "Driver ID is required" });
    }

    if (!data.boardType) {
      errors.push({ field: "boardType", message: "Board type is required" });
    } else if (!["PUD", "LINEHAUL"].includes(data.boardType)) {
      errors.push({
        field: "boardType",
        message: "Board type must be 'PUD' or 'LINEHAUL'",
      });
    }

    if (data.routeCode && data.routeCode.length > 100) {
      errors.push({
        field: "routeCode",
        message: "Route code must be 100 characters or less",
      });
    }

    if (data.routeDescription && data.routeDescription.length > 500) {
      errors.push({
        field: "routeDescription",
        message: "Route description must be 500 characters or less",
      });
    }

    if (data.startLocation && data.startLocation.length > 200) {
      errors.push({
        field: "startLocation",
        message: "Start location must be 200 characters or less",
      });
    }

    if (data.endLocation && data.endLocation.length > 200) {
      errors.push({
        field: "endLocation",
        message: "End location must be 200 characters or less",
      });
    }

    if (data.notes && data.notes.length > 1000) {
      errors.push({
        field: "notes",
        message: "Notes must be 1000 characters or less",
      });
    }

    // Validate dayOfWeek (0-6 or null)
    if (data.dayOfWeek !== undefined && data.dayOfWeek !== null) {
      const dayOfWeek = parseInt(data.dayOfWeek);
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        errors.push({
          field: "dayOfWeek",
          message: "Day of week must be 0-6 (0=Sunday, 6=Saturday) or null",
        });
      }
    }

    // Validate time format (HH:mm)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (data.defaultPickupTime && !timeRegex.test(data.defaultPickupTime)) {
      errors.push({
        field: "defaultPickupTime",
        message: "Default pickup time must be in HH:mm format (24-hour)",
      });
    }

    if (data.defaultDropTime && !timeRegex.test(data.defaultDropTime)) {
      errors.push({
        field: "defaultDropTime",
        message: "Default drop time must be in HH:mm format (24-hour)",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate driver exists
    if (data.driverId) {
      if (!mongoose.Types.ObjectId.isValid(data.driverId)) {
        throw new AppError("Invalid driver ID", HttpStatusCodes.BAD_REQUEST);
      }

      // Note: Driver model doesn't have organizationId field directly
      // Multi-tenancy can be handled through user relationship if needed
      const driver = await Driver.findOne({
        _id: new mongoose.Types.ObjectId(data.driverId),
      });

      if (!driver) {
        throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate vehicle type if provided
    if (data.defaultVehicleType) {
      const vehicleType = await VehicleType.findOne({
        code: data.defaultVehicleType.toUpperCase(),
        isActive: true,
      });

      if (!vehicleType) {
        errors.push({
          field: "defaultVehicleType",
          message: "Vehicle type not found or inactive",
        });
        const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
        error.errors = errors;
        throw error;
      }
    }

    // Create permanent assignment
    const assignment = await PermanentAssignment.create({
      driverId: new mongoose.Types.ObjectId(data.driverId),
      boardType: data.boardType,
      routeCode: data.routeCode ? data.routeCode.trim() : null,
      routeDescription: data.routeDescription ? data.routeDescription.trim() : null,
      defaultVehicleType: data.defaultVehicleType ? data.defaultVehicleType.trim() : null,
      dayOfWeek: data.dayOfWeek !== undefined && data.dayOfWeek !== null ? parseInt(data.dayOfWeek) : null,
      defaultPickupTime: data.defaultPickupTime ? data.defaultPickupTime.trim() : null,
      defaultDropTime: data.defaultDropTime ? data.defaultDropTime.trim() : null,
      startLocation: data.startLocation ? data.startLocation.trim() : null,
      endLocation: data.endLocation ? data.endLocation.trim() : null,
      notes: data.notes ? data.notes.trim() : null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      displayOrder: data.displayOrder !== undefined ? parseInt(data.displayOrder) : 0,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: assignment._id.toString(),
      driverId: assignment.driverId.toString(),
      boardType: assignment.boardType,
      routeCode: assignment.routeCode,
      routeDescription: assignment.routeDescription,
      defaultVehicleType: assignment.defaultVehicleType,
      dayOfWeek: assignment.dayOfWeek,
      defaultPickupTime: assignment.defaultPickupTime,
      defaultDropTime: assignment.defaultDropTime,
      startLocation: assignment.startLocation,
      endLocation: assignment.endLocation,
      notes: assignment.notes,
      isActive: assignment.isActive,
      displayOrder: assignment.displayOrder,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    };
  }

  /**
   * Update a permanent assignment
   * @param {string} assignmentId - Permanent assignment ID
   * @param {Object} data - Update data
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated permanent assignment
   */
  static async updatePermanentAssignment(assignmentId, data, user) {
    const PermanentAssignment = require("../models/permanentAssignment.model");
    const Driver = require("../models/driver.model");
    const VehicleType = require("../models/vehicleType.model");

    const errors = [];

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      throw new AppError("Invalid permanent assignment ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find assignment
    const assignment = await PermanentAssignment.findOne({
      _id: new mongoose.Types.ObjectId(assignmentId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!assignment) {
      throw new AppError("Permanent assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate boardType if provided
    if (data.boardType && !["PUD", "LINEHAUL"].includes(data.boardType)) {
      errors.push({
        field: "boardType",
        message: "Board type must be 'PUD' or 'LINEHAUL'",
      });
    }

    // Validate string lengths
    if (data.routeCode !== undefined && data.routeCode && data.routeCode.length > 100) {
      errors.push({
        field: "routeCode",
        message: "Route code must be 100 characters or less",
      });
    }

    if (data.routeDescription !== undefined && data.routeDescription && data.routeDescription.length > 500) {
      errors.push({
        field: "routeDescription",
        message: "Route description must be 500 characters or less",
      });
    }

    if (data.startLocation !== undefined && data.startLocation && data.startLocation.length > 200) {
      errors.push({
        field: "startLocation",
        message: "Start location must be 200 characters or less",
      });
    }

    if (data.endLocation !== undefined && data.endLocation && data.endLocation.length > 200) {
      errors.push({
        field: "endLocation",
        message: "End location must be 200 characters or less",
      });
    }

    if (data.notes !== undefined && data.notes && data.notes.length > 1000) {
      errors.push({
        field: "notes",
        message: "Notes must be 1000 characters or less",
      });
    }

    // Validate dayOfWeek
    if (data.dayOfWeek !== undefined && data.dayOfWeek !== null) {
      const dayOfWeek = parseInt(data.dayOfWeek);
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        errors.push({
          field: "dayOfWeek",
          message: "Day of week must be 0-6 (0=Sunday, 6=Saturday) or null",
        });
      }
    }

    // Validate time format
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (data.defaultPickupTime !== undefined && data.defaultPickupTime && !timeRegex.test(data.defaultPickupTime)) {
      errors.push({
        field: "defaultPickupTime",
        message: "Default pickup time must be in HH:mm format (24-hour)",
      });
    }

    if (data.defaultDropTime !== undefined && data.defaultDropTime && !timeRegex.test(data.defaultDropTime)) {
      errors.push({
        field: "defaultDropTime",
        message: "Default drop time must be in HH:mm format (24-hour)",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate driver if driverId is being updated
    if (data.driverId) {
      if (!mongoose.Types.ObjectId.isValid(data.driverId)) {
        throw new AppError("Invalid driver ID", HttpStatusCodes.BAD_REQUEST);
      }

      const driver = await Driver.findOne({
        _id: new mongoose.Types.ObjectId(data.driverId),
        organizationId: user.activeOrganizationId || null,
      });

      if (!driver) {
        throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate vehicle type if provided
    if (data.defaultVehicleType) {
      const vehicleType = await VehicleType.findOne({
        code: data.defaultVehicleType.toUpperCase(),
        isActive: true,
      });

      if (!vehicleType) {
        errors.push({
          field: "defaultVehicleType",
          message: "Vehicle type not found or inactive",
        });
        const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
        error.errors = errors;
        throw error;
      }
    }

    // Update only provided fields
    if (data.driverId !== undefined) {
      assignment.driverId = new mongoose.Types.ObjectId(data.driverId);
    }
    if (data.boardType !== undefined) {
      assignment.boardType = data.boardType;
    }
    if (data.routeCode !== undefined) {
      assignment.routeCode = data.routeCode ? data.routeCode.trim() : null;
    }
    if (data.routeDescription !== undefined) {
      assignment.routeDescription = data.routeDescription ? data.routeDescription.trim() : null;
    }
    if (data.defaultVehicleType !== undefined) {
      assignment.defaultVehicleType = data.defaultVehicleType ? data.defaultVehicleType.trim() : null;
    }
    if (data.dayOfWeek !== undefined) {
      assignment.dayOfWeek = data.dayOfWeek !== null ? parseInt(data.dayOfWeek) : null;
    }
    if (data.defaultPickupTime !== undefined) {
      assignment.defaultPickupTime = data.defaultPickupTime ? data.defaultPickupTime.trim() : null;
    }
    if (data.defaultDropTime !== undefined) {
      assignment.defaultDropTime = data.defaultDropTime ? data.defaultDropTime.trim() : null;
    }
    if (data.startLocation !== undefined) {
      assignment.startLocation = data.startLocation ? data.startLocation.trim() : null;
    }
    if (data.endLocation !== undefined) {
      assignment.endLocation = data.endLocation ? data.endLocation.trim() : null;
    }
    if (data.notes !== undefined) {
      assignment.notes = data.notes ? data.notes.trim() : null;
    }
    if (data.isActive !== undefined) {
      assignment.isActive = data.isActive;
    }
    if (data.displayOrder !== undefined) {
      assignment.displayOrder = parseInt(data.displayOrder);
    }

    await assignment.save();

    return {
      id: assignment._id.toString(),
      driverId: assignment.driverId.toString(),
      boardType: assignment.boardType,
      routeCode: assignment.routeCode,
      routeDescription: assignment.routeDescription,
      defaultVehicleType: assignment.defaultVehicleType,
      dayOfWeek: assignment.dayOfWeek,
      defaultPickupTime: assignment.defaultPickupTime,
      defaultDropTime: assignment.defaultDropTime,
      startLocation: assignment.startLocation,
      endLocation: assignment.endLocation,
      notes: assignment.notes,
      isActive: assignment.isActive,
      displayOrder: assignment.displayOrder,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    };
  }

  /**
   * Delete a permanent assignment (soft delete)
   * @param {string} assignmentId - Permanent assignment ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async deletePermanentAssignment(assignmentId, user) {
    const PermanentAssignment = require("../models/permanentAssignment.model");

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      throw new AppError("Invalid permanent assignment ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find assignment
    const assignment = await PermanentAssignment.findOne({
      _id: new mongoose.Types.ObjectId(assignmentId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!assignment) {
      throw new AppError("Permanent assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Soft delete (set isActive to false)
    assignment.isActive = false;
    await assignment.save();

    return {
      success: true,
      message: "Permanent assignment deleted successfully",
    };
  }

  // ==================== PERMANENT JOBS ====================

  /**
   * Get all permanent jobs for a board type
   * @param {Object} query - Query parameters (boardType)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of permanent job objects
   */
  static async getAllPermanentJobs(query, user) {
    const PermanentJob = require("../models/permanentJob.model");

    // Validate boardType
    if (!query.boardType) {
      throw new AppError("boardType is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!["PUD", "LINEHAUL"].includes(query.boardType)) {
      throw new AppError(
        "boardType must be 'PUD' or 'LINEHAUL'",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build filter
    const filter = {
      boardType: query.boardType,
      isActive: true, // Only return active jobs
    };

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Fetch permanent jobs, sorted by displayOrder then createdAt
    const jobs = await PermanentJob.find(filter)
      .populate("customerId", "partyId customerCode")
      .populate({
        path: "customerId",
        populate: {
          path: "party",
          select: "companyName firstName lastName code",
        },
      })
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

    return jobs.map((job) => ({
      id: job._id.toString(),
      customerId: job.customerId ? job.customerId._id.toString() : null,
      boardType: job.boardType,
      serviceCode: job.serviceCode,
      pickupSuburb: job.pickupSuburb,
      deliverySuburb: job.deliverySuburb,
      defaultVehicleType: job.defaultVehicleType,
      routeDescription: job.routeDescription,
      dayOfWeek: job.dayOfWeek,
      defaultPickupTime: job.defaultPickupTime,
      defaultDropTime: job.defaultDropTime,
      notes: job.notes,
      isActive: job.isActive,
      displayOrder: job.displayOrder,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new permanent job
   * @param {Object} data - Permanent job data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created permanent job
   */
  static async createPermanentJob(data, user) {
    const PermanentJob = require("../models/permanentJob.model");
    const Customer = require("../models/customer.model");
    const ServiceCode = require("../models/serviceCode.model");
    const VehicleType = require("../models/vehicleType.model");

    const errors = [];

    // Validation
    if (!data.customerId) {
      errors.push({ field: "customerId", message: "Customer ID is required" });
    }

    if (!data.boardType) {
      errors.push({ field: "boardType", message: "Board type is required" });
    } else if (!["PUD", "LINEHAUL"].includes(data.boardType)) {
      errors.push({
        field: "boardType",
        message: "Board type must be 'PUD' or 'LINEHAUL'",
      });
    }

    if (data.pickupSuburb && data.pickupSuburb.length > 200) {
      errors.push({
        field: "pickupSuburb",
        message: "Pickup suburb must be 200 characters or less",
      });
    }

    if (data.deliverySuburb && data.deliverySuburb.length > 200) {
      errors.push({
        field: "deliverySuburb",
        message: "Delivery suburb must be 200 characters or less",
      });
    }

    if (data.routeDescription && data.routeDescription.length > 500) {
      errors.push({
        field: "routeDescription",
        message: "Route description must be 500 characters or less",
      });
    }

    if (data.notes && data.notes.length > 1000) {
      errors.push({
        field: "notes",
        message: "Notes must be 1000 characters or less",
      });
    }

    // Validate dayOfWeek (0-6 or null)
    if (data.dayOfWeek !== undefined && data.dayOfWeek !== null) {
      const dayOfWeek = parseInt(data.dayOfWeek);
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        errors.push({
          field: "dayOfWeek",
          message: "Day of week must be 0-6 (0=Sunday, 6=Saturday) or null",
        });
      }
    }

    // Validate time format (HH:mm)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (data.defaultPickupTime && !timeRegex.test(data.defaultPickupTime)) {
      errors.push({
        field: "defaultPickupTime",
        message: "Default pickup time must be in HH:mm format (24-hour)",
      });
    }

    if (data.defaultDropTime && !timeRegex.test(data.defaultDropTime)) {
      errors.push({
        field: "defaultDropTime",
        message: "Default drop time must be in HH:mm format (24-hour)",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate customer exists
    if (data.customerId) {
      if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }

      const customer = await Customer.findOne({
        _id: new mongoose.Types.ObjectId(data.customerId),
        organizationId: user.activeOrganizationId || null,
      });

      if (!customer) {
        throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate service code if provided (not null/empty/undefined)
    // If serviceCode is provided, verify it exists and is active
    // If serviceCode is null/empty/undefined, skip validation (it's optional)
    if (data.serviceCode !== undefined && data.serviceCode !== null && data.serviceCode !== "") {
      // Ensure serviceCode is a string before trimming
      if (typeof data.serviceCode === "string") {
        const trimmedServiceCode = data.serviceCode.trim();
        if (trimmedServiceCode) {
          // Build filter for service code lookup
          const serviceCodeFilter = {
            code: trimmedServiceCode, // Case-sensitive match
            isActive: true,
          };

          // Filter by organizationId if user has one (service codes are organization-specific)
          if (user.activeOrganizationId) {
            serviceCodeFilter.organizationId = user.activeOrganizationId;
          } else {
            serviceCodeFilter.organizationId = null;
          }

          const serviceCode = await ServiceCode.findOne(serviceCodeFilter);

          if (!serviceCode) {
            errors.push({
              field: "serviceCode",
              message: "Service code not found or inactive",
            });
          }
        }
      } else {
        errors.push({
          field: "serviceCode",
          message: "Service code must be a string",
        });
      }
    }

    // Validate vehicle type if provided
    if (data.defaultVehicleType) {
      const vehicleType = await VehicleType.findOne({
        code: data.defaultVehicleType.toUpperCase(),
        isActive: true,
      });

      if (!vehicleType) {
        errors.push({
          field: "defaultVehicleType",
          message: "Vehicle type not found or inactive",
        });
      }
    }

    // Check all errors and throw if any exist (after all async validations)
    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Create permanent job
    const job = await PermanentJob.create({
      customerId: new mongoose.Types.ObjectId(data.customerId),
      boardType: data.boardType,
      serviceCode: data.serviceCode ? data.serviceCode.trim() : null,
      pickupSuburb: data.pickupSuburb ? data.pickupSuburb.trim() : null,
      deliverySuburb: data.deliverySuburb ? data.deliverySuburb.trim() : null,
      defaultVehicleType: data.defaultVehicleType ? data.defaultVehicleType.trim() : null,
      routeDescription: data.routeDescription ? data.routeDescription.trim() : null,
      dayOfWeek: data.dayOfWeek !== undefined && data.dayOfWeek !== null ? parseInt(data.dayOfWeek) : null,
      defaultPickupTime: data.defaultPickupTime ? data.defaultPickupTime.trim() : null,
      defaultDropTime: data.defaultDropTime ? data.defaultDropTime.trim() : null,
      notes: data.notes ? data.notes.trim() : null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      displayOrder: data.displayOrder !== undefined ? parseInt(data.displayOrder) : 0,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: job._id.toString(),
      customerId: job.customerId.toString(),
      boardType: job.boardType,
      serviceCode: job.serviceCode,
      pickupSuburb: job.pickupSuburb,
      deliverySuburb: job.deliverySuburb,
      defaultVehicleType: job.defaultVehicleType,
      routeDescription: job.routeDescription,
      dayOfWeek: job.dayOfWeek,
      defaultPickupTime: job.defaultPickupTime,
      defaultDropTime: job.defaultDropTime,
      notes: job.notes,
      isActive: job.isActive,
      displayOrder: job.displayOrder,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /**
   * Update a permanent job
   * @param {string} jobId - Permanent job ID
   * @param {Object} data - Update data
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated permanent job
   */
  static async updatePermanentJob(jobId, data, user) {
    const PermanentJob = require("../models/permanentJob.model");
    const Customer = require("../models/customer.model");
    const ServiceCode = require("../models/serviceCode.model");
    const VehicleType = require("../models/vehicleType.model");

    const errors = [];

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new AppError("Invalid permanent job ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find job
    const job = await PermanentJob.findOne({
      _id: new mongoose.Types.ObjectId(jobId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!job) {
      throw new AppError("Permanent job not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate boardType if provided
    if (data.boardType && !["PUD", "LINEHAUL"].includes(data.boardType)) {
      errors.push({
        field: "boardType",
        message: "Board type must be 'PUD' or 'LINEHAUL'",
      });
    }

    // Validate string lengths
    if (data.pickupSuburb !== undefined && data.pickupSuburb && data.pickupSuburb.length > 200) {
      errors.push({
        field: "pickupSuburb",
        message: "Pickup suburb must be 200 characters or less",
      });
    }

    if (data.deliverySuburb !== undefined && data.deliverySuburb && data.deliverySuburb.length > 200) {
      errors.push({
        field: "deliverySuburb",
        message: "Delivery suburb must be 200 characters or less",
      });
    }

    if (data.routeDescription !== undefined && data.routeDescription && data.routeDescription.length > 500) {
      errors.push({
        field: "routeDescription",
        message: "Route description must be 500 characters or less",
      });
    }

    if (data.notes !== undefined && data.notes && data.notes.length > 1000) {
      errors.push({
        field: "notes",
        message: "Notes must be 1000 characters or less",
      });
    }

    // Validate dayOfWeek
    if (data.dayOfWeek !== undefined && data.dayOfWeek !== null) {
      const dayOfWeek = parseInt(data.dayOfWeek);
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        errors.push({
          field: "dayOfWeek",
          message: "Day of week must be 0-6 (0=Sunday, 6=Saturday) or null",
        });
      }
    }

    // Validate time format
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (data.defaultPickupTime !== undefined && data.defaultPickupTime && !timeRegex.test(data.defaultPickupTime)) {
      errors.push({
        field: "defaultPickupTime",
        message: "Default pickup time must be in HH:mm format (24-hour)",
      });
    }

    if (data.defaultDropTime !== undefined && data.defaultDropTime && !timeRegex.test(data.defaultDropTime)) {
      errors.push({
        field: "defaultDropTime",
        message: "Default drop time must be in HH:mm format (24-hour)",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate customer if customerId is being updated
    if (data.customerId) {
      if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }

      const customer = await Customer.findOne({
        _id: new mongoose.Types.ObjectId(data.customerId),
        organizationId: user.activeOrganizationId || null,
      });

      if (!customer) {
        throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate service code if provided (not null/empty/undefined)
    // If serviceCode is provided, verify it exists and is active
    // If serviceCode is null/empty/undefined, skip validation (it's optional)
    if (data.serviceCode !== undefined && data.serviceCode !== null && data.serviceCode !== "") {
      // Ensure serviceCode is a string before trimming
      if (typeof data.serviceCode === "string") {
        const trimmedServiceCode = data.serviceCode.trim();
        if (trimmedServiceCode) {
          // Build filter for service code lookup
          const serviceCodeFilter = {
            code: trimmedServiceCode, // Case-sensitive match
            isActive: true,
          };

          // Filter by organizationId if user has one (service codes are organization-specific)
          if (user.activeOrganizationId) {
            serviceCodeFilter.organizationId = user.activeOrganizationId;
          } else {
            serviceCodeFilter.organizationId = null;
          }

          const serviceCode = await ServiceCode.findOne(serviceCodeFilter);

          if (!serviceCode) {
            errors.push({
              field: "serviceCode",
              message: "Service code not found or inactive",
            });
          }
        }
      } else {
        errors.push({
          field: "serviceCode",
          message: "Service code must be a string",
        });
      }
    }

    // Validate vehicle type if provided
    if (data.defaultVehicleType) {
      const vehicleType = await VehicleType.findOne({
        code: data.defaultVehicleType.toUpperCase(),
        isActive: true,
      });

      if (!vehicleType) {
        errors.push({
          field: "defaultVehicleType",
          message: "Vehicle type not found or inactive",
        });
        const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
        error.errors = errors;
        throw error;
      }
    }

    // Update only provided fields
    if (data.customerId !== undefined) {
      job.customerId = new mongoose.Types.ObjectId(data.customerId);
    }
    if (data.boardType !== undefined) {
      job.boardType = data.boardType;
    }
    if (data.serviceCode !== undefined) {
      job.serviceCode = data.serviceCode ? data.serviceCode.trim() : null;
    }
    if (data.pickupSuburb !== undefined) {
      job.pickupSuburb = data.pickupSuburb ? data.pickupSuburb.trim() : null;
    }
    if (data.deliverySuburb !== undefined) {
      job.deliverySuburb = data.deliverySuburb ? data.deliverySuburb.trim() : null;
    }
    if (data.defaultVehicleType !== undefined) {
      job.defaultVehicleType = data.defaultVehicleType ? data.defaultVehicleType.trim() : null;
    }
    if (data.routeDescription !== undefined) {
      job.routeDescription = data.routeDescription ? data.routeDescription.trim() : null;
    }
    if (data.dayOfWeek !== undefined) {
      job.dayOfWeek = data.dayOfWeek !== null ? parseInt(data.dayOfWeek) : null;
    }
    if (data.defaultPickupTime !== undefined) {
      job.defaultPickupTime = data.defaultPickupTime ? data.defaultPickupTime.trim() : null;
    }
    if (data.defaultDropTime !== undefined) {
      job.defaultDropTime = data.defaultDropTime ? data.defaultDropTime.trim() : null;
    }
    if (data.notes !== undefined) {
      job.notes = data.notes ? data.notes.trim() : null;
    }
    if (data.isActive !== undefined) {
      job.isActive = data.isActive;
    }
    if (data.displayOrder !== undefined) {
      job.displayOrder = parseInt(data.displayOrder);
    }

    await job.save();

    return {
      id: job._id.toString(),
      customerId: job.customerId.toString(),
      boardType: job.boardType,
      serviceCode: job.serviceCode,
      pickupSuburb: job.pickupSuburb,
      deliverySuburb: job.deliverySuburb,
      defaultVehicleType: job.defaultVehicleType,
      routeDescription: job.routeDescription,
      dayOfWeek: job.dayOfWeek,
      defaultPickupTime: job.defaultPickupTime,
      defaultDropTime: job.defaultDropTime,
      notes: job.notes,
      isActive: job.isActive,
      displayOrder: job.displayOrder,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /**
   * Delete a permanent job (soft delete)
   * @param {string} jobId - Permanent job ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async deletePermanentJob(jobId, user) {
    const PermanentJob = require("../models/permanentJob.model");

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new AppError("Invalid permanent job ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find job
    const job = await PermanentJob.findOne({
      _id: new mongoose.Types.ObjectId(jobId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!job) {
      throw new AppError("Permanent job not found", HttpStatusCodes.NOT_FOUND);
    }

    // Soft delete (set isActive to false)
    job.isActive = false;
    await job.save();

    return {
      success: true,
      message: "Permanent job deleted successfully",
    };
  }

  // ==================== VEHICLES ====================

  /**
   * Get all vehicles with optional filtering
   * @param {Object} query - Query parameters (status, search, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Vehicles list with pagination
   */
  static async getAllVehicles(query, user) {
    const Vehicle = require("../models/vehicle.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null; // Only show vehicles without organization
    }

    // Status filter
    if (query.status) {
      filter.status = query.status;
    }

    // Search filter (fleetNo, registration, make, model)
    if (query.search) {
      filter.$or = [
        { fleetNo: { $regex: query.search, $options: "i" } },
        { registration: { $regex: query.search, $options: "i" } },
        { make: { $regex: query.search, $options: "i" } },
        { model: { $regex: query.search, $options: "i" } },
        { vin: { $regex: query.search, $options: "i" } },
      ];
    }

    // Ownership filter
    if (query.ownership) {
      filter.ownership = query.ownership;
    }

    const totalVehicles = await Vehicle.countDocuments(filter);
    const totalPages = Math.ceil(totalVehicles / limit);

    const vehicles = await Vehicle.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedVehicles = vehicles.map((vehicle) => ({
      id: vehicle._id.toString(),
      fleetNo: vehicle.fleetNo,
      registration: vehicle.registration,
      vin: vehicle.vin,
      state: vehicle.state,
      regoExpiry: vehicle.regoExpiry ? vehicle.regoExpiry.toISOString() : null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      gvm: vehicle.gvm,
      gcm: vehicle.gcm,
      axleConfig: vehicle.axleConfig,
      ownership: vehicle.ownership,
      status: vehicle.status,
      insurancePolicyNo: vehicle.insurancePolicyNo,
      insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.toISOString() : null,
      notes: vehicle.notes,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    }));

    return {
      data: formattedVehicles,
      pagination: {
        page,
        limit,
        total: totalVehicles,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Get vehicle by ID
   * @param {string} vehicleId - Vehicle ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Vehicle object
   */
  static async getVehicleById(vehicleId, user) {
    const Vehicle = require("../models/vehicle.model");

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Build filter
    const filter = {
      _id: new mongoose.Types.ObjectId(vehicleId),
    };

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    const vehicle = await Vehicle.findOne(filter).lean();

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    return {
      id: vehicle._id.toString(),
      fleetNo: vehicle.fleetNo,
      registration: vehicle.registration,
      vin: vehicle.vin,
      state: vehicle.state,
      regoExpiry: vehicle.regoExpiry ? vehicle.regoExpiry.toISOString() : null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      gvm: vehicle.gvm,
      gcm: vehicle.gcm,
      axleConfig: vehicle.axleConfig,
      ownership: vehicle.ownership,
      status: vehicle.status,
      insurancePolicyNo: vehicle.insurancePolicyNo,
      insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.toISOString() : null,
      notes: vehicle.notes,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    };
  }

  /**
   * Create a new vehicle
   * @param {Object} data - Vehicle data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created vehicle
   */
  static async createVehicle(data, user) {
    const Vehicle = require("../models/vehicle.model");

    // Validation errors array
    const errors = [];

    // Required field validation
    if (!data.fleetNo || !data.fleetNo.trim()) {
      errors.push({
        field: "fleetNo",
        message: "Fleet number is required",
      });
    } else if (data.fleetNo.length > 50) {
      errors.push({
        field: "fleetNo",
        message: "Fleet number must be 50 characters or less",
      });
    } else if (!/^[A-Za-z0-9_-]+$/.test(data.fleetNo)) {
      errors.push({
        field: "fleetNo",
        message: "Fleet number can only contain letters, numbers, hyphens, and underscores",
      });
    }

    if (!data.registration || !data.registration.trim()) {
      errors.push({
        field: "registration",
        message: "Registration is required",
      });
    } else if (data.registration.length > 20) {
      errors.push({
        field: "registration",
        message: "Registration must be 20 characters or less",
      });
    } else if (!/^[A-Za-z0-9]+$/.test(data.registration)) {
      errors.push({
        field: "registration",
        message: "Registration can only contain letters and numbers",
      });
    }

    if (!data.make || !data.make.trim()) {
      errors.push({
        field: "make",
        message: "Make is required",
      });
    } else if (data.make.length > 50) {
      errors.push({
        field: "make",
        message: "Make must be 50 characters or less",
      });
    }

    if (!data.model || !data.model.trim()) {
      errors.push({
        field: "model",
        message: "Model is required",
      });
    } else if (data.model.length > 50) {
      errors.push({
        field: "model",
        message: "Model must be 50 characters or less",
      });
    }

    // Optional field validation
    if (data.vin && data.vin.length > 17) {
      errors.push({
        field: "vin",
        message: "VIN must be 17 characters or less",
      });
    } else if (data.vin && !/^[A-Za-z0-9]+$/.test(data.vin)) {
      errors.push({
        field: "vin",
        message: "VIN can only contain letters and numbers",
      });
    }

    const validStates = [
      "Australian Capital Territory",
      "New South Wales",
      "Northern Territory",
      "Queensland",
      "South Australia",
      "Tasmania",
      "Victoria",
      "Western Australia",
    ];

    if (data.state && !validStates.includes(data.state)) {
      errors.push({
        field: "state",
        message: `State must be one of: ${validStates.join(", ")}`,
      });
    }

    if (data.year !== undefined && data.year !== null) {
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(data.year) || data.year < 1900 || data.year > currentYear + 1) {
        errors.push({
          field: "year",
          message: `Year must be between 1900 and ${currentYear + 1}`,
        });
      }
    }

    if (data.gvm !== undefined && data.gvm !== null) {
      const gvm = parseFloat(data.gvm);
      if (isNaN(gvm) || gvm < 0) {
        errors.push({
          field: "gvm",
          message: "GVM must be a positive number",
        });
      }
    }

    if (data.gcm !== undefined && data.gcm !== null) {
      const gcm = parseFloat(data.gcm);
      if (isNaN(gcm) || gcm < 0) {
        errors.push({
          field: "gcm",
          message: "GCM must be a positive number",
        });
      }
    }

    if (data.axleConfig && data.axleConfig.length > 20) {
      errors.push({
        field: "axleConfig",
        message: "Axle configuration must be 20 characters or less",
      });
    }

    const validOwnership = ["Owned", "Leased", "Subbie"];
    if (data.ownership && !validOwnership.includes(data.ownership)) {
      errors.push({
        field: "ownership",
        message: `Ownership must be one of: ${validOwnership.join(", ")}`,
      });
    }

    const validStatus = ["active", "inactive", "workshop", "hold"];
    if (data.status && !validStatus.includes(data.status)) {
      errors.push({
        field: "status",
        message: `Status must be one of: ${validStatus.join(", ")}`,
      });
    }

    if (data.insurancePolicyNo && data.insurancePolicyNo.length > 100) {
      errors.push({
        field: "insurancePolicyNo",
        message: "Insurance policy number must be 100 characters or less",
      });
    }

    if (data.notes && data.notes.length > 1000) {
      errors.push({
        field: "notes",
        message: "Notes must be 1000 characters or less",
      });
    }

    // Date validation
    let regoExpiryDate = null;
    if (data.regoExpiry) {
      regoExpiryDate = new Date(data.regoExpiry);
      if (isNaN(regoExpiryDate.getTime())) {
        errors.push({
          field: "regoExpiry",
          message: "Registration expiry must be a valid date (ISO 8601)",
        });
      }
    }

    let insuranceExpiryDate = null;
    if (data.insuranceExpiry) {
      insuranceExpiryDate = new Date(data.insuranceExpiry);
      if (isNaN(insuranceExpiryDate.getTime())) {
        errors.push({
          field: "insuranceExpiry",
          message: "Insurance expiry must be a valid date (ISO 8601)",
        });
      }
    }

    // If validation errors, throw error
    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Check for duplicates
    const existingFleetNo = await Vehicle.findOne({
      fleetNo: data.fleetNo.toUpperCase().trim(),
      organizationId: user.activeOrganizationId || null,
    });

    if (existingFleetNo) {
      throw new AppError(
        "A vehicle with this fleet number already exists.",
        HttpStatusCodes.CONFLICT
      );
    }

    const existingRegistration = await Vehicle.findOne({
      registration: data.registration.toUpperCase().trim(),
      organizationId: user.activeOrganizationId || null,
    });

    if (existingRegistration) {
      throw new AppError(
        "A vehicle with this registration already exists.",
        HttpStatusCodes.CONFLICT
      );
    }

    // Create vehicle
    try {
      const vehicle = await Vehicle.create({
        fleetNo: data.fleetNo.toUpperCase().trim(),
        registration: data.registration.toUpperCase().trim(),
        vin: data.vin ? data.vin.toUpperCase().trim() : null,
        state: data.state || null,
        regoExpiry: regoExpiryDate,
        make: data.make.trim(),
        model: data.model.trim(),
        year: data.year ? parseInt(data.year) : null,
        gvm: data.gvm ? parseFloat(data.gvm) : null,
        gcm: data.gcm ? parseFloat(data.gcm) : null,
        axleConfig: data.axleConfig ? data.axleConfig.trim() : null,
        ownership: data.ownership || "Owned",
        status: data.status || "active",
        insurancePolicyNo: data.insurancePolicyNo ? data.insurancePolicyNo.trim() : null,
        insuranceExpiry: insuranceExpiryDate,
        notes: data.notes ? data.notes.trim() : null,
        organizationId: user.activeOrganizationId || null,
      });

      return {
        id: vehicle._id.toString(),
        fleetNo: vehicle.fleetNo,
        registration: vehicle.registration,
        vin: vehicle.vin,
        state: vehicle.state,
        regoExpiry: vehicle.regoExpiry ? vehicle.regoExpiry.toISOString() : null,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        gvm: vehicle.gvm,
        gcm: vehicle.gcm,
        axleConfig: vehicle.axleConfig,
        ownership: vehicle.ownership,
        status: vehicle.status,
        insurancePolicyNo: vehicle.insurancePolicyNo,
        insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.toISOString() : null,
        notes: vehicle.notes,
        createdAt: vehicle.createdAt.toISOString(),
        updatedAt: vehicle.updatedAt.toISOString(),
      };
    } catch (error) {
      // Handle MongoDB duplicate key errors (code 11000)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        let message = "A vehicle with this information already exists.";
        if (field === "fleetNo") {
          message = "A vehicle with this fleet number already exists.";
        } else if (field === "registration") {
          message = "A vehicle with this registration already exists.";
        }
        throw new AppError(message, HttpStatusCodes.CONFLICT);
      }
      // Re-throw other errors
      throw error;
    }
  }

  // ==================== VEHICLE PROFILE ACTIONS ====================

  /**
   * Get all inspections for a vehicle
   * @param {Object} query - Query parameters (vehicleId, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Inspections list with pagination
   */
  static async getInspections(query, user) {
    const Inspection = require("../models/inspection.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Vehicle ID filter (required)
    if (!query.vehicleId) {
      throw new AppError("vehicleId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(query.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    filter.vehicleId = new mongoose.Types.ObjectId(query.vehicleId);

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Optional filters
    if (query.type) {
      filter.type = query.type;
    }

    if (query.result) {
      filter.result = query.result;
    }

    const totalInspections = await Inspection.countDocuments(filter);
    const totalPages = Math.ceil(totalInspections / limit);

    const inspections = await Inspection.find(filter)
      .populate("inspectedBy", "fullName name email")
      .sort({ inspectedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedInspections = inspections.map((inspection) => ({
      id: inspection._id.toString(),
      vehicleId: inspection.vehicleId.toString(),
      templateId: inspection.templateId ? inspection.templateId.toString() : null,
      inspectedAt: inspection.inspectedAt.toISOString(),
      inspectedBy: inspection.inspectedBy ? {
        id: inspection.inspectedBy._id.toString(),
        name: inspection.inspectedBy.fullName || inspection.inspectedBy.name,
        email: inspection.inspectedBy.email,
      } : {
        id: inspection.inspectedBy.toString(),
        name: inspection.inspectorName,
      },
      inspectorName: inspection.inspectorName,
      result: inspection.result,
      odometerKm: inspection.odometerKm,
      engineHours: inspection.engineHours,
      photos: inspection.photos,
      notes: inspection.notes,
      type: inspection.type,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
    }));

    return {
      data: formattedInspections,
      pagination: {
        page,
        limit,
        total: totalInspections,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Create a new inspection for a vehicle
   * @param {Object} data - Inspection data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created inspection
   */
  static async createInspection(data, user) {
    const Inspection = require("../models/inspection.model");
    const Vehicle = require("../models/vehicle.model");

    const errors = [];

    // Validation
    if (!data.vehicleId) {
      errors.push({ field: "vehicleId", message: "Vehicle ID is required" });
    }

    if (!data.type) {
      errors.push({ field: "type", message: "Type is required" });
    } else if (!["Prestart", "Quarterly", "Annual"].includes(data.type)) {
      errors.push({
        field: "type",
        message: "Type must be one of: Prestart, Quarterly, Annual",
      });
    }

    if (!data.result) {
      errors.push({ field: "result", message: "Result is required" });
    } else if (!["pass", "fail"].includes(data.result)) {
      errors.push({
        field: "result",
        message: "Result must be one of: pass, fail",
      });
    }

    if (!data.inspectedAt) {
      errors.push({ field: "inspectedAt", message: "Inspected at date is required" });
    } else {
      const inspectedAt = new Date(data.inspectedAt);
      if (isNaN(inspectedAt.getTime())) {
        errors.push({
          field: "inspectedAt",
          message: "Inspected at must be a valid date (ISO 8601)",
        });
      }
    }

    if (data.odometerKm !== undefined && data.odometerKm !== null) {
      const odometerKm = parseInt(data.odometerKm);
      if (isNaN(odometerKm) || odometerKm < 0) {
        errors.push({
          field: "odometerKm",
          message: "Odometer KM must be a positive integer",
        });
      }
    }

    if (data.engineHours !== undefined && data.engineHours !== null) {
      const engineHours = parseFloat(data.engineHours);
      if (isNaN(engineHours) || engineHours < 0) {
        errors.push({
          field: "engineHours",
          message: "Engine hours must be a positive number",
        });
      }
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(data.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(data.vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // Create inspection
    const inspection = await Inspection.create({
      vehicleId: data.vehicleId,
      templateId: data.templateId || null,
      inspectedAt: new Date(data.inspectedAt),
      inspectedBy: user.id,
      inspectorName: user.fullName || user.name || "Unknown",
      result: data.result,
      type: data.type,
      odometerKm: data.odometerKm ? parseInt(data.odometerKm) : null,
      engineHours: data.engineHours ? parseFloat(data.engineHours) : null,
      photos: data.photos || [],
      notes: data.notes || null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: inspection._id.toString(),
      vehicleId: inspection.vehicleId.toString(),
      templateId: inspection.templateId ? inspection.templateId.toString() : null,
      inspectedAt: inspection.inspectedAt.toISOString(),
      inspectedBy: inspection.inspectedBy.toString(),
      inspectorName: inspection.inspectorName,
      result: inspection.result,
      odometerKm: inspection.odometerKm,
      engineHours: inspection.engineHours,
      photos: inspection.photos,
      notes: inspection.notes,
      type: inspection.type,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
    };
  }

  /**
   * Get all defects for a vehicle
   * @param {Object} query - Query parameters (vehicleId, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Defects list with pagination
   */
  static async getDefects(query, user) {
    const Defect = require("../models/defect.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Vehicle ID filter (required)
    if (!query.vehicleId) {
      throw new AppError("vehicleId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(query.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    filter.vehicleId = new mongoose.Types.ObjectId(query.vehicleId);

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Optional filters
    if (query.severity) {
      filter.severity = query.severity;
    }

    if (query.status) {
      filter.status = query.status;
    }

    const totalDefects = await Defect.countDocuments(filter);
    const totalPages = Math.ceil(totalDefects / limit);

    const defects = await Defect.find(filter)
      .populate("reportedBy", "fullName name email")
      .sort({ reportedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedDefects = defects.map((defect) => ({
      id: defect._id.toString(),
      vehicleId: defect.vehicleId.toString(),
      reportedBy: defect.reportedBy ? {
        id: defect.reportedBy._id.toString(),
        name: defect.reportedBy.fullName || defect.reportedBy.name,
        email: defect.reportedBy.email,
      } : {
        id: defect.reportedBy.toString(),
      },
      reportedAt: defect.reportedAt.toISOString(),
      severity: defect.severity,
      description: defect.description,
      photos: defect.photos,
      status: defect.status,
      workOrderId: defect.workOrderId ? defect.workOrderId.toString() : null,
      notes: defect.notes,
      createdAt: defect.createdAt.toISOString(),
      updatedAt: defect.updatedAt.toISOString(),
    }));

    return {
      data: formattedDefects,
      pagination: {
        page,
        limit,
        total: totalDefects,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Create a new defect for a vehicle
   * @param {Object} data - Defect data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created defect
   */
  static async createDefect(data, user) {
    const Defect = require("../models/defect.model");
    const Vehicle = require("../models/vehicle.model");

    const errors = [];

    // Validation
    if (!data.vehicleId) {
      errors.push({ field: "vehicleId", message: "Vehicle ID is required" });
    }

    if (!data.severity) {
      errors.push({ field: "severity", message: "Severity is required" });
    } else if (!["minor", "moderate", "critical"].includes(data.severity)) {
      errors.push({
        field: "severity",
        message: "Severity must be one of: minor, moderate, critical",
      });
    }

    if (!data.description || !data.description.trim()) {
      errors.push({
        field: "description",
        message: "Description is required and cannot be empty",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(data.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(data.vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // If severity is critical, update vehicle status
    if (data.severity === "critical") {
      vehicle.status = "workshop";
      await vehicle.save();
    }

    // Create defect
    const defect = await Defect.create({
      vehicleId: data.vehicleId,
      reportedBy: user.id,
      reportedAt: new Date(),
      severity: data.severity,
      description: data.description.trim(),
      photos: data.photos || [],
      status: "open",
      workOrderId: null,
      notes: data.notes || null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: defect._id.toString(),
      vehicleId: defect.vehicleId.toString(),
      reportedBy: defect.reportedBy.toString(),
      reportedAt: defect.reportedAt.toISOString(),
      severity: defect.severity,
      description: defect.description,
      photos: defect.photos,
      status: defect.status,
      workOrderId: defect.workOrderId ? defect.workOrderId.toString() : null,
      notes: defect.notes,
      createdAt: defect.createdAt.toISOString(),
      updatedAt: defect.updatedAt.toISOString(),
    };
  }

  /**
   * Get all work orders for a vehicle
   * @param {Object} query - Query parameters (vehicleId, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Work orders list with pagination
   */
  static async getWorkOrders(query, user) {
    const WorkOrder = require("../models/workOrder.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Vehicle ID filter (required)
    if (!query.vehicleId) {
      throw new AppError("vehicleId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(query.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    filter.vehicleId = new mongoose.Types.ObjectId(query.vehicleId);

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Optional filters
    if (query.type) {
      filter.type = query.type;
    }

    if (query.status) {
      filter.status = query.status;
    }

    const totalWorkOrders = await WorkOrder.countDocuments(filter);
    const totalPages = Math.ceil(totalWorkOrders / limit);

    const workOrders = await WorkOrder.find(filter)
      .populate("vendorId", "companyName firstName lastName")
      .populate("approvedBy", "fullName name email")
      .sort({ openedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedWorkOrders = workOrders.map((workOrder) => ({
      id: workOrder._id.toString(),
      vehicleId: workOrder.vehicleId.toString(),
      openedAt: workOrder.openedAt.toISOString(),
      closedAt: workOrder.closedAt ? workOrder.closedAt.toISOString() : null,
      type: workOrder.type,
      status: workOrder.status,
      tasks: workOrder.tasks,
      parts: workOrder.parts,
      labourHours: workOrder.labourHours,
      totalCost: workOrder.totalCost,
      vendorId: workOrder.vendorId ? workOrder.vendorId.toString() : null,
      documents: workOrder.documents,
      approvedBy: workOrder.approvedBy ? {
        id: workOrder.approvedBy._id.toString(),
        name: workOrder.approvedBy.fullName || workOrder.approvedBy.name,
        email: workOrder.approvedBy.email,
      } : null,
      description: workOrder.description,
      createdAt: workOrder.createdAt.toISOString(),
      updatedAt: workOrder.updatedAt.toISOString(),
    }));

    return {
      data: formattedWorkOrders,
      pagination: {
        page,
        limit,
        total: totalWorkOrders,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Create a new work order for a vehicle
   * @param {Object} data - Work order data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created work order
   */
  static async createWorkOrder(data, user) {
    const WorkOrder = require("../models/workOrder.model");
    const Vehicle = require("../models/vehicle.model");

    const errors = [];

    // Validation
    if (!data.vehicleId) {
      errors.push({ field: "vehicleId", message: "Vehicle ID is required" });
    }

    if (!data.type) {
      errors.push({ field: "type", message: "Type is required" });
    } else if (!["Service", "Repair"].includes(data.type)) {
      errors.push({
        field: "type",
        message: "Type must be one of: Service, Repair",
      });
    }

    if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
      errors.push({
        field: "tasks",
        message: "Tasks array is required and must contain at least one task",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(data.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(data.vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // Create work order
    const workOrder = await WorkOrder.create({
      vehicleId: data.vehicleId,
      openedAt: new Date(),
      closedAt: null,
      type: data.type,
      status: "open",
      tasks: data.tasks,
      parts: [],
      labourHours: null,
      totalCost: 0,
      vendorId: null,
      documents: [],
      approvedBy: null,
      description: data.description || null,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: workOrder._id.toString(),
      vehicleId: workOrder.vehicleId.toString(),
      openedAt: workOrder.openedAt.toISOString(),
      closedAt: workOrder.closedAt ? workOrder.closedAt.toISOString() : null,
      type: workOrder.type,
      status: workOrder.status,
      tasks: workOrder.tasks,
      parts: workOrder.parts,
      labourHours: workOrder.labourHours,
      totalCost: workOrder.totalCost,
      vendorId: workOrder.vendorId ? workOrder.vendorId.toString() : null,
      documents: workOrder.documents,
      approvedBy: workOrder.approvedBy ? workOrder.approvedBy.toString() : null,
      createdAt: workOrder.createdAt.toISOString(),
      updatedAt: workOrder.updatedAt.toISOString(),
    };
  }

  /**
   * Get all schedules for a vehicle
   * @param {Object} query - Query parameters (vehicleId, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Schedules list with pagination
   */
  static async getSchedules(query, user) {
    const Schedule = require("../models/schedule.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Vehicle ID filter (required)
    if (!query.vehicleId) {
      throw new AppError("vehicleId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(query.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    filter.vehicleId = new mongoose.Types.ObjectId(query.vehicleId);

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Optional filters
    if (query.status) {
      filter.status = query.status;
    }

    if (query.basis) {
      filter.basis = query.basis;
    }

    const totalSchedules = await Schedule.countDocuments(filter);
    const totalPages = Math.ceil(totalSchedules / limit);

    const schedules = await Schedule.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedSchedules = schedules.map((schedule) => ({
      id: schedule._id.toString(),
      vehicleId: schedule.vehicleId.toString(),
      type: schedule.type,
      basis: schedule.basis,
      intervalValue: schedule.intervalValue,
      nextDueAt: schedule.nextDueAt ? schedule.nextDueAt.toISOString() : null,
      nextDueKm: schedule.nextDueKm,
      nextDueHours: schedule.nextDueHours,
      status: schedule.status,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    }));

    return {
      data: formattedSchedules,
      pagination: {
        page,
        limit,
        total: totalSchedules,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Create a new schedule for a vehicle
   * @param {Object} data - Schedule data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created schedule
   */
  static async createSchedule(data, user) {
    const Schedule = require("../models/schedule.model");
    const Vehicle = require("../models/vehicle.model");

    const errors = [];

    // Validation
    if (!data.vehicleId) {
      errors.push({ field: "vehicleId", message: "Vehicle ID is required" });
    }

    if (!data.type || !data.type.trim()) {
      errors.push({ field: "type", message: "Type is required" });
    }

    if (!data.basis) {
      errors.push({ field: "basis", message: "Basis is required" });
    } else if (!["KM", "HOURS", "TIME"].includes(data.basis)) {
      errors.push({
        field: "basis",
        message: "Basis must be one of: KM, HOURS, TIME",
      });
    }

    if (data.intervalValue === undefined || data.intervalValue === null) {
      errors.push({ field: "intervalValue", message: "Interval value is required" });
    } else {
      const intervalValue = parseFloat(data.intervalValue);
      if (isNaN(intervalValue) || intervalValue <= 0) {
        errors.push({
          field: "intervalValue",
          message: "Interval value must be a positive number",
        });
      }
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(data.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(data.vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // Calculate next due values based on basis
    let nextDueAt = null;
    let nextDueKm = null;
    let nextDueHours = null;
    const intervalValue = parseFloat(data.intervalValue);

    if (data.basis === "KM") {
      // For KM basis, we'd need current odometer reading from vehicle
      // For now, set nextDueKm based on interval
      nextDueKm = intervalValue; // This should be calculated from current odometer + interval
    } else if (data.basis === "HOURS") {
      // For HOURS basis, we'd need current engine hours
      // For now, set nextDueHours based on interval
      nextDueHours = intervalValue; // This should be calculated from current hours + interval
    } else if (data.basis === "TIME") {
      // For TIME basis, calculate next due date
      const now = new Date();
      now.setDate(now.getDate() + intervalValue); // Add intervalValue days
      nextDueAt = now;
    }

    // Create schedule
    const schedule = await Schedule.create({
      vehicleId: data.vehicleId,
      type: data.type.trim(),
      basis: data.basis,
      intervalValue: intervalValue,
      nextDueAt: nextDueAt,
      nextDueKm: nextDueKm,
      nextDueHours: nextDueHours,
      status: "Active",
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: schedule._id.toString(),
      vehicleId: schedule.vehicleId.toString(),
      type: schedule.type,
      basis: schedule.basis,
      intervalValue: schedule.intervalValue,
      nextDueAt: schedule.nextDueAt ? schedule.nextDueAt.toISOString() : null,
      nextDueKm: schedule.nextDueKm,
      nextDueHours: schedule.nextDueHours,
      status: schedule.status,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    };
  }

  /**
   * Get all documents for a vehicle
   * @param {Object} query - Query parameters (vehicleId, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Documents list with pagination
   */
  static async getVehicleDocuments(query, user) {
    const VehicleDocument = require("../models/vehicleDocument.model");

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Vehicle ID filter (required)
    if (!query.vehicleId) {
      throw new AppError("vehicleId is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(query.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    filter.vehicleId = new mongoose.Types.ObjectId(query.vehicleId);

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Optional filters
    if (query.type) {
      filter.type = query.type;
    }

    const totalDocuments = await VehicleDocument.countDocuments(filter);
    const totalPages = Math.ceil(totalDocuments / limit);

    const documents = await VehicleDocument.find(filter)
      .populate("uploadedBy", "fullName name email")
      .sort({ uploadedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedDocuments = documents.map((document) => ({
      id: document._id.toString(),
      vehicleId: document.vehicleId.toString(),
      name: document.name,
      fileName: document.fileName,
      type: document.type,
      fileType: document.fileType,
      fileUrl: document.fileUrl,
      size: document.size,
      uploadedAt: document.uploadedAt.toISOString(),
      uploadedBy: document.uploadedBy ? {
        id: document.uploadedBy._id.toString(),
        name: document.uploadedBy.fullName || document.uploadedBy.name,
        email: document.uploadedBy.email,
      } : {
        id: document.uploadedBy.toString(),
      },
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    }));

    return {
      data: formattedDocuments,
      pagination: {
        page,
        limit,
        total: totalDocuments,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Get vehicle history (combined inspections, defects, work orders, schedules, documents)
   * @param {string} vehicleId - Vehicle ID
   * @param {Object} query - Query parameters (page, limit, type)
   * @param {Object} user - Authenticated user
   * @returns {Object} Combined history with pagination
   */
  static async getVehicleHistory(vehicleId, query, user) {
    const Inspection = require("../models/inspection.model");
    const Defect = require("../models/defect.model");
    const WorkOrder = require("../models/workOrder.model");
    const Schedule = require("../models/schedule.model");
    const VehicleDocument = require("../models/vehicleDocument.model");
    const Vehicle = require("../models/vehicle.model");

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build base filter
    const baseFilter = {
      vehicleId: new mongoose.Types.ObjectId(vehicleId),
    };

    // Multi-tenant support
    if (user.activeOrganizationId) {
      baseFilter.organizationId = user.activeOrganizationId;
    } else {
      baseFilter.organizationId = null;
    }

    // Optional type filter (inspection, defect, workOrder, schedule, document)
    const typeFilter = query.type;

    // Fetch all history items in parallel
    const [inspections, defects, workOrders, schedules, documents] = await Promise.all([
      !typeFilter || typeFilter === "inspection"
        ? Inspection.find(baseFilter)
            .populate("inspectedBy", "fullName name email")
            .sort({ inspectedAt: -1 })
            .lean()
        : [],
      !typeFilter || typeFilter === "defect"
        ? Defect.find(baseFilter)
            .populate("reportedBy", "fullName name email")
            .sort({ reportedAt: -1 })
            .lean()
        : [],
      !typeFilter || typeFilter === "workOrder"
        ? WorkOrder.find(baseFilter)
            .populate("approvedBy", "fullName name email")
            .sort({ openedAt: -1 })
            .lean()
        : [],
      !typeFilter || typeFilter === "schedule"
        ? Schedule.find(baseFilter)
            .sort({ createdAt: -1 })
            .lean()
        : [],
      !typeFilter || typeFilter === "document"
        ? VehicleDocument.find(baseFilter)
            .populate("uploadedBy", "fullName name email")
            .sort({ uploadedAt: -1 })
            .lean()
        : [],
    ]);

    // Combine and format all history items
    const historyItems = [];

    // Add inspections
    inspections.forEach((inspection) => {
      historyItems.push({
        id: inspection._id.toString(),
        type: "inspection",
        date: inspection.inspectedAt,
        title: `${inspection.type} Inspection - ${inspection.result.toUpperCase()}`,
        description: inspection.notes || `${inspection.type} inspection with result: ${inspection.result}`,
        data: {
          id: inspection._id.toString(),
          vehicleId: inspection.vehicleId.toString(),
          type: inspection.type,
          result: inspection.result,
          inspectedAt: inspection.inspectedAt.toISOString(),
          inspectedBy: inspection.inspectedBy
            ? {
                id: inspection.inspectedBy._id.toString(),
                name: inspection.inspectedBy.fullName || inspection.inspectedBy.name,
                email: inspection.inspectedBy.email,
              }
            : {
                id: inspection.inspectedBy.toString(),
                name: inspection.inspectorName,
              },
          inspectorName: inspection.inspectorName,
          odometerKm: inspection.odometerKm,
          engineHours: inspection.engineHours,
          photos: inspection.photos,
          notes: inspection.notes,
        },
        createdAt: inspection.createdAt.toISOString(),
      });
    });

    // Add defects
    defects.forEach((defect) => {
      historyItems.push({
        id: defect._id.toString(),
        type: "defect",
        date: defect.reportedAt,
        title: `Defect Reported - ${defect.severity.toUpperCase()}`,
        description: defect.description,
        data: {
          id: defect._id.toString(),
          vehicleId: defect.vehicleId.toString(),
          severity: defect.severity,
          description: defect.description,
          reportedAt: defect.reportedAt.toISOString(),
          reportedBy: defect.reportedBy
            ? {
                id: defect.reportedBy._id.toString(),
                name: defect.reportedBy.fullName || defect.reportedBy.name,
                email: defect.reportedBy.email,
              }
            : {
                id: defect.reportedBy.toString(),
              },
          photos: defect.photos,
          status: defect.status,
          workOrderId: defect.workOrderId ? defect.workOrderId.toString() : null,
          notes: defect.notes,
        },
        createdAt: defect.createdAt.toISOString(),
      });
    });

    // Add work orders
    workOrders.forEach((workOrder) => {
      historyItems.push({
        id: workOrder._id.toString(),
        type: "workOrder",
        date: workOrder.openedAt,
        title: `${workOrder.type} Work Order - ${workOrder.status.toUpperCase()}`,
        description: workOrder.description || workOrder.tasks.join(", "),
        data: {
          id: workOrder._id.toString(),
          vehicleId: workOrder.vehicleId.toString(),
          type: workOrder.type,
          status: workOrder.status,
          openedAt: workOrder.openedAt.toISOString(),
          closedAt: workOrder.closedAt ? workOrder.closedAt.toISOString() : null,
          tasks: workOrder.tasks,
          parts: workOrder.parts,
          labourHours: workOrder.labourHours,
          totalCost: workOrder.totalCost,
          approvedBy: workOrder.approvedBy
            ? {
                id: workOrder.approvedBy._id.toString(),
                name: workOrder.approvedBy.fullName || workOrder.approvedBy.name,
                email: workOrder.approvedBy.email,
              }
            : null,
          description: workOrder.description,
        },
        createdAt: workOrder.createdAt.toISOString(),
      });
    });

    // Add schedules
    schedules.forEach((schedule) => {
      historyItems.push({
        id: schedule._id.toString(),
        type: "schedule",
        date: schedule.createdAt,
        title: `${schedule.type} Schedule - ${schedule.status}`,
        description: `Basis: ${schedule.basis}, Interval: ${schedule.intervalValue}`,
        data: {
          id: schedule._id.toString(),
          vehicleId: schedule.vehicleId.toString(),
          type: schedule.type,
          basis: schedule.basis,
          intervalValue: schedule.intervalValue,
          nextDueAt: schedule.nextDueAt ? schedule.nextDueAt.toISOString() : null,
          nextDueKm: schedule.nextDueKm,
          nextDueHours: schedule.nextDueHours,
          status: schedule.status,
        },
        createdAt: schedule.createdAt.toISOString(),
      });
    });

    // Add documents
    documents.forEach((document) => {
      historyItems.push({
        id: document._id.toString(),
        type: "document",
        date: document.uploadedAt,
        title: `Document Uploaded - ${document.name}`,
        description: document.type || "Document",
        data: {
          id: document._id.toString(),
          vehicleId: document.vehicleId.toString(),
          name: document.name,
          fileName: document.fileName,
          type: document.type,
          fileType: document.fileType,
          fileUrl: document.fileUrl,
          size: document.size,
          uploadedAt: document.uploadedAt.toISOString(),
          uploadedBy: document.uploadedBy
            ? {
                id: document.uploadedBy._id.toString(),
                name: document.uploadedBy.fullName || document.uploadedBy.name,
                email: document.uploadedBy.email,
              }
            : {
                id: document.uploadedBy.toString(),
              },
        },
        createdAt: document.createdAt.toISOString(),
      });
    });

    // Sort by date (most recent first)
    historyItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Apply pagination
    const total = historyItems.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedItems = historyItems.slice(skip, skip + limit);

    return {
      data: paginatedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Get maintenance logs for a vehicle
   * @param {string} vehicleId - Vehicle ID
   * @param {Object} query - Query parameters (page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Maintenance logs list with pagination
   */
  static async getMaintenanceLogs(vehicleId, query, user) {
    const MaintenanceLog = require("../models/maintenanceLog.model");
    const Vehicle = require("../models/vehicle.model");

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {
      vehicleId: new mongoose.Types.ObjectId(vehicleId),
    };

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    const totalLogs = await MaintenanceLog.countDocuments(filter);
    const totalPages = Math.ceil(totalLogs / limit);

    const logs = await MaintenanceLog.find(filter)
      .populate("createdBy", "fullName name email")
      .sort({ maintenanceDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedLogs = logs.map((log) => ({
      id: log._id.toString(),
      vehicleId: log.vehicleId.toString(),
      schedule: log.schedule,
      maintenanceDate: log.maintenanceDate.toISOString(),
      conductorName: log.conductorName,
      conductorQualifications: log.conductorQualifications,
      workDescription: log.workDescription,
      nextMaintenanceDue: log.nextMaintenanceDue ? log.nextMaintenanceDue.toISOString() : null,
      approverName: log.approverName,
      createdBy: log.createdBy
        ? {
            id: log.createdBy._id.toString(),
            name: log.createdBy.fullName || log.createdBy.name,
            email: log.createdBy.email,
          }
        : {
            id: log.createdBy.toString(),
          },
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString(),
    }));

    return {
      data: formattedLogs,
      pagination: {
        page,
        limit,
        total: totalLogs,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Create a maintenance log for a vehicle
   * @param {string} vehicleId - Vehicle ID
   * @param {Object} data - Maintenance log data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created maintenance log
   */
  static async createMaintenanceLog(vehicleId, data, user) {
    const MaintenanceLog = require("../models/maintenanceLog.model");
    const Vehicle = require("../models/vehicle.model");

    const errors = [];

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Validation
    if (!data.schedule || !data.schedule.trim()) {
      errors.push({ field: "schedule", message: "Schedule is required" });
    } else if (data.schedule.length > 100) {
      errors.push({
        field: "schedule",
        message: "Schedule must be 100 characters or less",
      });
    }

    if (!data.maintenanceDate) {
      errors.push({ field: "maintenanceDate", message: "Maintenance date is required" });
    } else {
      const maintenanceDate = new Date(data.maintenanceDate);
      if (isNaN(maintenanceDate.getTime())) {
        errors.push({
          field: "maintenanceDate",
          message: "Maintenance date must be a valid date (ISO 8601)",
        });
      }
    }

    if (!data.conductorName || !data.conductorName.trim()) {
      errors.push({ field: "conductorName", message: "Conductor name is required" });
    } else if (data.conductorName.length > 200) {
      errors.push({
        field: "conductorName",
        message: "Conductor name must be 200 characters or less",
      });
    }

    if (data.conductorQualifications && data.conductorQualifications.length > 200) {
      errors.push({
        field: "conductorQualifications",
        message: "Conductor qualifications must be 200 characters or less",
      });
    }

    if (!data.workDescription || !data.workDescription.trim()) {
      errors.push({ field: "workDescription", message: "Work description is required" });
    } else if (data.workDescription.length > 2000) {
      errors.push({
        field: "workDescription",
        message: "Work description must be 2000 characters or less",
      });
    }

    if (data.nextMaintenanceDue) {
      const nextMaintenanceDue = new Date(data.nextMaintenanceDue);
      if (isNaN(nextMaintenanceDue.getTime())) {
        errors.push({
          field: "nextMaintenanceDue",
          message: "Next maintenance due must be a valid date (ISO 8601)",
        });
      }
    }

    if (data.approverName && data.approverName.length > 200) {
      errors.push({
        field: "approverName",
        message: "Approver name must be 200 characters or less",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // Extract organizationId from vehicle (preferred) or use from user context
    // If organizationId is provided in request body, validate it matches vehicle's organization
    let finalOrganizationId = vehicle.organizationId || user.activeOrganizationId || null;

    if (data.organizationId) {
      // Validate that provided organizationId matches vehicle's organizationId
      const providedOrgId = data.organizationId.toString();
      const vehicleOrgId = vehicle.organizationId ? vehicle.organizationId.toString() : null;

      if (vehicleOrgId && providedOrgId !== vehicleOrgId) {
        errors.push({
          field: "organizationId",
          message: "Organization ID does not match vehicle organization",
        });
      } else {
        // If vehicle doesn't have organizationId but one is provided, use it
        if (!vehicleOrgId) {
          finalOrganizationId = new mongoose.Types.ObjectId(providedOrgId);
        }
      }
    }

    // Re-check errors after organizationId validation
    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Create maintenance log
    const maintenanceLog = await MaintenanceLog.create({
      vehicleId: new mongoose.Types.ObjectId(vehicleId),
      schedule: data.schedule.trim(),
      maintenanceDate: new Date(data.maintenanceDate),
      conductorName: data.conductorName.trim(),
      conductorQualifications: data.conductorQualifications ? data.conductorQualifications.trim() : null,
      workDescription: data.workDescription.trim(),
      nextMaintenanceDue: data.nextMaintenanceDue ? new Date(data.nextMaintenanceDue) : null,
      approverName: data.approverName ? data.approverName.trim() : null,
      createdBy: user.id,
      organizationId: finalOrganizationId,
    });

    return {
      id: maintenanceLog._id.toString(),
      vehicleId: maintenanceLog.vehicleId.toString(),
      schedule: maintenanceLog.schedule,
      maintenanceDate: maintenanceLog.maintenanceDate.toISOString(),
      conductorName: maintenanceLog.conductorName,
      conductorQualifications: maintenanceLog.conductorQualifications,
      workDescription: maintenanceLog.workDescription,
      nextMaintenanceDue: maintenanceLog.nextMaintenanceDue ? maintenanceLog.nextMaintenanceDue.toISOString() : null,
      approverName: maintenanceLog.approverName,
      createdBy: user.id,
      createdAt: maintenanceLog.createdAt.toISOString(),
      updatedAt: maintenanceLog.updatedAt.toISOString(),
    };
  }

  /**
   * Upload a document for a vehicle
   * @param {Object} data - Document data
   * @param {Object} file - Uploaded file
   * @param {Object} user - Authenticated user
   * @returns {Object} Created document
   */
  static async uploadVehicleDocument(data, file, user) {
    const VehicleDocument = require("../models/vehicleDocument.model");
    const Vehicle = require("../models/vehicle.model");
    const { uploadFileToS3 } = require("./aws.service");
    const path = require("path");

    const errors = [];

    // Validation
    if (!file) {
      errors.push({ field: "file", message: "File is required" });
    }

    if (!data.vehicleId) {
      errors.push({ field: "vehicleId", message: "Vehicle ID is required" });
    }

    // File type validation
    if (file) {
      const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (!mimetype || !extname) {
        errors.push({
          field: "file",
          message: "Invalid file type. Only images, PDFs, and documents are allowed.",
        });
      }

      // File size validation (10MB max)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        errors.push({
          field: "file",
          message: "File size exceeds 10MB limit",
        });
      }
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(data.vehicleId)) {
      throw new AppError("Invalid vehicle ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findOne({
      _id: new mongoose.Types.ObjectId(data.vehicleId),
      organizationId: user.activeOrganizationId || null,
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found", HttpStatusCodes.NOT_FOUND);
    }

    // Generate unique file name
    const timestamp = Date.now();
    const fileName = `${timestamp}-${file.originalname}`;
    const key = `vehicles/${data.vehicleId}/${fileName}`;

    // Upload to S3
    let fileUrl;
    try {
      fileUrl = await uploadFileToS3(file.buffer, key, file.mimetype);
    } catch (uploadError) {
      console.error("Error uploading file to S3:", uploadError);
      throw new AppError(
        "Failed to upload file. Please try again.",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Get file extension
    const fileType = path.extname(file.originalname).slice(1).toLowerCase();

    // Create document record
    const document = await VehicleDocument.create({
      vehicleId: data.vehicleId,
      name: data.name || file.originalname,
      fileName: file.originalname,
      type: data.type || "Document",
      fileType: fileType,
      fileUrl: fileUrl,
      size: file.size,
      uploadedAt: new Date(),
      uploadedBy: user.id,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: document._id.toString(),
      vehicleId: document.vehicleId.toString(),
      name: document.name,
      fileName: document.fileName,
      type: document.type,
      fileType: document.fileType,
      fileUrl: document.fileUrl,
      size: document.size,
      uploadedAt: document.uploadedAt.toISOString(),
      uploadedBy: document.uploadedBy.toString(),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  // ==================== INDUCTIONS ====================

  static async getAllInductions() {
    const inductions = await Induction.find({ isActive: true })
      .sort({ title: 1 })
      .lean();

    return inductions.map((induction) => ({
      id: induction._id.toString(),
      code: induction.code,
      title: induction.title,
      siteId: induction.siteId ? induction.siteId.toString() : null,
      validMonths: induction.validMonths,
      description: induction.description,
      isActive: induction.isActive,
      createdAt: induction.createdAt,
    }));
  }

  static async getDriverInductions(driverId) {
    const inductions = await DriverInduction.find({ driverId })
      .populate("inductionId")
      .sort({ completionDate: -1 })
      .lean();

    return inductions.map((di) => ({
      id: di._id.toString(),
      driverId: di.driverId.toString(),
      inductionId: di.inductionId._id.toString(),
      induction: {
        code: di.inductionId.code,
        title: di.inductionId.title,
      },
      completionDate: di.completionDate,
      expiryDate: di.expiryDate,
      evidenceUrl: di.evidenceUrl,
      status: di.status,
      createdAt: di.createdAt,
    }));
  }

  static async completeDriverInduction(driverId, data) {
    const induction = await Induction.findById(data.inductionId);
    if (!induction) {
      throw new AppError("Induction not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Calculate expiry date if validMonths is set
    let expiryDate = data.expiryDate;
    if (!expiryDate && induction.validMonths) {
      const completionDate = data.completionDate
        ? new Date(data.completionDate)
        : new Date();
      expiryDate = new Date(completionDate);
      expiryDate.setMonth(expiryDate.getMonth() + induction.validMonths);
    }

    // Check if already exists
    const existing = await DriverInduction.findOne({
      driverId,
      inductionId: data.inductionId,
    });

    if (existing) {
      existing.completionDate = data.completionDate || new Date();
      existing.expiryDate = expiryDate;
      existing.evidenceUrl = data.evidenceUrl;
      existing.status = data.status || "current";
      await existing.save();

      return {
        success: true,
        message: "Driver induction updated successfully",
        driverInduction: existing.toObject(),
      };
    }

    const driverInduction = await DriverInduction.create({
      driverId,
      inductionId: data.inductionId,
      completionDate: data.completionDate || new Date(),
      expiryDate,
      evidenceUrl: data.evidenceUrl,
      status: data.status || "current",
    });

    return {
      success: true,
      message: "Driver induction completed successfully",
      driverInduction: driverInduction.toObject(),
    };
  }

  /**
   * Submit initial driver application (Stage 1)
   * @param {Object} data - Form data
   * @returns {Object} Application ID and email
   */
  static async submitDriverApplication(data) {
    // Validation
    const errors = [];

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      errors.push({
        field: "email",
        message: "Invalid email format",
      });
    }

    // Required fields validation
    if (!data.firstName) {
      errors.push({ field: "firstName", message: "First name is required" });
    }
    if (!data.lastName) {
      errors.push({ field: "lastName", message: "Last name is required" });
    }
    if (!data.suburb) {
      errors.push({ field: "suburb", message: "Suburb is required" });
    }
    if (!data.stateRegion) {
      errors.push({ field: "stateRegion", message: "State/Region is required" });
    }
    if (!data.phone) {
      errors.push({ field: "phone", message: "Phone is required" });
    }
    if (!data.servicesProvided) {
      errors.push({ field: "servicesProvided", message: "Services provided is required" });
    }
    if (!data.contactType) {
      errors.push({ field: "contactType", message: "Contact type is required" });
    }
    if (!data.vehicleTypesInFleet) {
      errors.push({ field: "vehicleTypesInFleet", message: "Vehicle types in fleet is required" });
    }
    if (!data.fleetSize) {
      errors.push({ field: "fleetSize", message: "Fleet size is required" });
    }

    // Parse JSON arrays
    let servicesProvided = [];
    let vehicleTypesInFleet = [];

    try {
      if (data.servicesProvided) {
        servicesProvided =
          typeof data.servicesProvided === "string"
            ? JSON.parse(data.servicesProvided)
            : data.servicesProvided;
      }
    } catch (e) {
      errors.push({
        field: "servicesProvided",
        message: "Invalid JSON format for servicesProvided",
      });
    }

    try {
      if (data.vehicleTypesInFleet) {
        vehicleTypesInFleet =
          typeof data.vehicleTypesInFleet === "string"
            ? JSON.parse(data.vehicleTypesInFleet)
            : data.vehicleTypesInFleet;
      }
    } catch (e) {
      errors.push({
        field: "vehicleTypesInFleet",
        message: "Invalid JSON format for vehicleTypesInFleet",
      });
    }

    // Validate contactType
    if (data.contactType && !["Owner Operator", "Fleet Owner"].includes(data.contactType)) {
      errors.push({
        field: "contactType",
        message: "Contact type must be 'Owner Operator' or 'Fleet Owner'",
      });
    }

    // Validate fleetSize
    if (data.fleetSize && !["1 to 5", "5 to 10", "10 +"].includes(data.fleetSize)) {
      errors.push({
        field: "fleetSize",
        message: "Fleet size must be '1 to 5', '5 to 10', or '10 +'",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Create application record
    const application = await Application.create({
      email: data.email.toLowerCase().trim(),
      firstName: data.firstName,
      lastName: data.lastName,
      companyName: data.companyName || null,
      suburb: data.suburb,
      stateRegion: data.stateRegion,
      phone: data.phone,
      servicesProvided,
      contactType: data.contactType,
      vehicleTypesInFleet,
      fleetSize: data.fleetSize,
      status: "PENDING_INDUCTION",
      submittedAt: new Date(),
    });

    // Check if user already exists
    let user = await User.findOne({ email: data.email.toLowerCase().trim() });
    let party = null;
    let driver = null;

    if (!user) {
      // Create user account with temporary password
      const passwordHash = await bcrypt.hash("changeme123", 10);
      user = await User.create({
        email: data.email.toLowerCase().trim(),
        userName: data.email.split("@")[0] + Math.random().toString(36).substring(7),
        password: passwordHash,
        fullName: `${data.firstName} ${data.lastName}`,
        name: `${data.firstName} ${data.lastName}`,
        role: "DRIVER",
        status: "PENDING_APPROVAL",
        approvalStatus: "PENDING",
        passwordChangeRequired: true,
        isSuperAdmin: false,
      });

      // Create party record
      party = await Party.create({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.toLowerCase().trim(),
        phone: data.phone,
        companyName: data.companyName || null,
        suburb: data.suburb,
        state: data.stateRegion,
      });
    } else {
      // Find or create party for existing user
      party = await Party.findOne({ email: data.email.toLowerCase().trim() });
      if (!party) {
        party = await Party.create({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email.toLowerCase().trim(),
          phone: data.phone,
          companyName: data.companyName || null,
          suburb: data.suburb,
          state: data.stateRegion,
        });
      } else {
        // Update party information
        party.firstName = data.firstName;
        party.lastName = data.lastName;
        party.phone = data.phone;
        party.companyName = data.companyName || party.companyName;
        party.suburb = data.suburb || party.suburb;
        party.state = data.stateRegion || party.state;
        await party.save();
      }
    }

    // CRITICAL: Find or create driver record - THIS IS CRITICAL FOR MASTER DATA
    // The driver record MUST be created for the driver to appear in Master Data > Drivers tab
    driver = await Driver.findOne({ userId: user._id });

    if (!driver) {
      // Generate driver code
      const count = await Driver.countDocuments();
      const driverCode = `DRV${String(count + 1).padStart(4, "0")}`;

      // Determine employment type from contactType
      let employmentType = "CONTRACTOR";
      if (data.contactType) {
        if (data.contactType.toLowerCase().includes("employee")) {
          employmentType = "EMPLOYEE";
        } else if (data.contactType.toLowerCase().includes("casual")) {
          employmentType = "CASUAL";
        }
      }

      // Create new driver record - this is what makes them appear in Master Data
      driver = await Driver.create({
        partyId: party._id,
        userId: user._id,
        driverCode,
        employmentType,
        isActive: false, // MUST be false for pending recruits
        driverStatus: data.driverStatus || "PENDING_RECRUIT", // Use from request body if provided (default: PENDING_RECRUIT)
        complianceStatus: data.complianceStatus || "PENDING_APPROVAL", // Use from request body if provided (default: PENDING_APPROVAL)
        contactType: data.contactType,
        servicesProvided,
        vehicleTypesInFleet,
        fleetSize: data.fleetSize,
      });

      console.log(`✅ Created driver record with ID: ${driver._id.toString()}, Status: ${driver.driverStatus}`);
    } else {
      // Handle existing driver - check if already approved/compliant
      const isAlreadyApproved =
        driver.driverStatus === "COMPLIANT" && driver.isActive === true;

      if (isAlreadyApproved) {
        // Driver is already approved - reject the application (Option 1: Recommended)
        throw new AppError(
          "You are already an approved driver. If you need to update your information, please contact support or use the driver portal.",
          HttpStatusCodes.BAD_REQUEST
        );

        // Alternative (Option 2): Allow update but keep status
        // driver.contactType = data.contactType || driver.contactType;
        // driver.servicesProvided = servicesProvided;
        // driver.vehicleTypesInFleet = vehicleTypesInFleet;
        // driver.fleetSize = data.fleetSize || driver.fleetSize;
        // // Keep existing status and active state
        // await driver.save();
        // console.log(`✅ Updated approved driver record (status preserved): ${driver._id.toString()}`);
      } else {
        // Driver exists but not approved - update status for re-application
        driver.driverStatus = data.driverStatus || "PENDING_RECRUIT";
        driver.complianceStatus = data.complianceStatus || "PENDING_APPROVAL";
        driver.isActive = false; // Ensure inactive for pending recruits
        driver.contactType = data.contactType || driver.contactType;
        driver.servicesProvided = servicesProvided;
        driver.vehicleTypesInFleet = vehicleTypesInFleet;
        driver.fleetSize = data.fleetSize || driver.fleetSize;
        await driver.save();

        console.log(
          `✅ Updated driver record with ID: ${driver._id.toString()}, Status: ${driver.driverStatus}`
        );
      }
    }

    // CRITICAL: Verify driver record was created/updated
    if (!driver || !driver._id) {
      console.error("❌ ERROR: Driver record was not created/updated successfully");
      throw new AppError(
        "Failed to create driver record. Please contact support.",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create token record
    const tokenRecord = await InductionToken.create({
      email: data.email.toLowerCase().trim(),
      applicationId: application._id,
      token,
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Generate induction link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const inductionLink = `${frontendUrl}/driver-induction?token=${token}&email=${encodeURIComponent(data.email)}`;

    // Send email
    try {
      await sendDriverApplicationEmail({
        email: data.email,
        firstName: data.firstName,
        inductionLink,
      });
    } catch (emailError) {
      console.error("Error sending application email:", emailError);
      // Continue even if email fails
    }

    return {
      success: true,
      message: "Application submitted successfully. Please check your email to complete the induction form.",
      driver: driver
        ? {
            id: driver._id.toString(),
            email: data.email,
            driverStatus: driver.driverStatus,
            complianceStatus: driver.complianceStatus,
          }
        : null,
      applicationId: application._id.toString(),
      email: data.email,
    };
  }

  /**
   * Submit driver application/induction form (Stage 2)
   * @param {Object} data - Form data
   * @param {Object} files - Uploaded files (from multer)
   * @returns {Object} Created user and driver objects
   */
  static async submitDriverInductionForm(data, files = {}) {
    // State name to abbreviation mapping
    const stateMap = {
      "New South Wales": "NSW",
      "Victoria": "VIC",
      "Queensland": "QLD",
      "Western Australia": "WA",
      "South Australia": "SA",
      "Tasmania": "TAS",
      "Australian Capital Territory": "ACT",
      "Northern Territory": "NT",
    };

    // Token validation (if token provided)
    let tokenRecord = null;
    if (data.token) {
      tokenRecord = await InductionToken.findOne({
        token: data.token,
        email: data.email.toLowerCase().trim(),
        used: false,
        expiresAt: { $gt: new Date() },
      });

      if (!tokenRecord) {
        throw new AppError(
          "Invalid or expired token. The induction link has expired or is invalid. Please request a new link.",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    // Validation
    const errors = [];

    // Username uniqueness check
    if (data.username) {
      const existingUsername = await User.findOne({ userName: data.username });
      if (existingUsername) {
        errors.push({
          field: "username",
          message: "Username already taken",
        });
      }
    }

    // ABN validation (11 digits, spaces allowed)
    if (data.abn) {
      const abnClean = data.abn.replace(/\s/g, "");
      if (!/^\d{11}$/.test(abnClean)) {
        errors.push({
          field: "abn",
          message: "ABN must be 11 digits",
        });
      }
    }

    // BSB validation (format: XXX-XXX or XXXXXX)
    if (data.bsb) {
      const bsbClean = data.bsb.replace(/-/g, "");
      if (!/^\d{6}$/.test(bsbClean)) {
        errors.push({
          field: "bsb",
          message: "BSB must be 6 digits (format: XXX-XXX or XXXXXX)",
        });
      }
    }

    // Account number validation
    if (data.accountNumber && !/^\d+$/.test(data.accountNumber)) {
      errors.push({
        field: "accountNumber",
        message: "Account number must be numeric",
      });
    }

    // Parse JSON arrays
    let servicesProvided = [];
    let vehicleTypesInFleet = [];

    try {
      if (data.servicesProvided) {
        servicesProvided =
          typeof data.servicesProvided === "string"
            ? JSON.parse(data.servicesProvided)
            : data.servicesProvided;
      }
    } catch (e) {
      errors.push({
        field: "servicesProvided",
        message: "Invalid JSON format for servicesProvided",
      });
    }

    try {
      if (data.vehicleTypesInFleet) {
        vehicleTypesInFleet =
          typeof data.vehicleTypesInFleet === "string"
            ? JSON.parse(data.vehicleTypesInFleet)
            : data.vehicleTypesInFleet;
      }
    } catch (e) {
      errors.push({
        field: "vehicleTypesInFleet",
        message: "Invalid JSON format for vehicleTypesInFleet",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Convert state region to abbreviation
    const stateAbbrev = stateMap[data.stateRegion] || data.stateRegion;

    // Hash password
    const passwordHash = await bcrypt.hash(
      data.password || "changeme123",
      10
    );

    // ⚠️ CRITICAL: Create or update user account
    // If userId is provided (from authenticated request), use that user
    let user = null;
    if (data.userId) {
      user = await User.findById(data.userId);
      if (!user) {
        throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
      }
      // Update user if needed (but don't change password if already set)
      if (data.fullName || data.firstName || data.lastName) {
        user.fullName = data.fullName || `${data.firstName} ${data.lastName}` || user.fullName;
        user.name = user.fullName;
      }
      await user.save();
    } else {
      // Handle non-authenticated flow (token-based)
      // Check if user exists, but don't reject if it does - allow update
      const existingUser = await User.findOne({ email: data.email.toLowerCase().trim() });
      user = existingUser;
      
      if (user) {
        // Update existing user from initial application
        user.userName = data.username || user.userName || data.email.split("@")[0];
        // Only update password if it's not already set or if explicitly provided
        if (data.password || !user.password) {
          user.password = passwordHash;
        }
        user.fullName = data.fullName || `${data.firstName} ${data.lastName}` || user.fullName;
        user.name = user.fullName;
        user.role = data.role || user.role || "DRIVER";
        // Don't override status if user is already ACTIVE or APPROVED
        if (user.status === "PENDING_APPROVAL" || user.status === "PENDING_INDUCTION") {
          user.status = "PENDING_APPROVAL";
          user.approvalStatus = "PENDING";
        }
        user.passwordChangeRequired = true;
        await user.save();
      } else {
        // Create new user
        user = await User.create({
          email: data.email.toLowerCase().trim(),
          userName: data.username || data.email.split("@")[0],
          password: passwordHash,
          fullName: data.fullName || `${data.firstName} ${data.lastName}`,
          name: data.fullName || `${data.firstName} ${data.lastName}`,
          role: data.role || "DRIVER",
          status: "PENDING_APPROVAL",
          approvalStatus: "PENDING",
          passwordChangeRequired: true,
          isSuperAdmin: false,
        });
      }
    }

    // Find or create party record
    let party = await Party.findOne({ email: data.email.toLowerCase().trim() });
    if (!party) {
      party = await Party.create({
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.companyName,
        email: data.email.toLowerCase().trim(),
        phone: data.phone,
        phoneAlt: data.phoneAlt,
        suburb: data.suburb,
        state: stateAbbrev,
        abn: data.abn,
      });
    } else {
      // Update existing party information
      party.firstName = data.firstName || party.firstName;
      party.lastName = data.lastName || party.lastName;
      party.companyName = data.companyName || party.companyName;
      party.phone = data.phone || party.phone;
      party.phoneAlt = data.phoneAlt || party.phoneAlt;
      party.suburb = data.suburb || party.suburb;
      party.state = stateAbbrev || party.state;
      party.abn = data.abn || party.abn;
      await party.save();
    }

    // Generate driver code
    const count = await Driver.countDocuments();
    const driverCode = `DRV${String(count + 1).padStart(4, "0")}`;

    // Determine employment type from contactType
    let employmentType = "CONTRACTOR";
    if (data.contactType) {
      if (data.contactType.toLowerCase().includes("employee")) {
        employmentType = "EMPLOYEE";
      } else if (data.contactType.toLowerCase().includes("casual")) {
        employmentType = "CASUAL";
      }
    }

    // Parse date strings
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // Parse boolean
    const gstRegistered = data.gstRegistered === "true" || data.gstRegistered === true;

    // ⚠️ CRITICAL: Find driver - support multiple lookup methods
    // Option 1: If authenticated user exists, find by userId
    let driver = await Driver.findOne({ userId: user._id }).populate("party");
    
    // Option 2: If not found by userId, try finding by email via party
    if (!driver && data.email) {
      const party = await Party.findOne({ email: data.email.toLowerCase().trim() });
      if (party) {
        driver = await Driver.findOne({ partyId: party._id }).populate("party");
        // If found by party, ensure userId is linked
        if (driver && !driver.userId) {
          driver.userId = user._id;
          await driver.save();
          console.log(`✅ Linked driver ${driver._id.toString()} to user ${user._id.toString()} during induction submission`);
        }
      }
    }
    
    // ⚠️ CRITICAL: Verify driver exists
    if (!driver) {
      throw new AppError(
        "Driver not found. Please ensure you have submitted an application first.",
        HttpStatusCodes.NOT_FOUND
      );
    }
    
    // ⚠️ CRITICAL: Verify driver status allows induction submission
    // Only allow NEW_RECRUIT or PENDING_INDUCTION drivers to submit/update
    if (driver.driverStatus && !['NEW_RECRUIT', 'PENDING_INDUCTION'].includes(driver.driverStatus)) {
      throw new AppError(
        `Cannot submit induction. Current status: ${driver.driverStatus}. Expected: NEW_RECRUIT or PENDING_INDUCTION`,
        HttpStatusCodes.BAD_REQUEST
      );
    }
    
    // Create new driver record only if it doesn't exist (should not happen if flow is correct, but handle gracefully)
    if (!driver) {
      driver = await Driver.create({
        partyId: party._id,
        userId: user._id,
        driverCode,
        employmentType,
        isActive: false, // Inactive until admin approval
        driverStatus: "PENDING_INDUCTION",
        complianceStatus: "PENDING_REVIEW",
        contactType: data.contactType || "Pending Induction",
        abn: data.abn,
        bankName: data.bankName,
        bsb: data.bsb,
        accountNumber: data.accountNumber,
        accountName: data.accountName || data.fullName || `${data.firstName} ${data.lastName}`,
        gstRegistered,
        servicesProvided,
        vehicleTypesInFleet,
        fleetSize: data.fleetSize,
        // Insurance policy numbers
        motorInsurancePolicyNumber: data.motorInsurancePolicyNumber,
        marineCargoInsurancePolicyNumber: data.marineCargoInsurancePolicyNumber,
        publicLiabilityPolicyNumber: data.publicLiabilityPolicyNumber,
        workersCompPolicyNumber: data.workersCompPolicyNumber,
        // Expiry dates
        licenseExpiry: parseDate(data.licenseExpiry),
        motorInsuranceExpiry: parseDate(data.motorInsuranceExpiry),
        marineCargoExpiry: parseDate(data.marineCargoInsuranceExpiry),
        publicLiabilityExpiry: parseDate(data.publicLiabilityExpiry),
        workersCompExpiry: parseDate(data.workersCompExpiry),
      });
    } else {
      // ⚠️ CRITICAL: Update existing driver record with status changes
      // This status update is MANDATORY - it triggers frontend to hide "Complete Induction Form" button
      driver.driverStatus = data.driverStatus || "PENDING_INDUCTION"; // From form data or default
      driver.complianceStatus = data.complianceStatus || "PENDING_REVIEW"; // From form data or default
      driver.isActive = false; // MUST remain false until staff approval
      driver.userId = user._id; // Ensure userId is always linked
      driver.contactType = data.contactType || driver.contactType;
      driver.abn = data.abn || driver.abn;
      driver.bankName = data.bankName || driver.bankName;
      driver.bsb = data.bsb || driver.bsb;
      driver.accountNumber = data.accountNumber || driver.accountNumber;
      driver.accountName = data.accountName || data.fullName || driver.accountName;
      driver.gstRegistered = gstRegistered;
      driver.servicesProvided = servicesProvided;
      driver.vehicleTypesInFleet = vehicleTypesInFleet;
      driver.fleetSize = data.fleetSize || driver.fleetSize;
      driver.motorInsurancePolicyNumber = data.motorInsurancePolicyNumber || driver.motorInsurancePolicyNumber;
      driver.marineCargoInsurancePolicyNumber = data.marineCargoInsurancePolicyNumber || driver.marineCargoInsurancePolicyNumber;
      driver.publicLiabilityPolicyNumber = data.publicLiabilityPolicyNumber || driver.publicLiabilityPolicyNumber;
      driver.workersCompPolicyNumber = data.workersCompPolicyNumber || driver.workersCompPolicyNumber;
      driver.licenseExpiry = parseDate(data.licenseExpiry) || driver.licenseExpiry;
      driver.motorInsuranceExpiry = parseDate(data.motorInsuranceExpiry) || driver.motorInsuranceExpiry;
      driver.marineCargoExpiry = parseDate(data.marineCargoInsuranceExpiry) || driver.marineCargoExpiry;
      driver.publicLiabilityExpiry = parseDate(data.publicLiabilityExpiry) || driver.publicLiabilityExpiry;
      driver.workersCompExpiry = parseDate(data.workersCompExpiry) || driver.workersCompExpiry;
      await driver.save();
      
      // Verify the update was successful
      const savedDriver = await Driver.findById(driver._id)
        .select("driverStatus complianceStatus isActive userId")
        .lean();
      
      console.log(`✅ Driver ${driver._id.toString()} status updated:`, {
        driverStatus: savedDriver.driverStatus,
        complianceStatus: savedDriver.complianceStatus,
        isActive: savedDriver.isActive,
        userId: savedDriver.userId?.toString() || 'NOT LINKED'
      });
      
      // Update driver reference for response
      driver.driverStatus = savedDriver.driverStatus;
      driver.complianceStatus = savedDriver.complianceStatus;
      driver.isActive = savedDriver.isActive;
    }

    // Upload and store documents
    const documentTypes = [
      { field: "motorInsuranceDocument", type: "MOTOR_INSURANCE" },
      { field: "marineCargoInsuranceDocument", type: "MARINE_CARGO_INSURANCE" },
      { field: "publicLiabilityDocument", type: "PUBLIC_LIABILITY" },
      { field: "workersCompDocument", type: "WORKERS_COMP" },
      { field: "licenseDocumentFront", type: "LICENSE_FRONT" },
      { field: "licenseDocumentBack", type: "LICENSE_BACK" },
      { field: "policeCheckDocument", type: "POLICE_CHECK" },
    ];

    const uploadedDocuments = [];

    for (const docType of documentTypes) {
      const file = files[docType.field];
      if (file) {
        try {
          // Validate file type
          const allowedMimes = [
            "application/pdf",
            "image/jpeg",
            "image/jpg",
            "image/png",
          ];
          const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];

          const fileExtension = file.originalname
            .toLowerCase()
            .substring(file.originalname.lastIndexOf("."));

          if (
            !allowedMimes.includes(file.mimetype) &&
            !allowedExtensions.includes(fileExtension)
          ) {
            throw new AppError(
              `Invalid file type for ${docType.field}. Only PDF, JPG, JPEG, and PNG files are allowed.`,
              HttpStatusCodes.BAD_REQUEST
            );
          }

          // Validate file size (10MB max)
          const maxSize = 10 * 1024 * 1024; // 10MB
          if (file.size > maxSize) {
            throw new AppError(
              `File ${docType.field} exceeds 10MB limit.`,
              HttpStatusCodes.BAD_REQUEST
            );
          }

          // Convert file buffer to base64 for S3 upload
          const base64File = file.buffer.toString("base64");
          const dataUrl = `data:${file.mimetype};base64,${base64File}`;

          // Upload to S3
          const uploadResult = await uploadFileToS3(
            dataUrl,
            file.mimetype
          );

          if (!uploadResult.success) {
            throw new AppError(
              `Failed to upload ${docType.field}`,
              HttpStatusCodes.INTERNAL_SERVER_ERROR
            );
          }

          // Create document record
          const driverDocument = await DriverDocument.create({
            driverId: driver._id,
            documentType: docType.type,
            fileName: file.originalname,
            fileUrl: uploadResult.url,
            fileSize: file.size,
            mimeType: file.mimetype,
          });

          uploadedDocuments.push(driverDocument);
        } catch (error) {
          // Log error but continue with other documents
          console.error(`Error uploading ${docType.field}:`, error.message);
          // Optionally, you could add to errors array
        }
      }
    }

    // Mark token as used (if token provided)
    if (tokenRecord) {
      tokenRecord.used = true;
      tokenRecord.usedAt = new Date();
      await tokenRecord.save();

      // Update application status if linked
      if (tokenRecord.applicationId) {
        const application = await Application.findById(tokenRecord.applicationId);
        if (application) {
          application.status = "COMPLETED";
          application.completedAt = new Date();
          await application.save();
        }
      }
    }

    // Send welcome email with credentials
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      await sendDriverInductionSubmittedEmail({
        email: user.email,
        fullName: user.fullName,
        username: user.userName,
        loginUrl: `${frontendUrl}/login`,
      });
    } catch (emailError) {
      console.error("Error sending induction submitted email:", emailError);
      // Continue even if email fails
    }

    // ⚠️ CRITICAL: Return updated status in response so frontend can refresh
    // Reload driver to ensure we have the latest status
    const updatedDriver = await Driver.findById(driver._id)
      .select("driverStatus complianceStatus isActive")
      .lean();
    
    return {
      success: true,
      message: "Induction submitted successfully",
      driver: {
        id: driver._id.toString(),
        driverStatus: updatedDriver.driverStatus || driver.driverStatus,
        complianceStatus: updatedDriver.complianceStatus || driver.complianceStatus,
        isActive: updatedDriver.isActive !== undefined ? updatedDriver.isActive : driver.isActive,
      },
    };
  }

  /**
   * Approve driver induction
   * @param {string} driverId - Driver ID
   * @param {Object} user - User object (for permissions and audit)
   * @returns {Object} Updated driver object with user account details
   */
  static async approveDriverInduction(driverId, user) {
    // Find driver with party populated
    const driver = await Driver.findById(driverId).populate("party");

    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (!driver.party) {
      throw new AppError(
        "Driver party record not found. Cannot create user account.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Note: Driver model doesn't have organizationId field directly
    // Multi-tenancy can be handled through user relationship if needed
    // For now, we'll allow access if user has permission

    // Verify driver is in PENDING_INDUCTION status
    if (driver.driverStatus !== "PENDING_INDUCTION") {
      throw new AppError(
        `Driver is not in PENDING_INDUCTION status. Current status: ${driver.driverStatus}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // CRITICAL: Find or create user account
    // First try to find by driver.userId
    let driverUser = driver.userId ? await User.findById(driver.userId) : null;
    
    // If not found by userId, try to find by email
    if (!driverUser && driver.party?.email) {
      driverUser = await User.findOne({ email: driver.party.email.toLowerCase().trim() });
      if (driverUser) {
        console.log(`✅ Found existing user by email: ${driverUser.email} (userId: ${driverUser._id.toString()})`);
      }
    }

    if (!driverUser) {
      // User account doesn't exist - create it now
      const defaultPassword = "123456";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      // Get driver's email and name from party record
      const driverEmail = driver.party.email;
      const driverFirstName = driver.party.firstName || "";
      const driverLastName = driver.party.lastName || "";
      const driverFullName = `${driverFirstName} ${driverLastName}`.trim();

      if (!driverEmail) {
        throw new AppError(
          "Driver email is required. Please ensure party record has an email address.",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Generate username from email
      const emailPrefix = driverEmail.split("@")[0];
      const randomSuffix = Math.random().toString(36).substring(7);
      const username = `${emailPrefix}_${randomSuffix}`;

      // Create user account
      driverUser = await User.create({
        email: driverEmail,
        userName: username,
        password: passwordHash,
        fullName: driverFullName,
        name: driverFullName,
        role: "DRIVER",
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        passwordChangeRequired: true, // Driver must change password on first login
        isSuperAdmin: false,
        permissions: DRIVER_PORTAL_PERMISSIONS,
      });

      // Link user to driver record
      driver.userId = driverUser._id;

      console.log(
        `✅ Created user account for driver ${driver._id.toString()}: ${driverEmail}`
      );
    } else {
      // User account exists - update it to ACTIVE
      driverUser.status = "ACTIVE";
      driverUser.passwordChangeRequired = true; // Ensure password change is required
      driverUser.permissions = ensureDriverPermissions(driverUser.permissions);
      driverUser.role = "DRIVER"; // Ensure role is set
      await driverUser.save();

      // CRITICAL: Always ensure userId is linked (even if it was already set)
      driver.userId = driverUser._id;

      console.log(
        `✅ Updated existing user account for driver ${driver._id.toString()}: ${driverUser.email} (userId: ${driverUser._id.toString()})`
      );
    }

    // Update driver status - CRITICAL: Always use the driverUser._id we found/created
    driver.driverStatus = "COMPLIANT";
    driver.complianceStatus = "COMPLIANT";
    driver.isActive = true;
    driver.approvedAt = new Date();
    driver.approvedBy = user.id;
    driver.userId = driverUser._id; // CRITICAL: Always link to the user we found/created
    await driver.save();
    
    console.log(
      `✅ Driver record updated - Linking driver ${driver._id.toString()} to user ${driverUser._id.toString()} (${driverUser.email})`
    );

    // Verify driver status was saved correctly (will be reflected in login response)
    // Reload from database to confirm the save
    const savedDriver = await Driver.findById(driver._id)
      .select("driverStatus complianceStatus isActive userId")
      .lean();
    
    console.log(
      `✅ Driver induction approved - Status updated: driverStatus=${savedDriver.driverStatus}, complianceStatus=${savedDriver.complianceStatus}, isActive=${savedDriver.isActive}`
    );
    console.log(
      `✅ Driver userId linked: ${savedDriver.userId?.toString() || 'NOT LINKED'} (will be included in login response for userId: ${driverUser._id.toString()})`
    );
    
    // Verify the status was actually saved
    if (savedDriver.driverStatus !== "COMPLIANT" || savedDriver.complianceStatus !== "COMPLIANT" || !savedDriver.isActive) {
      console.error(`❌ ERROR: Driver status was not saved correctly! Expected COMPLIANT/COMPLIANT/true, got ${savedDriver.driverStatus}/${savedDriver.complianceStatus}/${savedDriver.isActive}`);
    }

    // Send approval email to driver with login credentials
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      
      await sendDriverInductionApprovedEmail({
        email: driver.party.email,
        firstName: driver.party.firstName || "",
        lastName: driver.party.lastName || "",
        username: driverUser.userName,
        password: "123456", // Default password - driver should change on first login
        loginUrl: `${frontendUrl}/login`,
        changePasswordUrl: `${frontendUrl}/profile`,
      });

      console.log(`✅ Sent approval email to driver: ${driver.party.email}`);
    } catch (emailError) {
      console.error("Error sending approval email:", emailError);
      // Continue even if email fails
    }

    return {
      success: true,
      message: "Driver induction approved successfully. User account created/activated.",
      driver: {
        id: driver._id.toString(),
        driverStatus: driver.driverStatus,
        complianceStatus: driver.complianceStatus,
        isActive: driver.isActive,
      },
      user: {
        id: driverUser._id.toString(),
        email: driverUser.email,
        username: driverUser.userName,
        status: driverUser.status,
        passwordChangeRequired: driverUser.passwordChangeRequired,
      },
      // Note: Password is NOT returned in response for security
      // Password (123456) is sent via email only
    };
  }

  /**
   * Sync/Fix driver-user link for existing drivers
   * This method helps fix drivers that were approved but the userId link is missing or incorrect
   * @param {string} userId - User ID to sync with driver
   * @returns {Object} Updated driver and user information
   */
  static async syncDriverUserLink(userId) {
    const User = require("../models/user.model");
    const Party = require("../models/party.model");

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (user.role !== "DRIVER") {
      throw new AppError("User is not a driver.", HttpStatusCodes.BAD_REQUEST);
    }

    // Find driver record - try by userId first, then by email via party
    let driver = await Driver.findOne({ userId: user._id }).populate("party");
    
    // If not found by userId, try to find by email via party
    if (!driver) {
      const party = await Party.findOne({ email: user.email }).select("_id").lean();
      if (party) {
        driver = await Driver.findOne({ partyId: party._id }).populate("party");
      }
    }
    
    if (!driver) {
      throw new AppError(
        "Driver record not found. Cannot sync driver-user link.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Ensure userId is linked
    const wasLinked = driver.userId && driver.userId.toString() === user._id.toString();
    driver.userId = user._id;
    await driver.save();

    // Reload to verify
    const savedDriver = await Driver.findById(driver._id)
      .select("driverStatus complianceStatus isActive userId")
      .lean();

    console.log(
      `✅ Driver-user link synced: driver ${driver._id.toString()} <-> user ${user._id.toString()} (${user.email})`
    );
    if (!wasLinked) {
      console.log(`   ⚠️ Link was missing and has been fixed!`);
    }

    return {
      success: true,
      message: wasLinked 
        ? "Driver-user link already exists and is correct." 
        : "Driver-user link has been fixed.",
      driver: {
        id: savedDriver._id.toString(),
        driverStatus: savedDriver.driverStatus,
        complianceStatus: savedDriver.complianceStatus,
        isActive: savedDriver.isActive,
        userId: savedDriver.userId?.toString() || null,
      },
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  // ==================== RCTI LOGS ====================

  static async getRCTILogs(query, user) {
    const RCTILog = require("../models/rctiLog.model");
    const { driverId } = query;

    // Build query
    const queryObj = {};

    // Filter by driver if provided
    if (driverId) {
      queryObj.driverId = driverId;
    }

    // Multi-tenant: Filter by organization if not super admin
    if (!user.isSuperAdmin && user.activeOrganizationId) {
      queryObj.organizationId = user.activeOrganizationId;
    }

    // Get RCTI logs
    const logs = await RCTILog.find(queryObj)
      .populate("driverId", "partyId")
      .sort({ sentAt: -1 })
      .lean();

    // Format response
    return logs.map((log) => ({
      id: log._id.toString(),
      driverId: log.driverId ? log.driverId._id.toString() : log.driverId.toString(),
      driverName: log.driverName,
      rctiNumber: log.rctiNumber,
      payrunId: log.payrunId ? log.payrunId.toString() : log.payrunId,
      payRunNumber: log.payRunNumber,
      sentTo: log.sentTo,
      sentAt: log.sentAt ? log.sentAt.toISOString() : null,
      status: log.status,
      autoSent: log.autoSent,
      periodStart: log.periodStart.toISOString(),
      periodEnd: log.periodEnd.toISOString(),
      totalAmount: log.totalAmount,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString(),
    }));
  }

  static async sendRCTIs(payRunId, data, user) {
    const PayRun = require("../models/payRun.model");
    const PayRunDriver = require("../models/payRunDriver.model");
    const Driver = require("../models/driver.model");
    const Party = require("../models/party.model");
    const RCTILog = require("../models/rctiLog.model");
    const { sendRCTIEmail } = require("../utils/email");
    const AppError = require("../utils/AppError");
    const HttpStatusCodes = require("../enums/httpStatusCode");

    const { driverIds } = data || {};

    // Verify pay run exists and belongs to organization
    const organizationId = user.activeOrganizationId || null;
    const filter = {
      _id: new mongoose.Types.ObjectId(payRunId),
    };

    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    const payRun = await PayRun.findOne(filter).lean();
    if (!payRun) {
      throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
    }

    // Verify pay run is posted
    if (payRun.status !== "POSTED") {
      throw new AppError(
        "RCTIs can only be sent for posted pay runs",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Get all pay run drivers first (to validate driverIds if provided)
    const allPayRunDrivers = await PayRunDriver.find({
      payrunId: new mongoose.Types.ObjectId(payRunId),
    })
      .populate({
        path: "driverId",
        populate: {
          path: "partyId",
          model: "Party",
        },
      })
      .lean();

    if (allPayRunDrivers.length === 0) {
      throw new AppError(
        "No drivers found in this pay run",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Filter drivers if specific IDs provided
    let targetPayRunDrivers = allPayRunDrivers;
    if (driverIds && Array.isArray(driverIds) && driverIds.length > 0) {
      // Convert driverIds to ObjectIds
      const objectIdDriverIds = driverIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (objectIdDriverIds.length === 0) {
        throw new AppError(
          "All driver IDs must be valid ObjectIds",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Validate all specified drivers belong to pay run
      const payRunDriverIds = allPayRunDrivers.map((d) =>
        d.driverId ? d.driverId._id.toString() : d.driverId.toString()
      );
      const invalidIds = objectIdDriverIds.filter(
        (id) => !payRunDriverIds.includes(id.toString())
      );

      if (invalidIds.length > 0) {
        const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
        error.errors = [
          {
            field: "driverIds",
            message: `The following driver IDs are not in this pay run: ${invalidIds.map((id) => id.toString()).join(", ")}`,
          },
        ];
        throw error;
      }

      // Filter to specified drivers
      targetPayRunDrivers = allPayRunDrivers.filter((d) => {
        const driverIdStr = d.driverId
          ? d.driverId._id.toString()
          : d.driverId.toString();
        return objectIdDriverIds.some((id) => id.toString() === driverIdStr);
      });
    }

    console.log(
      `Found ${allPayRunDrivers.length} total drivers, ${targetPayRunDrivers.length} target drivers`
    );

    let sentCount = 0;
    let errorCount = 0;
    const sentDrivers = [];
    const failedDrivers = [];

    // Filter to RCTI-eligible drivers
    const eligiblePayRunDrivers = targetPayRunDrivers.filter((payRunDriver) => {
      const driver = payRunDriver.driverId;
      if (!driver) {
        return false;
      }

      const party = driver.partyId;

      // Check RCTI eligibility criteria
      // 1. Must have valid email address
      if (!party || !party.email || !party.email.trim()) {
        return false;
      }

      // 2. Must have payments in pay run (totalAmount > 0)
      const totalAmount = parseFloat(
        payRunDriver.totalAmount || payRunDriver.netPay || 0
      );
      if (totalAmount <= 0) {
        return false;
      }

      // 3. Must be active
      if (driver.isActive !== true) {
        return false;
      }

      // 4. Must not be excluded (if excludeFromRCTI field exists)
      if (driver.excludeFromRCTI === true) {
        return false;
      }

      return true;
    });

    console.log(
      `Eligible drivers: ${eligiblePayRunDrivers.length} out of ${targetPayRunDrivers.length}`
    );

    // Process each eligible driver
    for (const payRunDriver of eligiblePayRunDrivers) {
      const driver = payRunDriver.driverId;
      const party = driver.partyId;

      let rctiLog = null;

      try {
        // Validate email exists (should already be checked, but double-check)
        if (!party || !party.email || !party.email.trim()) {
          throw new Error("Driver email not found");
        }

        // Generate unique RCTI number
        const rctiNumber = await this.generateRCTINumber(
          payRun.organizationId || user.activeOrganizationId
        );

        // Get driver name
        const driverName =
          party.companyName ||
          (party.firstName && party.lastName
            ? `${party.firstName} ${party.lastName}`.trim()
            : party.contactName || "Driver");

        // Get driver code
        const driverCode = driver.driverCode || "N/A";

        // Get organization ID for multi-tenancy (use payRun's organizationId or user's)
        const rctiOrganizationId =
          payRun.organizationId || user.activeOrganizationId || null;

        // Get total amount (use netPay or totalAmount)
        const totalAmount = parseFloat(
          payRunDriver.totalAmount || payRunDriver.netPay || 0
        );

        // Create RCTI log record
        rctiLog = await RCTILog.create({
          driverId: driver._id,
          driverName: driverName,
          rctiNumber: rctiNumber,
          payrunId: new mongoose.Types.ObjectId(payRunId),
          payRunNumber: payRun.payRunNumber,
          sentTo: party.email,
          sentAt: null, // Will be set after successful send
          status: "pending",
          autoSent: false,
          periodStart: payRun.periodStart,
          periodEnd: payRun.periodEnd,
          totalAmount: totalAmount.toString(),
          errorMessage: null,
          organizationId: rctiOrganizationId
            ? new mongoose.Types.ObjectId(rctiOrganizationId)
            : null,
        });

        // Generate RCTI PDF (placeholder - implement PDF generation)
        // const rctiPdf = await this.generateRCTIPDF({...});

        // Send RCTI email
        await sendRCTIEmail({
          email: party.email,
          rctiNumber: rctiNumber,
          driverName: driverName,
          payRunNumber: payRun.payRunNumber,
          periodStart: payRun.periodStart,
          periodEnd: payRun.periodEnd,
          totalAmount: totalAmount.toString(),
          // attachment: rctiPdf, // Uncomment when PDF generation is implemented
          // attachmentName: `RCTI-${rctiNumber}.pdf`,
        });

        // Update log as successful
        await RCTILog.findByIdAndUpdate(rctiLog._id, {
          status: "success",
          sentAt: new Date(),
        });

        sentCount++;
        sentDrivers.push({
          driverId: driver._id.toString(),
          driverCode: driverCode,
          driverName: driverName,
          email: party.email,
        });
      } catch (error) {
        console.error(
          `Error sending RCTI to driver ${driver._id}:`,
          error
        );

        // Get driver code and name for error response
        const driverCode = driver.driverCode || "N/A";
        const driverName =
          party && party.companyName
            ? party.companyName
            : party && party.firstName && party.lastName
            ? `${party.firstName} ${party.lastName}`.trim()
            : party && party.contactName
            ? party.contactName
            : "Driver";

        // Extract detailed error message
        let errorMessage = "Failed to send RCTI email";
        if (error.message) {
          errorMessage = error.message;
        } else if (error.code === "SENDGRID_UNAUTHORIZED") {
          errorMessage = "Unauthorized: SendGrid API key is invalid or missing";
        } else if (error.code === "SENDGRID_NOT_CONFIGURED") {
          errorMessage = "SendGrid API key is not configured";
        } else if (error.response && error.response.body) {
          const body = error.response.body;
          if (body.errors && body.errors.length > 0) {
            errorMessage = body.errors.map((e) => e.message).join(", ");
          }
        }

        // Update log as failed
        if (rctiLog) {
          await RCTILog.findByIdAndUpdate(rctiLog._id, {
            status: "failed",
            sentAt: new Date(),
            errorMessage: errorMessage,
          });
        }

        errorCount++;
        failedDrivers.push({
          driverId: driver._id.toString(),
          driverCode: driverCode,
          driverName: driverName,
          error: errorMessage,
        });
      }
    }

    console.log(
      `RCTI Summary: Total drivers: ${allPayRunDrivers.length}, Eligible: ${eligiblePayRunDrivers.length}, Sent: ${sentCount}, Errors: ${errorCount}`
    );

    return {
      success: true,
      data: {
        payRunId: payRun._id.toString(),
        totalDrivers: allPayRunDrivers.length,
        eligibleDrivers: eligiblePayRunDrivers.length,
        sentCount: sentCount,
        errorCount: errorCount,
        failedDrivers: failedDrivers,
        sentDrivers: sentDrivers,
        message: "RCTIs sent successfully",
      },
    };
  }

  static async generateRCTINumber(organizationId) {
    const RCTILog = require("../models/rctiLog.model");
    const year = new Date().getFullYear();
    const prefix = `RCTI-${year}-`;

    // Build query to find last RCTI number for this year and organization
    const query = {
      rctiNumber: { $regex: `^${prefix}` },
    };

    // Filter by organization if provided (for multi-tenancy)
    if (organizationId) {
      query.organizationId = organizationId;
    }

    // Get the last RCTI number for this year and organization
    const lastLog = await RCTILog.findOne(query)
      .sort({ createdAt: -1 })
      .lean();

    let sequence = 1;
    if (lastLog && lastLog.rctiNumber) {
      const lastSequence = parseInt(
        lastLog.rctiNumber.replace(prefix, ""),
        10
      );
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    return `${prefix}${sequence.toString().padStart(3, "0")}`;
  }

  // ==================== DRIVER UPLOADS ====================

  static async getDriverUploads(driverId, user) {
    const Driver = require("../models/driver.model");
    const DriverDocument = require("../models/driverDocument.model");
    const AppError = require("../utils/AppError");
    const HttpStatusCodes = require("../enums/httpStatusCode");

    // Verify driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    // Note: Drivers don't have organizationId directly, so we'll allow access for now
    // In production, you might want to add organizationId to Driver model or filter through UserOrganization

    // Map documentType to policyType
    const documentTypeToPolicyType = {
      LICENSE_FRONT: "drivers-licence",
      LICENSE_BACK: "drivers-licence",
      MOTOR_INSURANCE: "motor-insurance",
      MARINE_CARGO_INSURANCE: "marine-cargo-insurance",
      PUBLIC_LIABILITY: "public-liability-insurance",
      WORKERS_COMP: "workers-compensation",
      POLICE_CHECK: "police-check",
    };

    // Get driver documents using the driver's ObjectId for consistency
    // Documents may have been stored with driver._id (ObjectId) or driverId (string)
    // Try both formats to ensure we get all documents
    let documents = await DriverDocument.find({ 
      $or: [
        { driverId: driver._id }, // ObjectId format (from induction form)
        { driverId: driverId }, // String format (from upload endpoint)
      ]
    })
      .populate("reviewedBy", "fullName email")
      .sort({ uploadedAt: -1, createdAt: -1 }) // Sort by uploadedAt, fallback to createdAt
      .lean();
    
    // If no documents found, try a more flexible query
    if (documents.length === 0) {
      documents = await DriverDocument.find({
        driverId: { $in: [driver._id, driverId, driver._id.toString()] }
      })
        .populate("reviewedBy", "fullName email")
        .sort({ uploadedAt: -1, createdAt: -1 })
        .lean();
    }

    // Format response
    return documents.map((doc) => {
      const policyType =
        documentTypeToPolicyType[doc.documentType] || doc.documentType.toLowerCase().replace(/_/g, "-");

      return {
        id: doc._id.toString(),
        driverId: doc.driverId ? doc.driverId.toString() : driverId,
        policyType: policyType,
        documentUrl: doc.fileUrl || doc.documentUrl || "",
        status: doc.status || "PENDING",
        uploadedAt: doc.uploadedAt 
          ? doc.uploadedAt.toISOString() 
          : (doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString()),
        reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
        reviewedBy: doc.reviewedBy 
          ? (doc.reviewedBy._id ? doc.reviewedBy._id.toString() : doc.reviewedBy.toString())
          : null,
        fileName: doc.fileName || "unknown",
        fileSize: doc.fileSize || 0,
        mimeType: doc.mimeType || "application/octet-stream",
      };
    });
  }
}

module.exports = MasterDataService;

