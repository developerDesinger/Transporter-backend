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
const { sendDriverApplicationEmail, sendDriverInductionSubmittedEmail, sendCustomerOnboardingEmail, sendLinkedDocumentEmail } = require("../utils/email");
const path = require("path");
const fs = require("fs").promises;

class MasterDataService {
  // ==================== DRIVERS ====================

  static async getAllDrivers(query) {
    const filter = {};

    if (query.status === "active") {
      filter.isActive = true;
    } else if (query.status === "inactive") {
      filter.isActive = false;
    }

    const drivers = await Driver.find(filter)
      .populate("party")
      .sort({ createdAt: -1 })
      .lean();

    return drivers.map((driver) => ({
      id: driver._id.toString(),
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
      employmentType: driver.employmentType,
      isActive: driver.isActive,
      driverCode: driver.driverCode,
      licenseExpiry: driver.licenseExpiry,
      motorInsuranceExpiry: driver.motorInsuranceExpiry,
      publicLiabilityExpiry: driver.publicLiabilityExpiry,
      marineCargoExpiry: driver.marineCargoExpiry,
      workersCompExpiry: driver.workersCompExpiry,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
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
      vehicleType: rate.vehicleType,
      payPerHour: rate.payPerHour ? rate.payPerHour.toString() : null,
      payFtl: rate.flatRate ? rate.flatRate.toString() : null,
      rateType: rate.rateType,
      laneKey: rate.laneKey || null,
      lockedAt: rate.lockedAt ? rate.lockedAt.toISOString() : null,
      effectiveFrom: rate.effectiveFrom ? rate.effectiveFrom.toISOString() : rate.createdAt.toISOString(),
      effectiveTo: rate.effectiveTo ? rate.effectiveTo.toISOString() : null,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
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

    // Update party if provided
    if (data.party && customer.party) {
      Object.assign(customer.party, data.party);
      await customer.party.save();
    }

    // Update customer fields
    const customerFields = { ...data };
    delete customerFields.party;

    Object.assign(customer, customerFields);
    await customer.save();

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

  static async getAllRateCards(query) {
    const filter = {};

    if (query.customerId) {
      filter.customerId = query.customerId;
    }

    if (query.rateType) {
      filter.rateType = query.rateType;
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
      rateExGst: card.rateExGst,
      effectiveFrom: card.effectiveFrom,
      description: card.description,
      isLocked: card.isLocked,
      createdAt: card.createdAt,
    }));
  }

  static async createRateCard(data) {
    const rateCard = await RateCard.create(data);

    return {
      success: true,
      message: "Rate card created successfully",
      rateCard: rateCard.toObject(),
    };
  }

  static async updateRateCard(rateCardId, data) {
    const rateCard = await RateCard.findById(rateCardId);

    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rateCard.isLocked) {
      throw new AppError(
        "Cannot update locked rate card.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    Object.assign(rateCard, data);
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

    rateCard.isLocked = true;
    await rateCard.save();

    return {
      success: true,
      message: "Rate card locked successfully",
    };
  }

  static async unlockRateCard(rateCardId) {
    const rateCard = await RateCard.findById(rateCardId);
    if (!rateCard) {
      throw new AppError("Rate card not found.", HttpStatusCodes.NOT_FOUND);
    }

    rateCard.isLocked = false;
    await rateCard.save();

    return {
      success: true,
      message: "Rate card unlocked successfully",
    };
  }

  static async applyCPIToRateCards(percentage, effectiveFrom, createNewVersion, rateType) {
    const filter = { isLocked: false };
    if (rateType) {
      filter.rateType = rateType;
    }

    const rateCards = await RateCard.find(filter);

    if (createNewVersion) {
      const newRates = rateCards.map((card) => ({
        ...card.toObject(),
        _id: new mongoose.Types.ObjectId(),
        rateExGst: parseFloat((card.rateExGst * (1 + percentage / 100)).toFixed(2)),
        createdAt: new Date(),
      }));

      await RateCard.insertMany(newRates);
    } else {
      // Update in place using aggregation pipeline
      for (const card of rateCards) {
        card.rateExGst = parseFloat((card.rateExGst * (1 + percentage / 100)).toFixed(2));
        await card.save();
      }
    }

    return {
      success: true,
      message: "CPI increase applied successfully",
      updated: rateCards.length,
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
          description: row.description || "",
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

  static async copyFTLRatesToDriverPay() {
    // Find house driver (customerId = null for FTL rates)
    const ftlRates = await RateCard.find({
      rateType: "FTL",
      customerId: null, // House rates
    });

    // Find or create house driver
    const Driver = require("../models/driver.model");
    let houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      // Create house driver if doesn't exist
      const Party = require("../models/party.model");
      const party = await Party.create({
        companyName: "House Driver",
        email: "house@system.local",
      });
      houseDriver = await Driver.create({
        partyId: party._id,
        driverCode: "HOUSE",
        contactType: "house",
        employmentType: "EMPLOYEE",
        isActive: true,
      });
    }

    let copied = 0;
    for (const rate of ftlRates) {
      // Check if driver rate already exists
      const existing = await DriverRate.findOne({
        driverId: houseDriver._id,
        rateType: "FTL",
        vehicleType: rate.vehicleType,
        laneKey: rate.laneKey,
      });

      if (!existing) {
        await DriverRate.create({
          driverId: houseDriver._id,
          rateType: "FTL",
          vehicleType: rate.vehicleType,
          laneKey: rate.laneKey,
          flatRate: rate.rateExGst,
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copied++;
      }
    }

    return {
      success: true,
      message: "FTL rates copied to driver pay rates",
      copied,
    };
  }

  static async copyHourlyRatesToDriverPay() {
    // Find house driver
    const Driver = require("../models/driver.model");
    let houseDriver = await Driver.findOne({ contactType: "house" });
    if (!houseDriver) {
      const Party = require("../models/party.model");
      const party = await Party.create({
        companyName: "House Driver",
        email: "house@system.local",
      });
      houseDriver = await Driver.create({
        partyId: party._id,
        driverCode: "HOUSE",
        contactType: "house",
        employmentType: "EMPLOYEE",
        isActive: true,
      });
    }

    // Find hourly house rates (customerId = null for hourly rates)
    const hourlyRates = await RateCard.find({
      rateType: "HOURLY",
      customerId: null,
    });

    let copied = 0;
    for (const rate of hourlyRates) {
      // Check if driver rate already exists
      const existing = await DriverRate.findOne({
        driverId: houseDriver._id,
        rateType: "HOURLY",
        serviceCode: rate.serviceCode,
        vehicleType: rate.vehicleType,
      });

      if (!existing) {
        await DriverRate.create({
          driverId: houseDriver._id,
          rateType: "HOURLY",
          serviceCode: rate.serviceCode,
          vehicleType: rate.vehicleType,
          payPerHour: rate.rateExGst,
          isLocked: false,
          lockedAt: null,
          effectiveFrom: new Date(),
          effectiveTo: null,
        });
        copied++;
      }
    }

    return {
      success: true,
      message: "Hourly rates copied to driver pay rates",
      copied,
    };
  }

  // ==================== HOURLY HOUSE RATES ====================
  static async getAllHourlyHouseRates() {
    const rates = await RateCard.find({
      customerId: null,
      rateType: "HOURLY",
    })
      .sort({ serviceCode: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      customerId: null, // Always null for house rates
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

  // ==================== FTL HOUSE RATES ====================
  static async getFtlHouseRates() {
    const rates = await RateCard.find({
      customerId: null,
      rateType: "FTL",
    })
      .sort({ laneKey: 1, vehicleType: 1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      customerId: null, // Always null for house rates
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

  static async updateHourlyHouseRate(rateId, data) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "HOURLY",
    });

    if (!rate) {
      throw new AppError("Hourly house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked) {
      throw new AppError(
        "Cannot update locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    Object.assign(rate, data);
    await rate.save();

    return {
      success: true,
      message: "Hourly house rate updated successfully",
      rate: rate.toObject(),
    };
  }

  static async deleteHourlyHouseRate(rateId) {
    const rate = await RateCard.findOne({
      _id: rateId,
      customerId: null,
      rateType: "HOURLY",
    });

    if (!rate) {
      throw new AppError("Hourly house rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked) {
      throw new AppError(
        "Cannot delete locked rate.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    await RateCard.findByIdAndDelete(rateId);

    return {
      success: true,
      message: "Hourly house rate deleted successfully",
    };
  }

  // ==================== FUEL LEVIES ====================

  static async getAllFuelLevies() {
    const levies = await FuelLevy.find().sort({ effectiveFrom: -1 }).lean();

    return levies.map((levy) => ({
      id: levy._id.toString(),
      rateType: levy.rateType,
      percentage: levy.percentage,
      effectiveFrom: levy.effectiveFrom,
      effectiveTo: levy.effectiveTo,
      isActive: levy.isActive,
      createdAt: levy.createdAt,
    }));
  }

  static async getCurrentFuelLevy(rateType = null) {
    const filter = {
      isActive: true,
      effectiveFrom: { $lte: new Date() },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
    };

    if (rateType) {
      filter.rateType = rateType;
    }

    const levy = await FuelLevy.findOne(filter).sort({ effectiveFrom: -1 });

    if (!levy) {
      throw new AppError("No active fuel levy found.", HttpStatusCodes.NOT_FOUND);
    }

    return {
      id: levy._id.toString(),
      rateType: levy.rateType,
      percentage: levy.percentage,
      effectiveFrom: levy.effectiveFrom,
      effectiveTo: levy.effectiveTo,
      isActive: levy.isActive,
    };
  }

  static async getCurrentFuelLevies() {
    // Get current fuel levies for both rate types
    const hourlyLevy = await FuelLevy.findOne({
      rateType: "HOURLY",
      isActive: true,
      effectiveFrom: { $lte: new Date() },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
    }).sort({ effectiveFrom: -1 });

    const ftlLevy = await FuelLevy.findOne({
      rateType: "FTL",
      isActive: true,
      effectiveFrom: { $lte: new Date() },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
    }).sort({ effectiveFrom: -1 });

    return {
      hourly: hourlyLevy
        ? {
            id: hourlyLevy._id.toString(),
            rateType: hourlyLevy.rateType,
            percentage: hourlyLevy.percentage || 0,
            effectiveFrom: hourlyLevy.effectiveFrom,
            effectiveTo: hourlyLevy.effectiveTo,
            isActive: hourlyLevy.isActive,
          }
        : null,
      ftl: ftlLevy
        ? {
            id: ftlLevy._id.toString(),
            rateType: ftlLevy.rateType,
            percentage: ftlLevy.percentage || 0,
            effectiveFrom: ftlLevy.effectiveFrom,
            effectiveTo: ftlLevy.effectiveTo,
            isActive: ftlLevy.isActive,
          }
        : null,
    };
  }

  static async createFuelLevy(data) {
    const { rateType, effectiveFrom } = data;

    // Deactivate previous active levy for this rateType
    await FuelLevy.updateMany(
      { rateType, isActive: true },
      { isActive: false, effectiveTo: effectiveFrom || new Date() }
    );

    const levy = await FuelLevy.create({
      ...data,
      isActive: true,
    });

    return {
      success: true,
      message: "Fuel levy created successfully",
      fuelLevy: levy.toObject(),
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

  static async getAllServiceCodes() {
    const codes = await ServiceCode.find().sort({ code: 1 }).lean();

    return codes.map((code) => ({
      id: code._id.toString(),
      code: code.code,
      name: code.name,
      description: code.description,
      vehicleClass: code.vehicleClass,
      body: code.body,
      pallets: code.pallets,
      features: code.features,
      isActive: code.isActive,
      createdAt: code.createdAt,
    }));
  }

  static async createServiceCode(data) {
    const code = await ServiceCode.create(data);

    return {
      success: true,
      message: "Service code created successfully",
      serviceCode: code.toObject(),
    };
  }

  static async updateServiceCode(codeId, data) {
    const code = await ServiceCode.findById(codeId);
    if (!code) {
      throw new AppError("Service code not found.", HttpStatusCodes.NOT_FOUND);
    }

    Object.assign(code, data);
    await code.save();

    return {
      success: true,
      message: "Service code updated successfully",
      serviceCode: code.toObject(),
    };
  }

  static async deleteServiceCode(codeId) {
    const code = await ServiceCode.findById(codeId);
    if (!code) {
      throw new AppError("Service code not found.", HttpStatusCodes.NOT_FOUND);
    }

    await ServiceCode.findByIdAndDelete(codeId);

    return {
      success: true,
      message: "Service code deleted successfully",
    };
  }

  // ==================== ANCILLARIES ====================

  static async getAllAncillaries() {
    const ancillaries = await Ancillary.find().sort({ code: 1 }).lean();

    return ancillaries.map((ancillary) => ({
      id: ancillary._id.toString(),
      code: ancillary.code,
      name: ancillary.name,
      description: ancillary.description,
      rateType: ancillary.rateType,
      rate: ancillary.rate,
      unit: ancillary.unit,
      isActive: ancillary.isActive,
      createdAt: ancillary.createdAt,
    }));
  }

  static async createAncillary(data) {
    const ancillary = await Ancillary.create(data);

    return {
      success: true,
      message: "Ancillary created successfully",
      ancillary: ancillary.toObject(),
    };
  }

  static async updateAncillary(ancillaryId, data) {
    const ancillary = await Ancillary.findById(ancillaryId);
    if (!ancillary) {
      throw new AppError("Ancillary not found.", HttpStatusCodes.NOT_FOUND);
    }

    Object.assign(ancillary, data);
    await ancillary.save();

    return {
      success: true,
      message: "Ancillary updated successfully",
      ancillary: ancillary.toObject(),
    };
  }

  static async deleteAncillary(ancillaryId) {
    const ancillary = await Ancillary.findById(ancillaryId);
    if (!ancillary) {
      throw new AppError("Ancillary not found.", HttpStatusCodes.NOT_FOUND);
    }

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

  static async getAllVehicleTypes() {
    const types = await VehicleType.find().sort({ sortOrder: 1, code: 1 }).lean();

    return types.map((type) => ({
      id: type._id.toString(),
      code: type.code,
      fullName: type.fullName,
      sortOrder: type.sortOrder,
    }));
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

    // Email uniqueness check (only if creating new user)
    const existingUser = await User.findOne({ email: data.email });
    if (existingUser && existingUser.status !== "PENDING_INDUCTION") {
      errors.push({
        field: "email",
        message: "Email already registered",
      });
    }

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

    // Create or update user account
    let user = existingUser;
    if (!user || user.status === "PENDING_INDUCTION") {
      if (user) {
        // Update existing user from initial application
        user.userName = data.username || user.userName || data.email.split("@")[0];
        user.password = passwordHash;
        user.fullName = data.fullName || `${data.firstName} ${data.lastName}`;
        user.name = data.fullName || `${data.firstName} ${data.lastName}`;
        user.role = data.role || "DRIVER";
        user.status = "PENDING_APPROVAL";
        user.approvalStatus = "PENDING";
        user.passwordChangeRequired = true;
        await user.save();
      } else {
        // Create new user
        user = await User.create({
          email: data.email,
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
    } else {
      throw new AppError("Email already registered", HttpStatusCodes.BAD_REQUEST);
    }

    // Create party record
    const party = await Party.create({
      firstName: data.firstName,
      lastName: data.lastName,
      companyName: data.companyName,
      email: data.email,
      phone: data.phone,
      phoneAlt: data.phoneAlt,
      suburb: data.suburb,
      state: stateAbbrev,
      abn: data.abn,
    });

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

    // Create driver record
    const driver = await Driver.create({
      partyId: party._id,
      userId: user._id,
      driverCode,
      employmentType,
      isActive: false, // Inactive until admin approval
      contactType: data.contactType || "Pending Induction",
      complianceStatus: data.complianceStatus || "Pending Review",
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

    return {
      success: true,
      message: "Driver induction submitted successfully",
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        userName: user.userName,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
      driver: {
        id: driver._id.toString(),
        driverCode: driver.driverCode,
        partyId: party._id.toString(),
        employmentType: driver.employmentType,
        isActive: driver.isActive,
        contactType: driver.contactType,
        complianceStatus: driver.complianceStatus,
        createdAt: driver.createdAt,
      },
      documentsUploaded: uploadedDocuments.length,
    };
  }

  // ==================== RCTI LOGS ====================

  static async getRCTILogs(query, user) {
    const RCTILog = require("../models/rctiLog.model");
    const Driver = require("../models/driver.model");
    const { driverId } = query;

    // Build query
    const queryObj = {};

    // Filter by driver if provided
    if (driverId) {
      queryObj.driverId = driverId;
    }

    // Multi-tenant: Filter by organization if not super admin
    // Note: RCTI logs don't have organizationId directly, so we filter through drivers
    // For now, we'll return all logs (organization filtering can be added later when drivers have organizationId)

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
    const HttpStatusCodes = require("../utils/httpStatusCodes");

    const { driverIds } = data || {};

    // Verify pay run exists
    const payRun = await PayRun.findById(payRunId);
    if (!payRun) {
      throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check organization access (multi-tenant)
    if (
      !user.isSuperAdmin &&
      user.activeOrganizationId &&
      payRun.organizationId &&
      payRun.organizationId.toString() !== user.activeOrganizationId.toString()
    ) {
      throw new AppError(
        "Access denied to this pay run",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Get pay run drivers
    const payRunDriverQuery = { payrunId: payRunId };
    if (driverIds && Array.isArray(driverIds) && driverIds.length > 0) {
      payRunDriverQuery.driverId = { $in: driverIds };
    }

    const payRunDrivers = await PayRunDriver.find(payRunDriverQuery)
      .populate({
        path: "driverId",
        populate: {
          path: "partyId",
          model: "Party",
        },
      })
      .lean();

    if (payRunDrivers.length === 0) {
      throw new AppError(
        "No drivers found in this pay run",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    let sentCount = 0;
    let errorCount = 0;
    const logs = [];

    // Process each driver
    for (const payRunDriver of payRunDrivers) {
      const driver = payRunDriver.driverId;
      if (!driver) continue;

      // Check RCTI eligibility
      if (!driver.rctiAgreementAccepted || !driver.gstRegistered) {
        continue; // Skip drivers who haven't accepted RCTI agreement or aren't GST registered
      }

      let rctiLog = null;

      try {
        // Get driver party for email and name
        const party = await Party.findById(driver.partyId);
        if (!party || !party.email) {
          throw new Error("Driver email not found");
        }

        // Generate unique RCTI number
        const rctiNumber = await this.generateRCTINumber(
          payRun.organizationId || user.activeOrganizationId
        );

        // Get driver name
        const driverName =
          party.firstName && party.lastName
            ? `${party.firstName} ${party.lastName}`.trim()
            : party.companyName || party.contactName || "Driver";

        // Create RCTI log record
        rctiLog = await RCTILog.create({
          driverId: driver._id,
          driverName: driverName,
          rctiNumber: rctiNumber,
          payrunId: payRunId,
          payRunNumber: payRun.payRunNumber,
          sentTo: party.email,
          sentAt: null, // Will be set after successful send
          status: "pending",
          autoSent: false,
          periodStart: payRun.periodStart,
          periodEnd: payRun.periodEnd,
          totalAmount: payRunDriver.totalAmount
            ? payRunDriver.totalAmount.toString()
            : "0.00",
          errorMessage: null,
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
          totalAmount: payRunDriver.totalAmount
            ? payRunDriver.totalAmount.toString()
            : "0.00",
          // attachment: rctiPdf, // Uncomment when PDF generation is implemented
          // attachmentName: `RCTI-${rctiNumber}.pdf`,
        });

        // Update log as successful
        await RCTILog.findByIdAndUpdate(rctiLog._id, {
          status: "success",
          sentAt: new Date(),
        });

        sentCount++;
        logs.push({
          id: rctiLog._id.toString(),
          driverId: driver._id.toString(),
          status: "success",
          rctiNumber: rctiNumber,
        });
      } catch (error) {
        console.error(
          `Error sending RCTI to driver ${driver._id}:`,
          error
        );

        // Update log as failed
        if (rctiLog) {
          await RCTILog.findByIdAndUpdate(rctiLog._id, {
            status: "failed",
            sentAt: new Date(),
            errorMessage: error.message || "Failed to send RCTI email",
          });

          logs.push({
            id: rctiLog._id.toString(),
            driverId: driver._id.toString(),
            status: "failed",
            errorMessage: error.message || "Failed to send RCTI email",
          });
        }

        errorCount++;
      }
    }

    return {
      success: true,
      message: "RCTIs sent successfully",
      sentCount: sentCount,
      totaldrivers: payRunDrivers.length,
      errorCount: errorCount,
      logs: logs,
    };
  }

  static async generateRCTINumber(organizationId) {
    const RCTILog = require("../models/rctiLog.model");
    const year = new Date().getFullYear();
    const prefix = `RCTI-${year}-`;

    // Get the last RCTI number for this year and organization
    // Note: For now, we'll generate globally unique numbers
    // In production, you might want to filter by organizationId if added to RCTILog model
    const lastLog = await RCTILog.findOne({
      rctiNumber: { $regex: `^${prefix}` },
    })
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
}

module.exports = MasterDataService;

