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

interface AdminRefundRequestData {
  storeName: string;
  storeOwnerEmail?: string;
  storeSlug?: string;
  shippingOrderId: string;
  boxtalStatus?: string;
  shipmentId?: string;
  customerName?: string;
  customerEmail?: string;
  customerStripeId?: string;
  productReference?: string;
  amount?: number; // Montant produit (référence)
  deliveryCost?: number; // Frais de livraison
  total?: number; // Total à rembourser si applicable
  currency?: string; // ex: EUR
  paymentId?: string; // si disponible
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
      const formattedEstimatedDate = this.formatEstimatedDate(
        data.estimatedDeliveryDate
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
                  }
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

  // Email de notification pour le propriétaire de la boutique
  async sendStoreOwnerNotification(
    data: StoreOwnerEmailData
  ): Promise<boolean> {
    try {
      const formattedAmount = this.formatAmount(data.amount, data.currency);

      // Préparer les infos réseau (lien carte + image dimensions) selon deliveryNetwork
      const getNetworkInfo = (
        networkCode?: string
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
              networkInfo.imageFile
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
                <p><strong>Montant :</strong> <span class="amount">${formattedAmount}</span></p>
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
                  }
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
        subject: `💰 Nouvelle commande reçue - ${formattedAmount} - ${data.storeName}`,
        html: htmlContent,
        // Ajouter les pièces jointes si présentes
        ...(mailAttachments.length ? { attachments: mailAttachments } : {}),
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(
        `✅ Email de notification envoyé au propriétaire ${data.ownerEmail}`
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

  // Email d'alerte SAV quand le document Boxtal n'est pas disponible (422)
  async sendSupportShippingDocMissing(
    data: SupportShippingDocMissingData
  ): Promise<boolean> {
    try {
      const savEmail = process.env.SAV_EMAIL || "";
      if (!savEmail) {
        console.warn("SAV_EMAIL non configuré, email SAV non envoyé.");
        return false;
      }

      const formattedAmount =
        typeof data.amount === "number" && data.currency
          ? this.formatAmount(data.amount, data.currency)
          : undefined;

      const shippingAddressHtml = (() => {
        const a = data.shippingAddress?.address || {};
        const lines = [
          a.line1,
          a.line2,
          `${a.postal_code || ""} ${a.city || ""}`,
          a.country,
        ]
          .filter(Boolean)
          .join("<br>");
        return lines || "N/A";
      })();

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>SAV - Document d'expédition indisponible</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #dc3545 0%, #ff6b6b 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #dc3545; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
            .note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 6px; margin-top: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 SAV: Document d'expédition indisponible (422)</h1>
              <p>${data.storeName}</p>
            </div>
            <div class="content">
              <div class="section">
                <h3>Résumé</h3>
                <p class="kv"><strong>Store owner email :</strong> ${
                  data.storeOwnerEmail
                }</p>
                <p class="kv"><strong>Boxtal ID :</strong> ${data.boxtalId}</p>
                <p class="kv"><strong>Shipping Order ID :</strong> ${
                  data.shippingOrderId || "N/A"
                }</p>
                <p class="kv"><strong>Payment ID :</strong> ${
                  data.paymentId || "N/A"
                }</p>
              </div>

              <div class="section">
                <h3>Infos commande</h3>
                <p class="kv"><strong>Référence produit :</strong> ${
                  data.productReference || "N/A"
                }</p>
                <p class="kv"><strong>Montant :</strong> ${
                  formattedAmount || "N/A"
                }</p>
                <p class="kv"><strong>Méthode de livraison :</strong> ${
                  data.deliveryMethod || "N/A"
                }</p>
                <p class="kv"><strong>Réseau :</strong> ${
                  data.deliveryNetwork || "N/A"
                }</p>
                <p class="kv"><strong>Point relais </strong>(${
                  data.pickupPointCode || "N/A"
                })</p>
              </div>

              <div class="section">
                <h3>Infos client</h3>
                <p class="kv"><strong>Nom :</strong> ${
                  data.customerName || "N/A"
                }</p>
                <p class="kv"><strong>Email :</strong> ${
                  data.customerEmail || "N/A"
                }</p>
                <p class="kv"><strong>Téléphone :</strong> ${
                  data.customerPhone || "N/A"
                }</p>
                <p class="kv"><strong>Adresse :</strong><br>${shippingAddressHtml}</p>
              </div>

              <div class="section">
                <h3>Détails d'erreur</h3>
                <p>${
                  data.errorDetails || "Document Boxtal non disponible (422)"
                }</p>
                ${
                  data.additionalNote
                    ? `<div class="note">${data.additionalNote}</div>`
                    : ""
                }
              </div>

              <p>Merci de vérifier la disponibilité des documents côté Boxtal et de relancer la génération si nécessaire.</p>
              <p><strong>PayLive - Service SAV</strong></p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement suite à une indisponibilité de document d'expédition.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"PayLive SAV" <${process.env.SMTP_USER}>`,
        to: savEmail,
        subject: `🚨 SAV: Document Boxtal indisponible (422) - ${data.storeName}`,
        html: htmlContent,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email SAV envoyé à ${savEmail}`);
      console.log("📨 sendMail result (SAV):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email SAV:", error);
      return false;
    }
  }

  // Email de demande de remboursement au SAV après annulation Boxtal
  async sendAdminRefundRequest(data: AdminRefundRequestData): Promise<boolean> {
    try {
      const savEmail = process.env.SAV_EMAIL || process.env.SUPPORT_EMAIL || "";
      if (!savEmail) {
        console.warn("SAV_EMAIL/SUPPORT_EMAIL non configuré, email de remboursement non envoyé.");
        return false;
      }

      const formattedAmount = this.formatAmount(data.amount, data.currency || "EUR");
      const formattedDelivery = this.formatAmount(data.deliveryCost, data.currency || "EUR");
      const formattedTotal = this.formatAmount(data.total, data.currency || "EUR");

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Demande de remboursement client</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #0d6efd 0%, #6c63ff 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
            .section { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0d6efd; }
            .kv { margin: 0; }
            .kv strong { display: inline-block; width: 220px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💸 Remboursement à effectuer</h1>
              <p>${data.storeName}${data.storeSlug ? ` — ${data.storeSlug}` : ""}</p>
            </div>
            <div class="content">
              <div class="section">
                <h3>Résumé</h3>
                <p class="kv"><strong>Shipping Order ID :</strong> ${data.shippingOrderId}</p>
                <p class="kv"><strong>Statut Boxtal :</strong> ${data.boxtalStatus || "N/A"}</p>
                <p class="kv"><strong>Shipment ID :</strong> ${data.shipmentId || "N/A"}</p>
                <p class="kv"><strong>Store owner :</strong> ${data.storeOwnerEmail || "N/A"}</p>
              </div>

              <div class="section">
                <h3>Client</h3>
                <p class="kv"><strong>Nom :</strong> ${data.customerName || "N/A"}</p>
                <p class="kv"><strong>Email :</strong> ${data.customerEmail || "N/A"}</p>
                <p class="kv"><strong>Stripe Customer ID :</strong> ${data.customerStripeId || "N/A"}</p>
                <p class="kv"><strong>Payment ID :</strong> ${data.paymentId || "N/A"}</p>
              </div>

              <div class="section">
                <h3>Montants</h3>
                <p class="kv"><strong>Produit (référence) :</strong> ${formattedAmount || (typeof data.amount === "number" ? data.amount : "N/A")}</p>
                <p class="kv"><strong>Frais de livraison :</strong> ${formattedDelivery || (typeof data.deliveryCost === "number" ? data.deliveryCost : "N/A")}</p>
                <p class="kv"><strong>Total à rembourser :</strong> ${formattedTotal || (typeof data.total === "number" ? data.total : "N/A")}</p>
                <p class="kv"><strong>Devise :</strong> ${(data.currency || "EUR").toUpperCase()}</p>
              </div>

              <p>Suite à l'annulation de la commande Boxtal, merci d'effectuer le remboursement au client via Stripe (recherche par email ou customer ID).</p>
              <p><strong>PayLive - Service SAV</strong></p>
            </div>
          </div>
        </body>
        </html>
      `;

      const info = await this.transporter.sendMail({
        from: `"PayLive SAV" <${process.env.SMTP_USER}>`,
        to: savEmail,
        subject: `💸 Remboursement à effectuer - ${data.storeName}${formattedTotal ? ` - ${formattedTotal}` : ""}`,
        html: htmlContent,
      });
      console.log(`✅ Email remboursement envoyé à ${savEmail}`);
      console.log("📨 sendMail result (refund):", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      return true;
    } catch (error) {
      console.error("❌ Erreur envoi email remboursement:", error);
      return false;
    }
  }
  async sendCustomerTrackingUpdate(
    data: CustomerTrackingEmailData
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
      const to =
        process.env.SAV_EMAIL ||
        process.env.SUPPORT_EMAIL ||
        process.env.SMTP_USER ||
        "";
      if (!to) {
        console.error("sendAdminError: SAV_EMAIL/SUPPORT_EMAIL non configuré");
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
        from: process.env.SMTP_USER || "no-reply@example.com",
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
      const savEmail = process.env.SAV_EMAIL || "";
      if (!savEmail) {
        console.warn("SAV_EMAIL non configuré, email SAV non envoyé.");
        return false;
      }

      const formattedAmount = this.formatAmount(
        data.amount,
        (data.currency || "EUR") as string
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

              <div class="note">
                <strong>Note:</strong> Le montant indiqué est à titre indicatif et correspond aux gains actuellement disponibles. Merci de vérifier et de procéder au versement selon les informations fournies.
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
}

// Exporter une instance unique du service
export const emailService = new EmailService();
export { CustomerEmailData, StoreOwnerEmailData, CustomerTrackingEmailData };
