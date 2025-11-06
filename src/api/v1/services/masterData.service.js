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
const CustomerDocument = require("../models/customerDocument.model");
const CustomerLinkedDocument = require("../models/customerLinkedDocument.model");
const OperationsContact = require("../models/operationsContact.model");
const BillingContact = require("../models/billingContact.model");
const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");
const { uploadFileToS3 } = require("./aws.service");
const { sendDriverApplicationEmail, sendDriverInductionSubmittedEmail } = require("../utils/email");

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

  static async createDriver(data) {
    // Create or find party
    let party = await Party.findOne({ email: data.party.email });
    if (!party) {
      party = await Party.create(data.party);
    } else {
      // Update party data
      Object.assign(party, data.party);
      await party.save();
    }

    // Generate driver code if not provided
    let driverCode = data.driverCode;
    if (!driverCode) {
      const count = await Driver.countDocuments();
      driverCode = `DRV${String(count + 1).padStart(4, "0")}`;
    }

    // Check uniqueness
    const existing = await Driver.findOne({ driverCode });
    if (existing) {
      throw new AppError(
        "Driver code already exists.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const driver = await Driver.create({
      partyId: party._id,
      driverCode,
      employmentType: data.employmentType || "CONTRACTOR",
      isActive: data.isActive !== undefined ? data.isActive : true,
      licenseExpiry: data.licenseExpiry,
      motorInsuranceExpiry: data.motorInsuranceExpiry,
      publicLiabilityExpiry: data.publicLiabilityExpiry,
      marineCargoExpiry: data.marineCargoExpiry,
      workersCompExpiry: data.workersCompExpiry,
      ...data,
    });

    const populated = await Driver.findById(driver._id).populate("party");

    return {
      success: true,
      message: "Driver created successfully",
      driver: {
        id: populated._id.toString(),
        party: populated.party,
        ...populated.toObject(),
      },
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

    // Update party if provided
    if (data.party && driver.party) {
      Object.assign(driver.party, data.party);
      await driver.party.save();
    }

    // Update driver fields
    const driverFields = { ...data };
    delete driverFields.party;

    Object.assign(driver, driverFields);
    await driver.save();

    const populated = await Driver.findById(driver._id).populate("party");

    return {
      success: true,
      message: "Driver updated successfully",
      driver: {
        id: populated._id.toString(),
        party: populated.party,
        ...populated.toObject(),
      },
    };
  }

  // ==================== DRIVER RATES ====================

  static async getDriverRates(driverId) {
    const rates = await DriverRate.find({ driverId })
      .sort({ createdAt: -1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      driverId: rate.driverId.toString(),
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      payPerHour: rate.payPerHour,
      rateType: rate.rateType,
      laneKey: rate.laneKey,
      flatRate: rate.flatRate,
      isLocked: rate.isLocked,
      createdAt: rate.createdAt,
    }));
  }

  static async createDriverRate(driverId, data) {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError("Driver not found.", HttpStatusCodes.NOT_FOUND);
    }

    const rate = await DriverRate.create({
      driverId,
      ...data,
    });

    return {
      success: true,
      message: "Driver rate created successfully",
      rate: {
        id: rate._id.toString(),
        ...rate.toObject(),
      },
    };
  }

  static async updateDriverRate(driverId, rateId, data) {
    const rate = await DriverRate.findOne({
      _id: rateId,
      driverId,
    });

    if (!rate) {
      throw new AppError("Driver rate not found.", HttpStatusCodes.NOT_FOUND);
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
      message: "Driver rate updated successfully",
      rate: rate.toObject(),
    };
  }

  static async deleteDriverRate(driverId, rateId) {
    const rate = await DriverRate.findOne({
      _id: rateId,
      driverId,
    });

    if (!rate) {
      throw new AppError("Driver rate not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (rate.isLocked) {
      throw new AppError(
        "Cannot delete locked rate.",
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
    await DriverRate.updateMany({ driverId }, { isLocked: true });

    return {
      success: true,
      message: "Driver rates locked successfully",
    };
  }

  static async unlockDriverRates(driverId) {
    await DriverRate.updateMany({ driverId }, { isLocked: false });

    return {
      success: true,
      message: "Driver rates unlocked successfully",
    };
  }

  static async applyCPIToDriverRates(driverId, percentage, effectiveFrom, createNewVersion) {
    const rates = await DriverRate.find({
      driverId,
      isLocked: false,
    });

    if (createNewVersion) {
      // Create new versions with updated rates
      const newRates = rates.map((rate) => ({
        ...rate.toObject(),
        _id: new mongoose.Types.ObjectId(),
        payPerHour: rate.payPerHour
          ? (rate.payPerHour * (1 + percentage / 100)).toFixed(2)
          : null,
        flatRate: rate.flatRate
          ? (rate.flatRate * (1 + percentage / 100)).toFixed(2)
          : null,
        createdAt: new Date(),
      }));

      await DriverRate.insertMany(newRates);
    } else {
      // Update in place
      await DriverRate.updateMany(
        { driverId, isLocked: false },
        [
          {
            $set: {
              payPerHour: {
                $cond: [
                  { $ne: ["$payPerHour", null] },
                  { $multiply: ["$payPerHour", 1 + percentage / 100] },
                  null,
                ],
              },
              flatRate: {
                $cond: [
                  { $ne: ["$flatRate", null] },
                  { $multiply: ["$flatRate", 1 + percentage / 100] },
                  null,
                ],
              },
            },
          },
        ]
      );
    }

    return {
      success: true,
      message: "CPI increase applied successfully",
      updated: rates.length,
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
      party: customer.party
        ? {
            id: customer.party._id.toString(),
            companyName: customer.party.companyName,
            email: customer.party.email,
            phone: customer.party.phone,
            contactName: customer.party.contactName,
            suburb: customer.party.suburb,
            state: customer.party.state,
            postcode: customer.party.postcode,
          }
        : null,
      isActive: customer.isActive,
      createdAt: customer.createdAt,
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
    let houseDriver = await Driver.findOne({ driverCode: "HOUSE" });
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
    let houseDriver = await Driver.findOne({ driverCode: "HOUSE" });
    if (!houseDriver) {
      const Party = require("../models/party.model");
      const party = await Party.create({
        companyName: "House Driver",
        email: "house@system.local",
      });
      houseDriver = await Driver.create({
        partyId: party._id,
        driverCode: "HOUSE",
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
      .sort({ createdAt: -1 })
      .lean();

    return rates.map((rate) => ({
      id: rate._id.toString(),
      serviceCode: rate.serviceCode,
      vehicleType: rate.vehicleType,
      rateExGst: rate.rateExGst,
      effectiveFrom: rate.effectiveFrom,
      description: rate.description,
      createdAt: rate.createdAt,
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
}

module.exports = MasterDataService;

