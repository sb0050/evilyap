import express from "express";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { clerkClient, getAuth } from "@clerk/express";

const router = express.Router();

const requireAdmin = async (
  req: express.Request,
  res: express.Response,
): Promise<{ userId: string } | null> => {
  const auth = getAuth(req);
  if (!auth?.isAuthenticated || !auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const role = String((user as any)?.publicMetadata?.role || "")
      .trim()
      .toLowerCase();
    if (role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    return { userId: String(auth.userId) };
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Erreur interne" });
    return null;
  }
};

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

const resolveFirstName = (nameRaw?: unknown, emailRaw?: unknown) => {
  const fromName = String(nameRaw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (fromName) {
    return fromName.charAt(0).toUpperCase() + fromName.slice(1);
  }
  const local = String(emailRaw || "")
    .split("@")[0]
    .trim();
  if (!local) return "";
  const cleaned = local
    .replace(/[._\-+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

router.post("/prospect", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { email, name } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }
    const firstName = resolveFirstName(name, to);
    if (!firstName) {
      return res.status(400).json({ error: "Nom invalide" });
    }

    const transporter = createProspectTransporter();

    const subject = `${firstName}, Vous gérez encore vos commandes de vos live à la main ? 🤔`;
    const greeting = `Bonjour ${firstName},`;

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
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">Vous gérez encore vos commandes de vos live à la main ?</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">${greeting}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Faire de la vente en live, ça devrait être simple : trouver les meilleurs articles pour vos clientes, animer votre communauté, et vendre. Mais dans les faits, vous passez la majorité de votre temps sur la logistique, l'organisation du live, et tout ce qui vient après, au lieu de vous concentrer sur ce qui fait vraiment la différence.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Vous envoyez vos récapitulatifs de commande à la main. Vous relancez les paniers impayés un par un. Vous créez chaque colis manuellement. Vous répondez 10 fois par jour à "Mon colis a-t-il été envoyé ?".
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Sans parler des liens de paiement envoyés à la main, des ventes notées dans un tableau Excel, des factures rédigées une par une, et d'un suivi client qui n'existe tout simplement pas.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Ce n'est pas une façon de faire grandir sa boutique. C'est une façon de s'épuiser.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            C'est exactement ce problème qu'on a résolu avec PayLive.
          </p>

          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">PayLive est une solution tout-en-un pensée pour les vendeuses en live :</div>
            <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.8;">
              <li>✅ Récapitulatifs de commande envoyés automatiquement à vos clientes</li>
              <li>✅ Relances des paniers impayés sans aucune intervention de votre part</li>
              <li>✅ Création de colis automatisée (Mondial Relay, Colissimo…)</li>
              <li>✅ Liens de paiement générés et envoyés en un clic</li>
              <li>✅ Suivi de vos clientes, factures et statistiques au même endroit</li>
              <li>✅ Frais sur vos paiements réduits, bien en dessous de PayPal, SumUp ou Lydia</li>
            </ul>
          </div>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Vos clientes sont informées à chaque étape. Vous, vous faites du live.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Je serais ravie de vous montrer concrètement comment ça fonctionne, en 10 minutes chrono.
          </p>
          <p style="margin:16px 0 0 0;font-size:16px;line-height:1.6;font-weight:700;">
            👉 Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?
          </p>
          <p style="margin:8px 0 0 0;font-size:16px;line-height:1.6;font-weight:700;">
            👉 Quel est votre numéro de téléphone pour qu'on puisse échanger directement ?
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

    const text = `${greeting}\n\nFaire de la vente en live, ça devrait être simple : trouver les meilleurs articles pour vos clientes, animer votre communauté, et vendre. Mais dans les faits, vous passez la majorité de votre temps sur la logistique, l'organisation du live, et tout ce qui vient après, au lieu de vous concentrer sur ce qui fait vraiment la différence.\n\nVous envoyez vos récapitulatifs de commande à la main. Vous relancez les paniers impayés un par un. Vous créez chaque colis manuellement. Vous répondez 10 fois par jour à "Mon colis a-t-il été envoyé ?".\n\nSans parler des liens de paiement envoyés à la main, des ventes notées dans un tableau Excel, des factures rédigées une par une, et d'un suivi client qui n'existe tout simplement pas.\n\nCe n'est pas une façon de faire grandir sa boutique. C'est une façon de s'épuiser.\n\nC'est exactement ce problème qu'on a résolu avec PayLive.\n\nPayLive est une solution tout-en-un pensée pour les vendeuses en live :\n✅ Récapitulatifs de commande envoyés automatiquement à vos clientes\n✅ Relances des paniers impayés sans aucune intervention de votre part\n✅ Création de colis automatisée (Mondial Relay, Colissimo…)\n✅ Liens de paiement générés et envoyés en un clic\n✅ Suivi de vos clientes, factures et statistiques au même endroit\n✅ Frais sur vos paiements réduits, bien en dessous de PayPal, SumUp ou Lydia\n\nVos clientes sont informées à chaque étape. Vous, vous faites du live.\n\nJe serais ravie de vous montrer concrètement comment ça fonctionne, en 10 minutes chrono.\n\n👉 Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?\n👉 Quel est votre numéro de téléphone pour qu'on puisse échanger directement ?\n\nÀ très vite,\nL’équipe PayLive.cc`;

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

router.post("/rdv-demo", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { email, name } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }
    const firstName = resolveFirstName(name, to);
    if (!firstName) {
      return res.status(400).json({ error: "Nom invalide" });
    }
    const transporter = createProspectTransporter();
    const subject = `${firstName}, on organise une démo ? 🚀`;
    const greeting = `Bonjour ${firstName},`;
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
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { email, slug, name } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }
    const slugRaw = String(slug || "").trim();
    if (!slugRaw) {
      return res.status(400).json({ error: "Slug boutique manquant" });
    }
    const slugSafe = encodeURIComponent(slugRaw);
    const firstName = resolveFirstName(name, to);
    if (!firstName) {
      return res.status(400).json({ error: "Nom invalide" });
    }

    const transporter = createProspectTransporter();
    const subject = `${firstName}, suite à notre échange, retrouvez ci-dessous le tutoriel et le lien vers votre boutique.`;
    const greeting = `Bonjour ${firstName},`;
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
      <title>Suite à notre échange, la démo est par ici</title>
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
