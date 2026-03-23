import express from "express";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { getAuth } from "@clerk/express";

const router = express.Router();

const createProspectTransporter = () => {
  const host = process.env.SMTP_HOST || "";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!host) {
    throw new Error("SMTP_HOST manquant");
  }
  if (!user || !pass) {
    throw new Error("SMTP credentials missing");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  } as any);
};

router.post("/prospect", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { email } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }

    const transporter = createProspectTransporter();

    const subject = "On organise une démo ? 🚀";
    const firstNameGuess = (() => {
      const local = String(to.split("@")[0] || "").trim();
      if (!local) return "";
      const cleaned = local
        .replace(/[._\-+]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return "";
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    })();
    const greeting = firstNameGuess ? `Bonjour ${firstNameGuess},` : "Bonjour,";

    const logoPath = path.resolve(process.cwd(), "public", "black.png");
    const hasLogo = fs.existsSync(logoPath);

    const html = `<!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>On organise une démo ?</title>
    </head>
    <body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:#0f172a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.08);overflow:hidden;">
        <div style="background:linear-gradient(90deg,#7c3aed,#2563eb);padding:24px;text-align:center;">
          ${
            hasLogo
              ? `<img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" />`
              : `<div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div>`
          }
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">On organise une démo ? 🚀</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">${greeting}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Merci pour votre inscription !
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Pour aller plus loin, je vous propose une démo rapide (10 min) pour vous montrer
            <span style="font-weight:700;color:#7c3aed;"> PayLive</span> en action — directement sur vos cas d’usage.
          </p>

          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">Deux petites choses pour qu’on cale ça :</div>
            <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.8;">
              <li>Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?</li>
              <li>Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?</li>
            </ul>
          </div>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Hâte de vous faire découvrir la solution !
          </p>

          <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:14px;font-size:14px;color:#475569;">
            À très vite,<br />
            <span style="font-weight:700;">L’équipe <a href="https://www.paylive.cc" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">PayLive.cc</a></span>
          </div>
        </div>
        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">
          © ${new Date().getFullYear()} PayLive.cc — Tous droits réservés
        </div>
      </div>
    </body>
    </html>`;

    const text = `${greeting}\n\nRavi d’avoir pu échanger avec vous !\n\nPour aller plus loin, je vous propose une démo rapide (10 min) pour vous montrer PayLive en action — directement sur vos cas d’usage.\n\nDeux petites choses pour qu’on cale ça :\n• Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?\n• Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?\n\nHâte de vous faire découvrir la solution !\n\nÀ très vite,\nL’équipe PayLive.cc`;

    const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "paylive.png",
        content: fs.readFileSync(logoPath),
        cid: "paylive-logo",
        contentType: "image/png",
      });
    }

    const info = await transporter.sendMail({
      from: `Paylive.cc <${fromEmail}>`,
      to,
      subject,
      text,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return res.json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
});

router.post("/demo", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { email, slug } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }
    const slugRaw = String(slug || "").trim();
    if (!slugRaw) {
      return res.status(400).json({ error: "Slug boutique manquant" });
    }
    const slugSafe = encodeURIComponent(slugRaw);

    const transporter = createProspectTransporter();
    const subject =
      "Suite à notre échange — Retrouvez ci-dessous le tutoriel et le lien vers votre boutique 👇";
    const firstNameGuess = (() => {
      const local = String(to.split("@")[0] || "").trim();
      if (!local) return "";
      const cleaned = local
        .replace(/[._\-+]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return "";
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    })();
    const greeting = firstNameGuess ? `Bonjour ${firstNameGuess},` : "Bonjour,";
    const demoLinkRaw = String(process.env.DEMO_SELLER_LINK || "").trim();
    if (!demoLinkRaw) {
      return res.status(500).json({ error: "DEMO_SELLER_LINK manquant" });
    }
    const demoLink = /^https?:\/\//i.test(demoLinkRaw)
      ? demoLinkRaw
      : `https://${demoLinkRaw}`;
    const storeLink = `https://paylive.cc/s/${slugSafe}`;
    const checkoutLink = `https://paylive.cc/c/${slugSafe}`;
    const logoPath = path.resolve(process.cwd(), "public", "black.png");
    const hasLogo = fs.existsSync(logoPath);

    const html = `<!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Suite à notre échange — la démo est par ici</title>
    </head>
    <body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:#0f172a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.08);overflow:hidden;">
        <div style="background:linear-gradient(90deg,#7c3aed,#2563eb);padding:24px;text-align:center;">
          ${
            hasLogo
              ? `<img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" />`
              : `<div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div>`
          }
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">Retrouvez ci-dessous le tutoriel et le lien vers votre boutique 👇</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">${greeting}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Ravi d’avoir pu échanger avec vous !
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Comme promis, voici le lien vers notre tutoriel
          </p>
          <p style="margin:18px 0 0 0;font-size:17px;line-height:1.6;font-weight:700;">
            👉 <a href="${demoLink}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">Cliquez ici pour accéder au tutoriel</a>
          </p>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            J'ai également créé votre boutique personnalisée avec l'ensemble de vos articles, vous pouvez y accéder ici :
          </p>
          <p style="margin:10px 0 0 0;font-size:16px;line-height:1.6;font-weight:700;">
            🛍️ <a href="${storeLink}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">Lien vers votre boutique</a>
          </p>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Et voici le lien à partager directement à vos clientes lors de vos prochains lives afin qu'elles puissent constituer leurs paniers et procéder au paiement :
          </p>
          <p style="margin:10px 0 0 0;font-size:16px;line-height:1.6;font-weight:700;">
            📲 <a href="${checkoutLink}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">Lien à partager en live</a>
          </p>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            N’hésitez pas à me contacter si vous avez des questions !
          </p>
          <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:14px;font-size:14px;color:#475569;">
            À très vite,<br />
            <span style="font-weight:700;">L’équipe <a href="https://www.paylive.cc" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">PayLive.cc</a></span>
          </div>
        </div>

        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">
          © ${new Date().getFullYear()} PayLive.cc — Tous droits réservés
        </div>
      </div>
    </body>
    </html>`;

    const text = `${greeting}\n\nRavi d’avoir pu échanger avec vous !\n\nComme promis, voici le lien vers notre tutoriel\n\n👉 Cliquez ici pour accéder au tutoriel : ${demoLink}\n\nJ'ai également créé votre boutique personnalisée avec l'ensemble de vos articles, vous pouvez y accéder ici :\n\n🛍️ Lien vers votre boutique : ${storeLink}\n\nEt voici le lien à partager directement à vos clientes lors de vos prochains lives afin qu'elles puissent constituer leurs paniers et procéder au paiement :\n\n📲 Lien à partager en live : ${checkoutLink}\n\nN’hésitez pas à me contacter si vous avez des questions !\n\nÀ très vite,\nL’équipe PayLive.cc`;

    const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "paylive.png",
        content: fs.readFileSync(logoPath),
        cid: "paylive-logo",
        contentType: "image/png",
      });
    }

    const info = await transporter.sendMail({
      from: `Paylive.cc <${fromEmail}>`,
      to,
      subject,
      text,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return res.json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
});

export default router;
