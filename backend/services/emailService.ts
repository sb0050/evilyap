import nodemailer from "nodemailer";

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
  productReference: string;
  amount: number;
  currency: string;
  paymentId: string;
  deliveryMethod?: "pickup_point" | "home_delivery" | "unknown";
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
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
}

interface StoreOwnerEmailData {
  ownerEmail: string;
  storeName: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  // NEW: delivery method and shipping info
  deliveryMethod?: "pickup_point" | "home_delivery" | "unknown";
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
  pickupPoint?: {
    id?: string;
    name?: string;
    network?: string;
    address?: {
      line1?: string;
      city?: string;
      postal_code?: string;
    };
  };
  productReference: string;
  amount: number;
  currency: string;
  paymentId: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Configuration SMTP - utiliser les variables d'environnement
    const emailConfig: EmailConfig = {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true", // true pour 465, false pour autres ports
      auth: {
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "", // Mot de passe d'application pour Gmail
      },
    };

    console.log("✉️ SMTP config:", {
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      user: emailConfig.auth.user,
      pass: emailConfig.auth.pass ? "***" : "(empty)",
    });

    this.transporter = nodemailer.createTransport(emailConfig);
    this.verifyConnection().catch((err) => {
      console.error("❌ SMTP verify failed at startup:", err);
    });
  }

  // Vérifier la configuration email
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log("✅ Service email configuré correctement");
      return true;
    } catch (error) {
      console.error("❌ Erreur de configuration email:", error);
      return false;
    }
  }

  // Formater le montant
  private formatAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  }

  // Email de confirmation pour le client
  async sendCustomerConfirmation(data: CustomerEmailData): Promise<boolean> {
    try {
      const formattedAmount = this.formatAmount(data.amount, data.currency);

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Confirmation de commande</title>
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
              <h1>Merci pour votre commande !</h1>
              <p>Votre paiement a été traité avec succès</p>
            </div>
            
            <div class="content">
              <h2>Bonjour ${data.customerName},</h2>
              
              <p>Nous vous confirmons que votre commande a été validée et que votre paiement a été traité avec succès.</p>
              
              <div class="order-details">
                <h3>Détails de votre commande</h3>
                <p><strong>Boutique :</strong> ${data.storeName}</p>
                ${
                  data.storeDescription
                    ? `<p><strong>Description :</strong> ${data.storeDescription}</p>`
                    : ""
                }
                <p><strong>Référence produit :</strong> ${
                  data.productReference
                }</p>
                <p><strong>Montant payé :</strong> <span class="amount">${formattedAmount}</span></p>
                <p><strong>ID de transaction :</strong> ${data.paymentId}</p>
              </div>
              
              <p>Vous recevrez prochainement un email avec les détails de livraison de votre commande.</p>
              
              <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
              
              <p>Merci de votre confiance !</p>
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
        subject: `Confirmation de commande - ${data.storeName}`,
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

      // Compose shipping info HTML depending on delivery method
      const shippingInfoHtml = (() => {
        if (data.deliveryMethod === "pickup_point" && data.pickupPoint) {
          return `
            <div class="order-details">
              <h3>🏪 Retrait en point relais</h3>
              <p><strong>Point relais :</strong> ${
                data.pickupPoint.name || ""
              } (${data.pickupPoint.network || ""})</p>
              <p><strong>Adresse :</strong><br>
                ${data.pickupPoint.address?.line1 || ""}<br>
                ${data.pickupPoint.address?.postal_code || ""} ${
            data.pickupPoint.address?.city || ""
          }
              </p>
            </div>
          `;
        }
        if (data.deliveryMethod === "home_delivery" && data.shippingAddress) {
          return `
            <div class="order-details">
              <h3>🏠 Livraison à domicile</h3>
              <p><strong>Adresse de livraison :</strong><br>
                ${data.shippingAddress.name || data.customerName}<br>
                ${data.shippingAddress.address?.line1 || ""}<br>
                ${
                  data.shippingAddress.address?.line2
                    ? data.shippingAddress.address.line2 + "<br>"
                    : ""
                }
                ${data.shippingAddress.address?.postal_code || ""} ${
            data.shippingAddress.address?.city || ""
          }<br>
                ${data.shippingAddress.address?.country || ""}
              </p>
            </div>
          `;
        }
        // Unknown method: show what we have
        if (data.shippingAddress) {
          return `
            <div class="order-details">
              <h3>📮 Informations de livraison</h3>
              <p><strong>Nom :</strong> ${
                data.shippingAddress.name || data.customerName
              }</p>
              <p><strong>Adresse :</strong><br>
                ${data.shippingAddress.address?.line1 || ""}<br>
                ${
                  data.shippingAddress.address?.line2
                    ? data.shippingAddress.address.line2 + "<br>"
                    : ""
                }
                ${data.shippingAddress.address?.postal_code || ""} ${
            data.shippingAddress.address?.city || ""
          }<br>
                ${data.shippingAddress.address?.country || ""}
              </p>
            </div>
          `;
        }
        return "";
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
              </div>

              ${shippingInfoHtml}
              
              <p>Le client a été automatiquement notifié par email de la confirmation de sa commande.</p>
              
              <p><strong>Action requise :</strong> Veuillez préparer et expédier la commande dans les plus brefs délais.</p>
              
              <p>Bonne vente !</p>
              <p><strong>L'équipe Live Shopping</strong></p>
            </div>
            
            <div class="footer">
              <p>Cet email a été envoyé automatiquement depuis votre boutique ${
                data.storeName
              }</p>
              <p>© ${new Date().getFullYear()} Live Shopping App - Tous droits réservés</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"Live Shopping - ${data.storeName}" <${process.env.SMTP_USER}>`,
        to: data.ownerEmail,
        subject: `💰 Nouvelle commande reçue - ${formattedAmount} - ${data.storeName}`,
        html: htmlContent,
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
}

// Exporter une instance unique du service
export const emailService = new EmailService();
export { CustomerEmailData, StoreOwnerEmailData };
