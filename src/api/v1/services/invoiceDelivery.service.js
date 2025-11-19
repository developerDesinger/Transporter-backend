const mongoose = require("mongoose");
const InvoiceDeliveryEvent = require("../models/invoiceDeliveryEvent.model");
const InvoiceDeliveryEventLog = require("../models/invoiceDeliveryEventLog.model");
const Invoice = require("../models/invoice.model");
const Customer = require("../models/customer.model");
const Party = require("../models/party.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const DELIVERY_STATUSES = ["SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED"];
const TIME_RANGE_PRESETS = {
  LAST_7_DAYS: 7,
  LAST_14_DAYS: 14,
  LAST_30_DAYS: 30,
};
const WEBHOOK_EVENT_MAP = {
  delivered: "DELIVERED",
  open: "OPENED",
  opened: "OPENED",
  click: "CLICKED",
  clicked: "CLICKED",
  bounce: "BOUNCED",
  bounced: "BOUNCED",
};

const computeEngagementScore = ({ opensCount = 0, clicksCount = 0, currentStatus }) => {
  const bouncePenalty = currentStatus === "BOUNCED" ? 50 : 0;
  return opensCount * 20 + clicksCount * 30 - bouncePenalty;
};

const resolveDateRange = ({ from, to, timeRange }) => {
  let start;
  let end;

  if (from && to) {
    start = new Date(`${from}T00:00:00.000Z`);
    end = new Date(`${to}T23:59:59.999Z`);
  } else if (timeRange && TIME_RANGE_PRESETS[timeRange]) {
    end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (TIME_RANGE_PRESETS[timeRange] - 1));
    start.setUTCHours(0, 0, 0, 0);
  } else {
    // Default last 30 days
    end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 29);
    start.setUTCHours(0, 0, 0, 0);
  }

  if (start > end) {
    throw new AppError("from date must be before to date", HttpStatusCodes.BAD_REQUEST);
  }

  return { start, end };
};

const sanitizeOrganizationId = (userOrgId, providedOrgId) => {
  const orgId = providedOrgId || userOrgId;
  if (!orgId) {
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(orgId)) {
    throw new AppError("Invalid organization context", HttpStatusCodes.BAD_REQUEST);
  }
  return new mongoose.Types.ObjectId(orgId);
};

const appendLogEntry = async ({ deliveryEventId, organizationId, eventType, metadata = {}, providerPayload = {} }) => {
  await InvoiceDeliveryEventLog.create({
    deliveryEventId,
    organizationId,
    eventType,
    timestamp: new Date(),
    metadata,
    providerPayload,
  });
};

