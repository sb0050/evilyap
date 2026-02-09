import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface CustomerEmailData {
  customerEmail: string;
  customerName: string;
  storeName: string;
  storeDescription?: string;
  storeLogo?: string;
  storeAddress?: any;
  productReference: string;
  amount: number;
  currency: string;
  paymentId: string;
  boxtalId: string;
  shipmentId: string;
  deliveryMethod: "pickup_point" | "home_delivery" | "store_pickup";
  deliveryNetwork: string;
  pickupPointCode: string;
  estimatedDeliveryDate: string;
  trackingUrl: string;
  promoCodes: string;
  productValue: number;
  estimatedDeliveryCost: number;
}

interface StoreOwnerEmailData {
  ownerEmail: string;
  storeName: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  // NEW: delivery method and shipping info
  deliveryMethod: "pickup_point" | "home_delivery" | "store_pickup";
  deliveryNetwork: string;
  shippingAddress: {
    name?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  };
  customerAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  pickupPointCode: string;
  productReference: string;
  amount: number;
  weight: number;
  currency: string;
  paymentId: string;
  boxtalId: string;
  shipmentId?: string;
  promoCodes?: string;
  productValue: number;
  estimatedDeliveryCost: number;
  // Pièces jointes optionnelles (ex: bordereau PDF)
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
  // Note additionnelle (ex: bordereau envoyé ultérieurement)
  documentPendingNote?: string;
}

interface CustomerTrackingEmailData {
  customerEmail: string;
  customerName: string;
  storeName: string;
  shippingOrderId: string;
  status: string;
  message?: string;
  trackingNumber?: string;
  packageId?: string;
  packageTrackingUrl?: string;
}

