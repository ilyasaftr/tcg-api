import { ApiError } from "../utils/api-error";

type XenditInvoiceStatus =
  | "PENDING"
  | "PAID"
  | "SETTLED"
  | "EXPIRED"
  | "FAILED"
  | "UNKNOWN";

export type XenditInvoice = {
  id: string;
  externalId: string;
  amount: number;
  invoiceUrl?: string;
  status?: XenditInvoiceStatus | string;
  expiryDate?: string;
  paidAt?: string;
};

export class XenditInvoiceService {
  private client: any;

  constructor() {
    const secretKey = process.env.XENDIT_SECRET_KEY;
    if (!secretKey) {
      throw new ApiError("XENDIT_SECRET_KEY is not configured", 500);
    }

    // xendit-node is a CJS module; keep require for compatibility.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Xendit } = require("xendit-node");
    this.client = new Xendit({ secretKey });
  }

  async createInvoice(input: {
    externalId: string;
    amount: number;
    payerEmail?: string;
    description?: string;
    invoiceDurationSeconds: number;
    successRedirectUrl?: string;
    failureRedirectUrl?: string;
    items?: Array<{
      name: string;
      quantity: number;
      price: number;
      category?: string;
      url?: string;
    }>;
    metadata?: Record<string, unknown>;
  }): Promise<XenditInvoice> {
    const { externalId, amount, invoiceDurationSeconds } = input;

    if (!externalId) throw new ApiError("externalId is required", 500);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError("Invalid invoice amount", 500);
    }
    if (!Number.isFinite(invoiceDurationSeconds) || invoiceDurationSeconds <= 0) {
      throw new ApiError("Invalid invoice duration", 500);
    }

    const res = await this.client.Invoice.createInvoice({
      data: {
        externalId,
        amount,
        payerEmail: input.payerEmail,
        description: input.description,
        invoiceDuration: invoiceDurationSeconds,
        shouldSendEmail: false,
        successRedirectUrl: input.successRedirectUrl,
        failureRedirectUrl: input.failureRedirectUrl,
        items: input.items,
        metadata: input.metadata,
      },
    });

    return {
      id: res.id,
      externalId: res.externalId,
      amount: res.amount,
      invoiceUrl: res.invoiceUrl,
      status: res.status,
      expiryDate: res.expiryDate,
      paidAt: res.paidAt,
    };
  }

  async getInvoiceById(id: string): Promise<XenditInvoice> {
    if (!id) throw new ApiError("Invoice id is required", 400);

    const res = await this.client.Invoice.getInvoiceById({ invoiceId: id });

    return {
      id: res.id,
      externalId: res.externalId,
      amount: res.amount,
      invoiceUrl: res.invoiceUrl,
      status: res.status,
      expiryDate: res.expiryDate,
      paidAt: res.paidAt,
    };
  }
}