class InvoiceDeliveryService {
  static async getSummary(query, user) {
    const organizationId = sanitizeOrganizationId(user.activeOrganizationId, query.organizationId);
    const { start, end } = resolveDateRange(query);

    const match = {
      organizationId,
      sentAt: { $gte: start, $lte: end },
    };

    if (query.status) {
      if (!DELIVERY_STATUSES.includes(query.status)) {
        throw new AppError(`Invalid status. Must be one of ${DELIVERY_STATUSES.join(", ")}`, HttpStatusCodes.BAD_REQUEST);
      }
      match.currentStatus = query.status;
    }

    const summary = await InvoiceDeliveryEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSent: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $in: ["$currentStatus", ["DELIVERED", "OPENED", "CLICKED"]] }, 1, 0],
            },
          },
          opened: {
            $sum: {
              $cond: [{ $gt: ["$opensCount", 0] }, 1, 0],
            },
          },
          clicked: {
            $sum: {
              $cond: [{ $gt: ["$clicksCount", 0] }, 1, 0],
            },
          },
          bounced: {
            $sum: {
              $cond: [{ $eq: ["$currentStatus", "BOUNCED"] }, 1, 0],
            },
          },
          avgOpenMinutes: {
            $avg: {
              $cond: [
                { $and: ["$openedAt", "$sentAt"] },
                {
                  $divide: [{ $subtract: ["$openedAt", "$sentAt"] }, 1000 * 60],
                },
                null,
              ],
            },
          },
        },
      },
    ]);

    const data = summary[0] || {};
    const total = data.totalSent || 0;
    const openRate = total > 0 ? (data.opened || 0) / total : 0;
    const clickRate = total > 0 ? (data.clicked || 0) / total : 0;
    const bounceRate = total > 0 ? (data.bounced || 0) / total : 0;

    return {
      totalSent: total,
      delivered: data.delivered || 0,
      opened: data.opened || 0,
      clicked: data.clicked || 0,
      bounced: data.bounced || 0,
      avgOpenTimeMinutes: data.avgOpenMinutes ? Math.round(data.avgOpenMinutes) : 0,
      openRate: Number(openRate.toFixed(4)),
      clickRate: Number(clickRate.toFixed(4)),
      bounceRate: Number(bounceRate.toFixed(4)),
    };
  }

  static async getDeliveries(query, user) {
    const organizationId = sanitizeOrganizationId(user.activeOrganizationId, query.organizationId);
    const { start, end } = resolveDateRange(query);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy && ["sentAt", "opensCount", "clicksCount", "engagementScore"].includes(query.sortBy)
      ? query.sortBy
      : "sentAt";
    const direction = query.direction === "asc" ? 1 : -1;

    const filter = {
      organizationId,
      sentAt: { $gte: start, $lte: end },
    };

    if (query.status) {
      if (!DELIVERY_STATUSES.includes(query.status)) {
        throw new AppError(`Invalid status. Must be one of ${DELIVERY_STATUSES.join(", ")}`, HttpStatusCodes.BAD_REQUEST);
      }
      filter.currentStatus = query.status;
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      const regex = new RegExp(search, "i");

      const [matchingInvoicesByNumber, matchingParties] = await Promise.all([
        Invoice.find({ invoiceNo: regex }).select("_id").lean(),
        Party.find({
          $or: [
            { companyName: regex },
            { firstName: regex },
            { lastName: regex },
          ],
        })
          .select("_id")
          .lean(),
      ]);

      const matchingCustomers = await Customer.find({
        $or: [
          { legalCompanyName: regex },
          { tradingName: regex },
          { partyId: { $in: matchingParties.map((p) => p._id) } },
        ],
      })
        .select("_id")
        .lean();

      const invoiceIdsFromCustomers = await Invoice.find({
        customerId: { $in: matchingCustomers.map((c) => c._id) },
      })
        .select("_id")
        .lean();

      const invoiceIds = [
        ...matchingInvoicesByNumber.map((i) => i._id),
        ...invoiceIdsFromCustomers.map((i) => i._id),
      ];

      filter.$or = [
        { recipientEmail: regex },
        ...(invoiceIds.length > 0 ? [{ invoiceId: { $in: invoiceIds } }] : []),
      ];
    }

    const [total, deliveries] = await Promise.all([
      InvoiceDeliveryEvent.countDocuments(filter),
      InvoiceDeliveryEvent.find(filter)
        .sort({ [sortBy]: direction })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "invoiceId",
          select: "invoiceNo customerId",
          populate: {
            path: "customerId",
            select: "partyId tradingName legalCompanyName",
            populate: {
              path: "partyId",
              select: "companyName firstName lastName",
            },
          },
        })
        .lean(),
    ]);

    const data = deliveries.map((delivery) => {
      const invoice = delivery.invoiceId;
      const customer = invoice?.customerId;
      const party = customer?.partyId;
      const customerName =
        customer?.tradingName ||
        customer?.legalCompanyName ||
        party?.companyName ||
        [party?.firstName, party?.lastName].filter(Boolean).join(" ").trim() ||
        "Unknown";

      let statusDetail = null;
      if (delivery.currentStatus === "OPENED" && delivery.openedAt) {
        statusDetail = `Opened ${delivery.openedAt.toISOString()}`;
      } else if (delivery.currentStatus === "DELIVERED" && delivery.deliveredAt) {
        statusDetail = `Delivered ${delivery.deliveredAt.toISOString()}`;
      } else if (delivery.currentStatus === "BOUNCED" && delivery.bouncedAt) {
        statusDetail = `Bounced ${delivery.bouncedAt.toISOString()}`;
      }

      return {
        deliveryId: delivery._id.toString(),
        invoiceId: invoice?._id?.toString() || null,
        invoiceNumber: invoice?.invoiceNo || "Unknown",
        customerName,
        recipientEmail: delivery.recipientEmail,
        sentAt: delivery.sentAt?.toISOString() || null,
        status: delivery.currentStatus,
        statusDetail,
        opens: delivery.opensCount || 0,
        clicks: delivery.clicksCount || 0,
        engagementScore: delivery.engagementScore || 0,
      };
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  static async getDeliveryDetail(deliveryId, user) {
    if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
      throw new AppError("Invalid delivery ID", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = sanitizeOrganizationId(user.activeOrganizationId, user.organizationId);

    const delivery = await InvoiceDeliveryEvent.findOne({
      _id: new mongoose.Types.ObjectId(deliveryId),
      organizationId,
    })
      .populate({
        path: "invoiceId",
        select: "invoiceNo customerId",
        populate: {
          path: "customerId",
          select: "partyId tradingName legalCompanyName",
          populate: {
            path: "partyId",
            select: "companyName firstName lastName",
          },
        },
      })
      .lean();

    if (!delivery) {
      throw new AppError("Delivery event not found", HttpStatusCodes.NOT_FOUND);
    }

    const logs = await InvoiceDeliveryEventLog.find({
      deliveryEventId: delivery._id,
      organizationId,
    })
      .sort({ timestamp: 1 })
      .lean();

    const events = logs
      .filter((log) => ["SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED"].includes(log.eventType))
      .map((log) => ({
        type: log.eventType,
        timestamp: log.timestamp.toISOString(),
      }));

    const metadata = delivery.metadata || {};
    const opens = (metadata.opens || []).map((open) => ({
      timestamp: new Date(open.timestamp).toISOString(),
      ip: open.ip || null,
      userAgent: open.userAgent || null,
    }));

    const clicks = (metadata.clicks || []).map((click) => ({
      timestamp: new Date(click.timestamp).toISOString(),
      link: click.link || null,
    }));

    const invoice = delivery.invoiceId;
    const customer = invoice?.customerId;
    const party = customer?.partyId;
    const customerName =
      customer?.tradingName ||
      customer?.legalCompanyName ||
      party?.companyName ||
      [party?.firstName, party?.lastName].filter(Boolean).join(" ").trim() ||
      "Unknown";

    return {
      invoiceNumber: invoice?.invoiceNo || "Unknown",
      customerName,
      recipientEmail: delivery.recipientEmail,
      events,
      opens,
      clicks,
    };
  }

  static async resendInvoice(deliveryId, body, user) {
    if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
      throw new AppError("Invalid delivery ID", HttpStatusCodes.BAD_REQUEST);
    }

    const { recipientEmail, ccEmails = [], message = null } = body;
    if (recipientEmail && typeof recipientEmail !== "string") {
      throw new AppError("recipientEmail must be a string", HttpStatusCodes.BAD_REQUEST);
    }

    if (ccEmails && !Array.isArray(ccEmails)) {
      throw new AppError("ccEmails must be an array", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = sanitizeOrganizationId(user.activeOrganizationId, user.organizationId);

    const delivery = await InvoiceDeliveryEvent.findOne({
      _id: new mongoose.Types.ObjectId(deliveryId),
      organizationId,
    }).lean();

    if (!delivery) {
      throw new AppError("Delivery event not found", HttpStatusCodes.NOT_FOUND);
    }

    const newRecipientEmail = (recipientEmail || delivery.recipientEmail || "").trim().toLowerCase();
    if (!newRecipientEmail) {
      throw new AppError("recipientEmail is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Create new delivery attempt
    const sentAt = new Date();
    const newDelivery = await InvoiceDeliveryEvent.create({
      invoiceId: delivery.invoiceId,
      organizationId,
      recipientEmail: newRecipientEmail,
      recipientName: delivery.recipientName || null,
      sentAt,
      currentStatus: "SENT",
      metadata: {
        ...(delivery.metadata || {}),
        attempts: [
          ...(delivery.metadata?.attempts || []),
          {
            timestamp: sentAt,
            requestedBy: user.email || user.username || user.id || "system",
            message,
            ccEmails,
          },
        ],
      },
    });

    await appendLogEntry({
      deliveryEventId: newDelivery._id,
      organizationId,
      eventType: "RESENT_SENT",
      metadata: {
        ccEmails,
        message,
        requestedBy: user.email || user.id || null,
      },
    });

    return {
      message: "Invoice resent successfully",
      deliveryId: newDelivery._id.toString(),
    };
  }

  static async handleWebhook(payload, headers) {
    const secret = process.env.INVOICE_DELIVERY_WEBHOOK_SECRET || null;
    if (secret) {
      const signature = headers["x-webhook-signature"] || headers["X-Webhook-Signature"];
      if (!signature || signature !== secret) {
        throw new AppError("Invalid webhook signature", HttpStatusCodes.UNAUTHORIZED);
      }
    }

    const { deliveryId, eventType, timestamp, metadata = {}, providerPayload = {} } = payload || {};

    if (!deliveryId || !mongoose.Types.ObjectId.isValid(deliveryId)) {
      throw new AppError("Invalid deliveryId in webhook payload", HttpStatusCodes.BAD_REQUEST);
    }

    const normalizedEventType = WEBHOOK_EVENT_MAP[eventType?.toLowerCase()];
    if (!normalizedEventType) {
      throw new AppError(`Unsupported event type: ${eventType}`, HttpStatusCodes.BAD_REQUEST);
    }

    const delivery = await InvoiceDeliveryEvent.findById(deliveryId);
    if (!delivery) {
      throw new AppError("Delivery event not found", HttpStatusCodes.NOT_FOUND);
    }

    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(eventTimestamp.getTime())) {
      throw new AppError("Invalid timestamp in webhook payload", HttpStatusCodes.BAD_REQUEST);
    }

    const updatedMetadata = { ...(delivery.metadata || {}) };
    let opensCount = delivery.opensCount || 0;
    let clicksCount = delivery.clicksCount || 0;
    let firstOpenDelayMinutes = delivery.firstOpenDelayMinutes || null;

    switch (normalizedEventType) {
      case "DELIVERED":
        delivery.deliveredAt = eventTimestamp;
        delivery.currentStatus = delivery.currentStatus === "BOUNCED" ? "BOUNCED" : "DELIVERED";
        break;
      case "OPENED":
        opensCount += 1;
        delivery.opensCount = opensCount;
        if (!delivery.openedAt) {
          delivery.openedAt = eventTimestamp;
          if (delivery.sentAt) {
            const diffMs = eventTimestamp.getTime() - delivery.sentAt.getTime();
            firstOpenDelayMinutes = Math.round(diffMs / (1000 * 60));
          }
        }
        updatedMetadata.opens = updatedMetadata.opens || [];
        updatedMetadata.opens.push({
          timestamp: eventTimestamp,
          ip: metadata.ip || null,
          userAgent: metadata.userAgent || null,
        });
        delivery.currentStatus = delivery.currentStatus === "BOUNCED" ? "BOUNCED" : "OPENED";
        break;
      case "CLICKED":
        clicksCount += 1;
        delivery.clicksCount = clicksCount;
        if (!delivery.clickedAt) {
          delivery.clickedAt = eventTimestamp;
        }
        updatedMetadata.clicks = updatedMetadata.clicks || [];
        updatedMetadata.clicks.push({
          timestamp: eventTimestamp,
          link: metadata.link || null,
        });
        delivery.currentStatus = delivery.currentStatus === "BOUNCED" ? "BOUNCED" : "CLICKED";
        break;
      case "BOUNCED":
        delivery.bouncedAt = eventTimestamp;
        delivery.currentStatus = "BOUNCED";
        break;
      default:
        break;
    }

    delivery.firstOpenDelayMinutes = firstOpenDelayMinutes;
    delivery.lastEventAt = eventTimestamp;
    delivery.metadata = updatedMetadata;
    delivery.engagementScore = computeEngagementScore({
      opensCount,
      clicksCount,
      currentStatus: delivery.currentStatus,
    });

    await delivery.save();

    await appendLogEntry({
      deliveryEventId: delivery._id,
      organizationId: delivery.organizationId,
      eventType: normalizedEventType,
      metadata,
      providerPayload,
    });

    return {
      success: true,
      message: "Webhook processed",
    };
  }
}

module.exports = InvoiceDeliveryService;