interface SupportShippingDocMissingData {
  storeOwnerEmail: string;
  storeName: string;
  boxtalId: string;
  shippingOrderId?: string;
  paymentId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryMethod?: string;
  deliveryNetwork?: string;
  pickupPointCode?: string;
  shippingAddress?: {
    name?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  };
  productReference?: string;
  amount?: number;
  currency?: string;
  errorDetails?: string;
  // Note additionnelle (ex: bordereau envoyé ultérieurement)
  additionalNote?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    const config: EmailConfig = {
      host: process.env.SMTP_HOST || "",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
      },
    };

    this.transporter = nodemailer.createTransport(config as any);
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log("SMTP connection verified");
      return true;
    } catch (error) {
      console.error("SMTP verification failed:", error);
      return false;
    }
  }

  private formatAmount(amount?: number, currency?: string): string | undefined {
    if (typeof amount !== "number" || !currency) return undefined;
    try {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: (currency || "EUR").toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return undefined;
    }
  }

  private formatEstimatedDate(dateStr?: string): string {
    if (!dateStr) return "N/A";
    try {
      const [yStr, mStr, dStr] = dateStr.split("-");
      const y = Number(yStr),
        m = Number(mStr),
        d = Number(dStr);
      if (!y || !m || !d) return dateStr;
      // Construire la date en local pour éviter les décalages de fuseau
      const date = new Date(y, m - 1, d);
      const day = date.getDate();
      const monthName = date.toLocaleString("fr-FR", { month: "long" });
      const capMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      const year = date.getFullYear();
      return `${day} ${capMonth} ${year}`;
    } catch {
      return dateStr;
    }
  }

  // Email de confirmation pour le client
  async sendCustomerConfirmation(data: CustomerEmailData): Promise<boolean> {
    try {
      const formattedAmount = this.formatAmount(data.amount, data.currency);
      const netProductValue =
        (data.amount ?? 0) - (data.estimatedDeliveryCost ?? 0);
      const formattedNetProduct =
        this.formatAmount(netProductValue, data.currency) ||
        String(netProductValue);
      const formattedOriginalProduct =
        this.formatAmount(data.productValue, data.currency) ||
        String(data.productValue ?? 0);
      const discountValue = Math.max(
        0,
        (data.productValue ?? 0) - netProductValue,
      );
      const formattedDiscount =
        this.formatAmount(discountValue, data.currency) ||
        String(discountValue);
      const promoNote = data.promoCodes
        ? ` <span style="color:#666; font-size:12px;"><span style="text-decoration: line-through;">${formattedOriginalProduct}</span> (${formattedDiscount} de remise avec le code : ${String(
            data.promoCodes || "",
          ).replace(/;+/g, ", ")})</span>`
        : "";
      const formattedEstimatedDate = this.formatEstimatedDate(
        data.estimatedDeliveryDate,
      );

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>🎉 Confirmation de commande</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
            .amount { font-size: 24px; font-weight: bold; color: #667eea; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            .logo { max-width: 100px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${
                data.storeLogo
                  ? `<img src="${data.storeLogo}" alt="${data.storeName}" class="logo">`
                  : ""
              }
              <h1>🎉 Merci pour votre commande !</h1>
              <p>✅ Votre paiement a été traité avec succès</p>
            </div>
            
            <div class="content">
              <h2>Bonjour ${data.customerName},</h2>
              
              <p>Nous vous confirmons que votre commande a été validée et que votre paiement a été traité avec succès.</p>
              
              <div class="order-details">
                <h3>📦 Détails de votre commande</h3>
                <p><strong>Boutique :</strong> ${data.storeName}</p>
                ${
                  data.storeDescription
                    ? `<p><strong>Description :</strong> ${data.storeDescription}</p>`
                    : ""
                }
                <p><strong>Référence produit :</strong> ${
                  data.productReference
                }</p>
                <p><strong>Montant payé :</strong> <span class="amount">${formattedAmount}</span> (frais de livraison inclus)</p>
                <p><strong>Valeur des produits :</strong> <span class="amount">${formattedNetProduct}</span>${promoNote}</p>
                <p><strong>ID de transaction :</strong> ${data.paymentId}</p>
                ${
                  data.deliveryMethod !== "store_pickup"
                    ? `<p><strong>ID de commande :</strong> ${data.boxtalId}</p>`
                    : `<p><strong>ID de commande interne :</strong> ${data.shipmentId}</p>`
                }
                <p><strong>Date :</strong> ${new Date().toLocaleDateString(
                  "fr-FR",
                  {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}</p>
                
                <p><strong>Méthode de livraison :</strong> ${
                  data.deliveryMethod === "pickup_point"
                    ? `Point relais (${data.pickupPointCode})`
                    : data.deliveryMethod === "home_delivery"
                      ? "À domicile"
                      : "Retrait en Magasin"
                }</p>
                ${
                  data.deliveryMethod === "store_pickup"
                    ? `<p><strong>Adresse de la boutique :</strong> ${data.storeAddress.line1}, ${data.storeAddress.postal_code} ${data.storeAddress.city} ${data.storeAddress.country}</p>
                   <p><strong>Numéro de téléphone de la boutique :</strong> ${data.storeAddress.phone}</p>
                   `
                    : ""
                }
                ${
                  data.deliveryMethod !== "store_pickup"
                    ? `<p><strong>Date de livraison estimée :</strong> ${formattedEstimatedDate}</p>`
                    : ""
                }
                ${
                  data.deliveryMethod !== "store_pickup"
                    ? `<p><strong>Lien de suivi de la livraison :</strong> <a href="${data.trackingUrl}">Cliquez ici</a></p>`
                    : ""
                }
              </div>
              
              <p>📬 Vous recevrez prochainement un email avec les détails de livraison de votre commande.</p>
              
              <p>❓ Si vous avez des questions, n'hésitez pas à nous contacter.</p>
              
              <p>🙏 Merci de votre confiance !</p>
              <p><strong>L'équipe ${data.storeName}</strong></p>
            </div>
            
            <div class="footer">
              <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
              <p>© ${new Date().getFullYear()} ${
                data.storeName
              } - Tous droits réservés</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"${data.storeName}" <${process.env.SMTP_USER}>`,
        to: data.customerEmail,
        subject: `🎉 Confirmation de commande - ${data.storeName}`,
        html: htmlContent,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email de confirmation envoyé à ${data.customerEmail}`);
      console.log("📨 sendMail result (customer):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email client:", error);
      return false;
    }
  }

  async sendCartRecap(data: {
    customerEmail: string;
    customerName: string;
    storeName: string;
    storeLogo?: string;
    carts: Array<{
      product_reference: string;
      value: number;
      description?: string;
      quantity?: number;
    }>;
    checkoutLink: string;
  }): Promise<boolean> {
    try {
      const shouldShowLogo =
        typeof data.storeLogo === "string" &&
        data.storeLogo.trim().length > 0 &&
        !data.storeLogo.trim().toLowerCase().startsWith("data:") &&
        data.storeLogo.trim().length < 2000;

      const total = (data.carts || []).reduce((acc, c) => {
        const unit = typeof c.value === "number" ? c.value : 0;
        const qty =
          typeof c.quantity === "number" &&
          Number.isFinite(c.quantity) &&
          c.quantity > 0
            ? Math.floor(c.quantity)
            : 1;
        return acc + unit * qty;
      }, 0);
      const formattedTotal = this.formatAmount(total, "EUR") || String(total);

      const itemsRowsHtml = (data.carts || [])
        .map((c) => {
          const ref = String(c.product_reference || "").trim();
          const desc = String(c.description || "").trim();
          const qty =
            typeof c.quantity === "number" &&
            Number.isFinite(c.quantity) &&
            c.quantity > 0
              ? Math.floor(c.quantity)
              : 1;
          const unit = typeof c.value === "number" ? c.value : 0;
          const unitFormatted = this.formatAmount(unit, "EUR") || String(unit);
          const lineTotal = unit * qty;
          const lineTotalFormatted =
            this.formatAmount(lineTotal, "EUR") || String(lineTotal);
          return `
            <tr>
              <td style="padding:12px 0; border-bottom:1px solid #eee;">
                <div style="font-weight:700; color:#111;">${ref || "—"}</div>
                ${
                  desc
                    ? `<div style="margin-top:4px; font-size:13px; color:#555;">${desc}</div>`
                    : ""
                }
              </td>
              <td align="right" style="padding:12px 0; border-bottom:1px solid #eee; color:#111; font-weight:600; white-space:nowrap;">
                ${unitFormatted}
              </td>
              <td align="right" style="padding:12px 0; border-bottom:1px solid #eee; color:#111; font-weight:600; white-space:nowrap;">
                ${qty}
              </td>
              <td align="right" style="padding:12px 0; border-bottom:1px solid #eee; color:#111; font-weight:800; white-space:nowrap;">
                ${lineTotalFormatted}
              </td>
            </tr>
          `;
        })
        .join("");

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>🧾 Récapitulatif de votre panier</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin:0; padding:0;">
          <div style="max-width:600px;margin:0 auto;padding:20px;">
            <div style="background:linear-gradient(135deg,#28a745 0%,#20c997 100%);color:#ffffff;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
              ${
                shouldShowLogo
                  ? `<img src="${data.storeLogo}" alt="${data.storeName}" style="max-width:100px;margin-bottom:20px;">`
                  : ""
              }
              <h1>🧾 Récapitulatif de votre panier</h1>
              <p>${data.storeName}</p>
            </div>
            <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
              <h2>Bonjour ${data.customerName},</h2>
              <p>Voici le récapitulatif de votre panier chez <strong>${data.storeName}</strong>.</p>

              <div style="background:#ffffff;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #28a745;">
                <h3>🛍️ Détail du panier</h3>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th align="left" style="padding:10px 0; border-bottom:2px solid #eee; color:#333; font-size:12px; text-transform:uppercase; letter-spacing:.3px;">Article</th>
                      <th align="right" style="padding:10px 0; border-bottom:2px solid #eee; color:#333; font-size:12px; text-transform:uppercase; letter-spacing:.3px;">Prix unitaire</th>
                      <th align="right" style="padding:10px 0; border-bottom:2px solid #eee; color:#333; font-size:12px; text-transform:uppercase; letter-spacing:.3px;">Qté</th>
                      <th align="right" style="padding:10px 0; border-bottom:2px solid #eee; color:#333; font-size:12px; text-transform:uppercase; letter-spacing:.3px;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsRowsHtml}
                  </tbody>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin-top:16px;">
                  <tr>
                    <td style="padding-top:14px; border-top:2px solid #eee; font-size:14px; color:#333; font-weight:700;">
                      Total du panier
                    </td>
                    <td align="right" style="padding-top:14px; border-top:2px solid #eee; white-space:nowrap;font-size:22px;font-weight:800;color:#28a745;">
                      ${formattedTotal}
                    </td>
                  </tr>
                </table>
              </div>

              <div style="margin-top:24px;">
                <a href="${data.checkoutLink}" style="display:block;width:94%;margin:0 auto;text-align:center;padding:16px 0;background:#0074d4;background-color:#0074d4;color:#ffffff !important;border-radius:8px;text-decoration:none;font-weight:700;font-size:18px;">Procéder au paiement</a>
              </div>

              <div style="text-align:center;margin-top:30px;color:#666;font-size:14px;">
                © ${new Date().getFullYear()} ${data.storeName} - Tous droits réservés
              </div>
            </div>
          </div>
        </body>
        </html>
      `;
      const mailOptions = {
        from: `"${data.storeName}" <${process.env.SMTP_USER}>`,
        to: data.customerEmail,
        subject: `🧾 Récapitulatif de votre panier - ${data.storeName}`,
        html: htmlContent,
      };
      const info = await this.transporter.sendMail(mailOptions);
      console.log("cart recap email:", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("Erreur envoi email recap:", error);
      return false;
    }
  }

  // Email de notification pour le propriétaire de la boutique
  async sendStoreOwnerNotification(
    data: StoreOwnerEmailData,
  ): Promise<boolean> {
    try {
      const formattedAmount = this.formatAmount(data.amount, data.currency);
      const netProductValue =
        (data.amount ?? 0) - (data.estimatedDeliveryCost ?? 0);
      const formattedNetProduct =
        this.formatAmount(netProductValue, data.currency) ||
        String(netProductValue);
      const formattedOriginalProduct =
        this.formatAmount(data.productValue, data.currency) ||
        String(data.productValue ?? 0);
      const discountValue = Math.max(
        0,
        (data.productValue ?? 0) - netProductValue,
      );
      const formattedDiscount =
        this.formatAmount(discountValue, data.currency) ||
        String(discountValue);
      const promoNote = data.promoCodes
        ? ` <span style="color:#666; font-size:12px;"><span style="text-decoration: line-through;">${formattedOriginalProduct}</span> (${formattedDiscount} de remise avec le code : ${String(
            data.promoCodes || "",
          ).replace(/;+/g, ", ")})</span>`
        : "";

      // Préparer les infos réseau (lien carte + image dimensions) selon deliveryNetwork
      const getNetworkInfo = (
        networkCode?: string,
      ): {
        name: string;
        link?: string;
        imageFile?: string;
      } | null => {
        if (!networkCode) return null;
        const code = (networkCode || "").toUpperCase();
        // Mapping par préfixe
        if (code.startsWith("MONR")) {
          return {
            name: "Mondial Relay",
            link: "https://www.mondialrelay.fr/trouver-le-point-relais-le-plus-proche-de-chez-moi/",
            imageFile: "mondial_relay.jpg",
          };
        }
        if (code.startsWith("CHRP")) {
          return {
            name: "Chronopost",
            link: "https://www.chronopost.fr/expeditionAvanceeSec/ounoustrouver.html",
            imageFile: "chronopost.png",
          };
        }
        if (code.startsWith("POFR")) {
          return {
            name: "Colissimo (La Poste)",
            link: "https://localiser.laposte.fr/",
            imageFile: "colissimo.jpg",
          };
        }
        if (code.startsWith("SOGP")) {
          return {
            name: "Relais Colis",
            link: "https://www.relaiscolis.com/relais/trouver",
            imageFile: "relais_colis.jpg",
          };
        }
        if (code.startsWith("UPSE")) {
          return {
            name: "UPS Access Point",
            link: "https://www.ups.com/fr/fr/business-solutions/expand-your-online-business/ups-access-point",
            imageFile: "ups.jpg",
          };
        }
        if (code.startsWith("COPR")) {
          return {
            name: "Colis Privé",
            link: "https://client.colisprive-store.com/relais",
            imageFile: "colis_prive.jpg",
          };
        }
        if (code.startsWith("DLVG")) {
          return {
            name: "Delivengo",
            link: "https://localiser.laposte.fr/",
            imageFile: "delivengo.jpg",
          };
        }

        return null;
      };

      const networkInfo =
        data.deliveryMethod === "pickup_point" ||
        data.deliveryMethod === "home_delivery"
          ? getNetworkInfo(data.deliveryNetwork)
          : null;

      // Attachement image dimensions (cid) si disponible
      const networkImageCid = "network-dimensions-img";
      const networkImageAttachment = (() => {
        try {
          if (networkInfo?.imageFile) {
            const imgPath = path.join(
              __dirname,
              "..",
              "public",
              networkInfo.imageFile,
            );
            if (fs.existsSync(imgPath)) {
              return {
                filename: networkInfo.imageFile,
                path: imgPath,
                cid: networkImageCid,
              } as any;
            }
          }
        } catch (_) {}
        return null;
      })();

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Nouvelle commande reçue</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
            .customer-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8; }
            .amount { font-size: 24px; font-weight: bold; color: #28a745; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            .note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 6px; margin-top: 12px; }
            .network { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #6c63ff; }
            .network img { max-width: 100px; width: auto; height: auto; border-radius: 6px; border: 1px solid #eee; }
            .network a { color: #0d6efd; text-decoration: none; }
            .network a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Nouvelle commande !</h1>
              <p>Vous avez reçu une nouvelle commande sur ${data.storeName}</p>
            </div>
            
            <div class="content">
              <h2>Bonjour,</h2>
              
              <p>Excellente nouvelle ! Vous venez de recevoir une nouvelle commande sur votre boutique <strong>${
                data.storeName
              }</strong>.</p>
              
              <div class="order-details">
                <h3>📦 Détails de la commande</h3>
                <p><strong>Référence produit :</strong> ${
                  data.productReference
                }</p>
                <p><strong>Montant :</strong> <span class="amount">${formattedNetProduct}</span>${promoNote}</p>
                <p><strong>ID de transaction :</strong> ${data.paymentId}</p>
                ${
                  data.deliveryMethod !== "store_pickup"
                    ? `<p><strong>ID de commande :</strong> ${data.boxtalId}</p>`
                    : `<p><strong>ID de commande interne :</strong> ${data.shipmentId}</p>`
                }
                <p><strong>Date :</strong> ${new Date().toLocaleDateString(
                  "fr-FR",
                  {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}</p>
                 ${
                   data.documentPendingNote
                     ? `<div class="note">${data.documentPendingNote}</div>`
                     : ""
                 }
              </div>
              
              <div class="customer-details">
                <h3>👤 Informations client</h3>
                <p><strong>Nom :</strong> ${data.customerName}</p>
                <p><strong>Email :</strong> ${data.customerEmail}</p>
                ${
                  data.customerPhone
                    ? `<p><strong>Téléphone :</strong> ${data.customerPhone}</p>`
                    : ""
                }
              </p>
              </div>

              <div class="order-details">
                <h3>🚚 Méthode de livraison</h3>
                <p><strong>Méthode :</strong> ${
                  data.deliveryMethod === "pickup_point"
                    ? `Point relais (${data.pickupPointCode})`
                    : data.deliveryMethod === "home_delivery"
                      ? "À domicile"
                      : "Retrait en Magasin"
                }
                </p>
                <p><strong>Poids du colis :</strong> ${data.weight} kg</p>
                ${
                  networkInfo
                    ? `
                        <p><strong>Réseau :</strong> ${data.deliveryNetwork} (${
                          networkInfo.name
                        })</p>
                        <p>Vous pouvez déposer ce colis dans n'importe quel point relais du réseau <strong>${
                          data.deliveryNetwork
                        }</strong>.</p>
                        ${
                          networkInfo.link
                            ? `<p>🗺️ <a href="${networkInfo.link}" target="_blank" rel="noopener">Voir la carte des points relais</a></p>`
                            : ""
                        }
                        <p><strong>Dimensions maximales des colis</strong> (selon le réseau) :</p>
                        ${
                          networkImageAttachment
                            ? `<img src="cid:${networkImageCid}" alt="Dimensions maximales - ${networkInfo.name}" />`
                            : ""
                        }
                      `
                    : ""
                }
              </div>

      
              
              <p>Le client a été automatiquement notifié par email de la confirmation de sa commande.</p>
              
              <p><strong>Action requise :</strong> Veuillez préparer et expédier la commande dans les plus brefs délais.</p>
        
              <p><strong>L'équipe PayLive</strong></p>
            </div>
            
            <div class="footer">
              <p>Cet email a été envoyé automatiquement depuis votre boutique ${
                data.storeName
              }</p>
              <p>© ${new Date().getFullYear()} PayLive - Tous droits réservés</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Fusionner les pièces jointes (documents + image réseau)
      const mailAttachments: any[] = [];
      if (data.attachments && data.attachments.length) {
        mailAttachments.push(...data.attachments);
      }
      if (networkImageAttachment) {
        mailAttachments.push(networkImageAttachment);
      }

      const mailOptions = {
        from: `"PayLive - ${data.storeName}" <${process.env.SMTP_USER}>`,
        to: data.ownerEmail,
        subject: `💰 Nouvelle commande reçue - ${formattedNetProduct} - ${data.storeName}`,
        html: htmlContent,
        // Ajouter les pièces jointes si présentes
        ...(mailAttachments.length ? { attachments: mailAttachments } : {}),
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(
        `✅ Email de notification envoyé au propriétaire ${data.ownerEmail}`,
      );
      console.log("📨 sendMail result (owner):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email propriétaire:", error);
      return false;
    }
  }

  async sendCustomerTrackingUpdate(
    data: CustomerTrackingEmailData,
  ): Promise<boolean> {
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Mise à jour du suivi</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #007bff 0%, #00b4d8 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            .btn { display: inline-block; padding: 10px 16px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📦 Mise à jour du suivi</h1>
              <p>${data.storeName}</p>
            </div>
            <div class="content">
              <h2>Bonjour ${data.customerName || ""},</h2>
              <p>Le suivi de votre envoi a été mis à jour.</p>
              <div class="order-details">
                <p><strong>Commande d'expédition :</strong> ${
                  data.shippingOrderId
                }</p>
                <p><strong>Statut :</strong> ${data.status}</p>
                ${
                  data.message
                    ? `<p><strong>Message :</strong> ${data.message}</p>`
                    : ""
                }
                ${
                  data.trackingNumber
                    ? `<p><strong>Numéro de suivi :</strong> ${data.trackingNumber}</p>`
                    : ""
                }
                ${
                  data.packageId
                    ? `<p><strong>ID colis :</strong> ${data.packageId}</p>`
                    : ""
                }
                ${
                  data.packageTrackingUrl
                    ? `<p><a class="btn" href="${data.packageTrackingUrl}" target="_blank" rel="noopener">Voir le suivi</a></p>`
                    : ""
                }
              </div>
              <p>Merci pour votre confiance.</p>
              <p><strong>L'équipe ${data.storeName}</strong></p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"${data.storeName}" <${process.env.SMTP_USER}>`,
        to: data.customerEmail,
        subject: `📦 Mise à jour de suivi - ${data.storeName}`,
        html: htmlContent,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email suivi envoyé à ${data.customerEmail}`);
      console.log("📨 sendMail result (customer tracking):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email suivi client:", error);
      return false;
    }
  }
  async sendAdminError(data: {
    subject: string;
    message: string;
    context?: string;
  }): Promise<boolean> {
    try {
      const to = process.env.SMTP_USER || "";
      if (!to) {
        console.error("sendAdminError: SMTP_USER non configuré");
        return false;
      }

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>🚨 ${data.subject}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: #b91c1c; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #fff7f7; padding: 20px; border: 1px solid #fecaca; border-top: none; border-radius: 0 0 8px 8px; }
            pre { background: #fff; padding: 12px; border-radius: 6px; border: 1px solid #fca5a5; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🚨 Alerte erreur</h2>
              <p>${data.subject}</p>
            </div>
            <div class="content">
              <p><strong>Message:</strong> ${data.message}</p>
              ${
                data.context ? `<h3>Détails</h3><pre>${data.context}</pre>` : ""
              }
            </div>
          </div>
        </body>
        </html>
      `;

      const info = await this.transporter.sendMail({
        from: process.env.SMTP_USER || "contact@paylive.cc",
        to,
        subject: `[ALERT] ${data.subject}`,
        html: htmlContent,
      });
      console.log("sendAdminError sent:", info.messageId);
      return true;
    } catch (error) {
      console.error("sendAdminError failed:", error);
      return false;
    }
  }

  // Message de support envoyé par un propriétaire de boutique (ou admin) vers l'admin
  async sendAdminSupportMessage(data: {
    storeName: string;
    storeSlug: string;
    ownerEmail?: string;
    clerkUserId?: string;
    message: string;
    context?: any;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>;
  }): Promise<boolean> {
    try {
      const toEmail = process.env.SMTP_USER || "";
      if (!toEmail) {
        console.warn("SMTP_USER non configuré, email de support non envoyé.");
        return false;
      }

      const dateStr = new Date().toLocaleString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const safeMsg = (data.message || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const contextObj = (() => {
        if (!data.context) return null;
        try {
          if (typeof data.context === "string") {
            return JSON.parse(data.context);
          }
          return data.context;
        } catch {
          return { raw: String(data.context) };
        }
      })();

      const contextHtml = (() => {
        if (!contextObj) return "";
        const salesKey = Object.keys(contextObj || {}).find(
          (k) => k.toLowerCase() === "sales",
        );
        const entries: Array<[string, any]> = [];
        const preferredOrder = [
          "saleId",
          "shipmentId",
          "productReference",
          "value",
          "customerStripeId",
          "status",
          "createdAt",
          "deliveryMethod",
          "deliveryNetwork",
          "tracking_url",
          "trackingUrl",
          "delivery_cost",
          "deliveryCost",
        ];
        const addEntry = (k: string) => {
          const v = (contextObj as any)[k];
          if (v !== undefined && k.toLowerCase() !== "sales")
            entries.push([k, v]);
        };
        preferredOrder.forEach(addEntry);
        // Include any other keys not in preferred order
        Object.keys(contextObj || {})
          .filter((k) => !preferredOrder.includes(k))
          .forEach((k) => addEntry(k));

        const esc = (x: any) =>
          String(x ?? "—")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const formatContextValue = (val: any) => {
          if (val === undefined || val === null) return "—";
          if (typeof val === "object") {
            try {
              return esc(JSON.stringify(val));
            } catch {
              return esc(String(val));
            }
          }
          return esc(val);
        };

        const rows = entries
          .map(
            ([k, v]) =>
              `<p class="kv"><strong>${esc(k)} :</strong> ${formatContextValue(
                v,
              )}</p>`,
          )
          .join("\n");

        const salesList: Array<any> =
          salesKey && Array.isArray((contextObj as any)[salesKey])
            ? (contextObj as any)[salesKey]
            : [];
        const fmtMoney = (val: any) => {
          if (typeof val === "number") {
            try {
              return new Intl.NumberFormat("fr-FR", {
                style: "currency",
                currency: "EUR",
              }).format(val);
            } catch {
              return String(val);
            }
          }
          return esc(val);
        };
        const salesRows =
          salesList.length > 0
            ? `
            <div class="section">
              <h3>Ventes sélectionnées</h3>
              ${salesList
                .map((s: any) => {
                  const id = s?.shipmentId || s?.shipment_id || s?.id || "—";
                  const ref =
                    s?.productReference || s?.product_reference || "—";
                  const st = s?.status || "—";
                  const val = fmtMoney(s?.value);
                  return `<p class="kv"><strong>${esc(
                    ref,
                  )}</strong> — ID: ${esc(id)} — Statut: ${esc(
                    st,
                  )} — Valeur: ${val}</p>`;
                })
                .join("\n")}
            </div>`
            : "";

        return `
          <div class="section">
            <h3>Contexte</h3>
            ${
              rows ||
              '<p class="kv"><strong>raw:</strong> ' +
                esc((contextObj as any)?.raw) +
                "</p>"
            }
          </div>
          ${salesRows}
        `;
      })();

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Demande de support</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #6c63ff 0%, #0d6efd 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #6c63ff; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
            .msg { white-space: pre-wrap; background: #fff; border: 1px solid #eee; padding: 12px; border-radius: 6px; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📩 Demande de support</h1>
              <p>${data.storeName} — ${data.storeSlug}</p>
            </div>
            <div class="content">
              <div class="section">
                <h3>Résumé</h3>
                <p class="kv"><strong>Boutique :</strong> ${data.storeName}</p>
                <p class="kv"><strong>Slug :</strong> ${data.storeSlug}</p>
                <p class="kv"><strong>Email propriétaire :</strong> ${
                  data.ownerEmail || "N/A"
                }</p>
                <p class="kv"><strong>Clerk user ID :</strong> ${
                  data.clerkUserId || "N/A"
                }</p>
                <p class="kv"><strong>Date :</strong> ${dateStr}</p>
              </div>

              <div class="section">
                <h3>Message</h3>
                <div class="msg">${safeMsg}</div>
              </div>

              ${contextHtml}

              <p>Merci de répondre au propriétaire de la boutique si une action est nécessaire.</p>
              <p><strong>PayLive - Support</strong></p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement depuis le formulaire de support.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"PayLive Support" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: `🆘 Support — ${data.storeName}`,
        html: htmlContent,
        replyTo: data.ownerEmail || undefined,
        attachments:
          data.attachments && data.attachments.length > 0
            ? data.attachments
            : undefined,
      } as any;

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email de support envoyé à ${toEmail}`);
      console.log("📨 sendMail result (support):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email support:", error);
      return false;
    }
  }

  // Message envoyé par un client au propriétaire de boutique
  async sendCustomerMessageToStoreOwner(data: {
    toEmail: string;
    storeName: string;
    storeSlug?: string;
    customerEmail?: string;
    customerName?: string;
    shipmentId?: string;
    trackingUrl?: string;
    productReference?: string | number;
    value?: number;
    deliveryMethod?: string;
    deliveryNetwork?: string;
    message: string;
    promoCodes?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>;
  }): Promise<boolean> {
    try {
      if (!data.toEmail) {
        console.warn(
          "Destinataire (toEmail) manquant pour message client→propriétaire",
        );
        return false;
      }

      const dateStr = new Date().toLocaleString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const safeMsg = (data.message || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Contact client</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: #0ea5e9; color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0ea5e9; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
            .msg { white-space: pre-wrap; background: #fff; border: 1px solid #eee; padding: 12px; border-radius: 6px; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📨 Message client</h1>
              <p>${data.storeName}${
                data.storeSlug ? ` — ${data.storeSlug}` : ""
              }</p>
            </div>
            <div class="content">
              <div class="section">
                <h3>Résumé</h3>
                <p class="kv"><strong>Boutique :</strong> ${data.storeName}</p>
                ${
                  data.storeSlug
                    ? `<p class="kv"><strong>Slug :</strong> ${data.storeSlug}</p>`
                    : ""
                }
                ${
                  data.customerEmail
                    ? `<p class="kv"><strong>Email client :</strong> ${data.customerEmail}</p>`
                    : ""
                }
                ${
                  data.customerName
                    ? `<p class="kv"><strong>Nom client :</strong> ${data.customerName}</p>`
                    : ""
                }
                ${
                  data.shipmentId
                    ? `<p class="kv"><strong>Shipment ID :</strong> ${data.shipmentId}</p>`
                    : ""
                }
                ${
                  data.productReference
                    ? `<p class="kv"><strong>Référence produit :</strong> ${data.productReference}</p>`
                    : ""
                }
                ${
                  typeof data.value === "number"
                    ? `<p class="kv"><strong>Valeur :</strong> ${data.value} €</p>`
                    : ""
                }
                ${
                  data.deliveryMethod
                    ? `<p class="kv"><strong>Mode de livraison :</strong> ${data.deliveryMethod}</p>`
                    : ""
                }
                ${
                  data.deliveryNetwork
                    ? `<p class="kv"><strong>Réseau :</strong> ${data.deliveryNetwork}</p>`
                    : ""
                }
                <p class="kv"><strong>Date :</strong> ${dateStr}</p>
              </div>

              <div class="section">
                <h3>Message</h3>
                <div class="msg">${safeMsg}</div>
              </div>

              ${
                data.trackingUrl
                  ? `<p><a href="${data.trackingUrl}" target="_blank">Suivre l’expédition</a></p>`
                  : ""
              }

              <p>Merci de répondre au client si une action est nécessaire.</p>
              <p><strong>PayLive - Contact client</strong></p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement depuis la page "Mes commandes".</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER || "contact@paylive.cc",
        to: data.toEmail,
        subject: `📨 Client — ${data.storeName}${
          data.shipmentId ? ` (Shipment ${data.shipmentId})` : ""
        }`,
        html: htmlContent,
        replyTo: data.customerEmail || undefined,
        attachments:
          data.attachments && data.attachments.length > 0
            ? data.attachments
            : undefined,
      } as any;

      const info = await this.transporter.sendMail(mailOptions);
      console.log("✅ Email client→propriétaire envoyé:", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
      return true;
    } catch (error) {
      console.error("❌ Envoi email client→propriétaire échoué:", error);
      return false;
    }
  }

  async sendPayoutRequest(data: {
    ownerEmail: string;
    storeName: string;
    storeSlug: string;
    method: "database" | "link";
    iban?: string;
    bic?: string;
    ribUrl?: string;
    amount?: number;
    currency?: string;
  }): Promise<boolean> {
    try {
      const savEmail = process.env.SMTP_USER || "";
      if (!savEmail) {
        console.warn("SMTP_USER non configuré, email SAV non envoyé.");
        return false;
      }

      const formattedAmount = this.formatAmount(
        data.amount,
        (data.currency || "EUR") as string,
      );

      const ribDetailsHtml =
        data.method === "database"
          ? `<p><strong>IBAN:</strong> ${data.iban || "N/A"}</p>
             <p><strong>BIC:</strong> ${data.bic || "N/A"}</p>`
          : `<p><strong>RIB (lien):</strong> ${data.ribUrl || "N/A"}</p>`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Demande de versement des gains</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #0d6efd 0%, #6c63ff 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0d6efd; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
            .amount-card { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 16px; border-radius: 10px; text-align: center; margin: 16px 0; }
            .amount-title { font-size: 14px; opacity: 0.9; margin-bottom: 8px; }
            .amount-value { font-size: 28px; font-weight: bold; letter-spacing: 0.5px; }
            .note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 6px; margin-top: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💸 Demande de versement des gains</h1>
              <p>${data.storeName}</p>
            </div>
            <div class="content">
              <div class="amount-card">
                <div class="amount-title">Montant des gains disponibles</div>
                <div class="amount-value">${formattedAmount || "N/A"}</div>
              </div>
              <div class="section">
                <h3>Informations boutique</h3>
                <p class="kv"><strong>Owner email :</strong> ${
                  data.ownerEmail
                }</p>
                <p class="kv"><strong>Slug :</strong> ${data.storeSlug}</p>
              </div>

              <div class="section">
                <h3>Coordonnées bancaires</h3>
                <p class="kv"><strong>Méthode :</strong> ${
                  data.method === "database"
                    ? "Saisie manuelle (stockée en base)"
                    : "Fichier (lien)"
                }</p>
                ${ribDetailsHtml}
              </div>

              

              <p>Merci de traiter cette demande de versement.</p>
              <p><strong>PayLive - Service SAV</strong></p>
            </div>
          </div>
        </body>
        </html>
      `;

      const info = await this.transporter.sendMail({
        from: `"PayLive SAV" <${process.env.SMTP_USER}>`,
        to: savEmail,
        subject: `💸 Demande de versement - ${data.storeName}${
          formattedAmount ? ` - ${formattedAmount}` : ""
        }`,
        html: htmlContent,
      });
      console.log(`✅ Email demande de versement envoyé à ${savEmail}`);
      console.log("📨 sendMail result (payout):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email demande de versement:", error);
      return false;
    }
  }

  async sendPayoutConfirmationToStoreOwner(data: {
    ownerEmail: string;
    storeName: string;
    storeSlug?: string;
    periodStart?: string | null;
    periodEnd: string;
    storeSiret?: string;
    storeAddress?: any;
    grossAmount: number;
    feeAmount: number;
    payoutAmount: number;
    currency?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>;
  }): Promise<boolean> {
    try {
      const to = String(data.ownerEmail || "").trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        console.warn("sendPayoutConfirmationToStoreOwner: invalid ownerEmail");
        return false;
      }

      const currency = (data.currency || "EUR") as string;
      const formattedGross = this.formatAmount(data.grossAmount, currency);
      const formattedFee = this.formatAmount(data.feeAmount, currency);
      const formattedPayout = this.formatAmount(data.payoutAmount, currency);

      const addr =
        data.storeAddress && typeof data.storeAddress === "object"
          ? (data.storeAddress as any)
          : null;
      const addrLine1 = String(addr?.line1 || "").trim();
      const addrLine2 = String(addr?.line2 || "").trim();
      const addrPostal = String(addr?.postal_code || "").trim();
      const addrCity = String(addr?.city || "").trim();
      const addrCountry = String(addr?.country || "").trim();
      const addrPhone = String(addr?.phone || "").trim();
      const addrOne = [addrLine1, addrLine2].filter(Boolean).join(", ");
      const addrTwo = [addrPostal, addrCity].filter(Boolean).join(" ");
      const addrThree = addrCountry || "";

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Versement effectué</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #0d6efd 0%, #6c63ff 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0d6efd; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
            .amount-card { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 16px; border-radius: 10px; text-align: center; margin: 16px 0; }
            .amount-title { font-size: 14px; opacity: 0.9; margin-bottom: 8px; }
            .amount-value { font-size: 28px; font-weight: bold; letter-spacing: 0.5px; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💸 Versement effectué</h1>
              <p>${data.storeName}</p>
            </div>
            <div class="content">
              <p>Bonjour,</p>
              <p>Votre relevé de versement est prêt. Vous le trouverez en pièce jointe au format PDF.</p>

              <div class="amount-card">
                <div class="amount-title">Montant viré</div>
                <div class="amount-value">${formattedPayout || "N/A"}</div>
              </div>

              <div class="section">
                <h3>Période</h3>
                <p class="kv"><strong>Du :</strong> ${data.periodStart || "—"}</p>
                <p class="kv"><strong>Au :</strong> ${data.periodEnd}</p>
              </div>

              <div class="section">
                <h3>Boutique</h3>
                ${data.storeSiret ? `<p class="kv"><strong>SIRET :</strong> ${data.storeSiret}</p>` : ""}
                ${
                  addrOne
                    ? `<p class="kv"><strong>Adresse :</strong> ${addrOne}</p>`
                    : ""
                }
                ${
                  addrTwo || addrThree
                    ? `<p class="kv"><strong>Ville :</strong> ${[addrTwo, addrThree].filter(Boolean).join(", ")}</p>`
                    : ""
                }
                ${addrPhone ? `<p class="kv"><strong>Téléphone :</strong> ${addrPhone}</p>` : ""}
              </div>

              <div class="section">
                <h3>Montants</h3>
                <p class="kv"><strong>Total net (avant frais) :</strong> ${formattedGross || "N/A"}</p>
                <p class="kv"><strong>Frais PayLive :</strong> ${formattedFee || "N/A"}</p>
                <p class="kv"><strong>Montant viré :</strong> ${formattedPayout || "N/A"}</p>
              </div>

              <p><strong>L’équipe PayLive</strong></p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
              <p>© ${new Date().getFullYear()} PayLive - Tous droits réservés</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions: any = {
        from: `"PayLive - ${data.storeName}" <${process.env.SMTP_USER}>`,
        to,
        subject: `💸 Versement effectué — ${data.storeName}`,
        html: htmlContent,
        attachments:
          data.attachments && data.attachments.length > 0
            ? data.attachments
            : undefined,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("✅ Email versement envoyé au propriétaire:", {
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email versement propriétaire:", error);
      return false;
    }
  }

  async sendRaffleWinnerCongrats(data: {
    customerEmail: string;
    customerName?: string;
    storeName: string;
    storeLogo?: string;
  }): Promise<boolean> {
    try {
      const to = (data.customerEmail || "").trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return false;
      }
      const name = (data.customerName || "").trim();
      const logo = (data.storeLogo || "").trim();
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>🎉 Félicitations</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .brand { font-weight: 700; font-size: 18px; margin-bottom: 8px; }
            .header h1 { font-size: 36px; font-weight: 800; margin: 4px 0; }
            .sub { font-size: 20px; margin-top: 8px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            .logo { max-width: 100px; margin-bottom: 12px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logo ? `<img src="${logo}" alt="${data.storeName}" class="logo">` : ""}
              <div class="brand">${data.storeName}</div>
              <h1>🎉 Félicitations !</h1>
              <p class="sub">✅ Vous avez gagné lors de notre tirage au sort</p>
            </div>

            <div class="content">
              <h2>Bonjour ${name || ""},</h2>

              <p>Nous avons le plaisir de vous annoncer que vous avez été tiré(e) au sort lors de notre live.</p>

              <div class="details">
                <h3>📬 Prochaine étape</h3>
                <p>Notre équipe va vous recontacter très vite avec les modalités pour recevoir votre gain.</p>
                <p>Vous pouvez répondre directement à cet email si vous avez des questions.</p>
            </div>

              <p>🙏 Merci pour votre participation !</p>
              <p><strong>L'équipe ${data.storeName}</strong></p>
            </div>

            <div class="footer">
              <p>© ${new Date().getFullYear()} ${data.storeName} - Tous droits réservés</p>
            </div>
          </div>
        </body>
        </html>
      `;
      const info = await this.transporter.sendMail({
        from: `"${data.storeName}" <${process.env.SMTP_USER}>`,
        to,
        subject: `🎉 Félicitations — ${data.storeName}`,
        html: htmlContent,
      });
      console.log("raffle congrats email:", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("Erreur envoi email tirage:", error);
      return false;
    }
  }
}

// Exporter une instance unique du service
export const emailService = new EmailService();
export { CustomerEmailData, StoreOwnerEmailData, CustomerTrackingEmailData };
