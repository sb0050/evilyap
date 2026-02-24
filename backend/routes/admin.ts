import express from "express";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { getAuth } from "@clerk/express";

const router = express.Router();

const createGmailTransporter = () => {
  const host = process.env.SMTP_GMAIL_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_GMAIL_PORT || "465", 10);
  const secure =
    (process.env.SMTP_GMAIL_SECURE || "true").toLowerCase() === "true";
  const user = process.env.SMTP_GMAIL_USER || "";
  const pass = process.env.SMTP_GMAIL_PASS || "";
  if (!user || !pass) {
    throw new Error("SMTP Gmail credentials missing");
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

    const transporter = createGmailTransporter();

    const subject = "Une solution simple pour booster tes ventes en live 🎉";

    const logoPath = path.resolve(process.cwd(), "public", "black.png");
    const hasLogo = fs.existsSync(logoPath);
    const shots = [
      {
        path: path.resolve(process.cwd(), "public", "1.jpg"),
        cid: "client-1",
        filename: "1.jpg",
      },
      {
        path: path.resolve(process.cwd(), "public", "2.jpg"),
        cid: "client-2",
        filename: "2.jpg",
      },
      {
        path: path.resolve(process.cwd(), "public", "3.jpg"),
        cid: "client-3",
        filename: "3.jpg",
      },
      {
        path: path.resolve(process.cwd(), "public", "4.jpg"),
        cid: "client-4",
        filename: "4.jpg",
      },
      {
        path: path.resolve(process.cwd(), "public", "5.jpg"),
        cid: "client-5",
        filename: "5.jpg",
      },
      {
        path: path.resolve(process.cwd(), "public", "6.jpg"),
        cid: "client-6",
        filename: "6.jpg",
      },
    ];
    const existingShots = shots.filter((s) => fs.existsSync(s.path));
    const hasShots = existingShots.length > 0;
    const perRow = 3;
    const cellWidth = (100 / perRow).toFixed(3);
    const gridRowsHtml = (() => {
      const rows: string[] = [];
      for (let i = 0; i < existingShots.length; i += perRow) {
        const rowShots = existingShots.slice(i, i + perRow);
        const rowHtml = `<tr>${rowShots
          .map(
            (s) =>
              `<td style="width:${cellWidth}%; padding:2px;"><img src="cid:${s.cid}" alt="Capture Paylive" style="width:100%; border-radius:10px; box-shadow:0 6px 14px rgba(15,23,42,0.12); display:block;" /></td>`,
          )
          .join("")}</tr>`;
        rows.push(rowHtml);
      }
      return rows.join("");
    })();

    const html = `<!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Paylive — Prospection</title>
    </head>
    <body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:#0f172a;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.08);overflow:hidden;">
        <div style="background:linear-gradient(90deg,#7c3aed,#2563eb);padding:24px;text-align:center;">
          ${
            hasLogo
              ? `<img src="cid:paylive-logo" alt="Paylive" style="height:40px;vertical-align:middle;" />`
              : `<div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">Paylive</div>`
          }
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">Encaissement instantané pendant tes lives</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">Bonjour 😊,</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            J’ai regardé plusieurs de tes lives récemment, et franchement tu gères <span style="font-weight:700;">super bien</span> !
            Si je t’écris aujourd’hui, c’est parce que je suis convaincu que <span style="font-weight:700;color:#7c3aed;">Paylive</span> peut t’aider à <span style="font-weight:700;">booster tes ventes</span> pendant tes lives, sans te compliquer la vie.
          </p>

          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:8px;">Côté client, c’est ultra simple :</div>
            <ul style="list-style:none;padding:0;margin:0;">
              <li style="margin:8px 0;">
                <span style="display:inline-block;width:10px;height:10px;background:#7c3aed;border-radius:50%;margin-right:10px;vertical-align:middle;"></span>
                Ils tapent <span style="font-weight:700;">la référence</span> que tu annonces
              </li>
              <li style="margin:8px 0;">
                <span style="display:inline-block;width:10px;height:10px;background:#6366f1;border-radius:50%;margin-right:10px;vertical-align:middle;"></span>
                Ils choisissent <span style="font-weight:700;">le mode de livraison</span>
              </li>
              <li style="margin:8px 0;">
                <span style="display:inline-block;width:10px;height:10px;background:#2563eb;border-radius:50%;margin-right:10px;vertical-align:middle;"></span>
                Et paient <span style="font-weight:700;">en quelques secondes</span>
              </li>
            </ul>
          </div>

          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:8px;">De ton côté, tout est <span style="font-weight:700;color:#22c55e;">clean</span> dans le dashboard :</div>
            <div style="color:#334155;">commandes, bordereaux, infos clients, codes promo, suivi… ✨</div>
          </div>

          <div style="margin-top:18px;padding:14px;border-left:4px solid #7c3aed;background:#f3f4f6;border-radius:8px;">
            <div style="font-size:16px;font-weight:800;color:#111827;">0€ d’abonnement, aucun frais caché — <span style="color:#7c3aed;">seulement 4% par vente</span>.
            <p style="margin:12px 0 0 0;font-size:16px;line-height:1.6;font-weight:700;">
            Et en ce moment seulement, on t’offre tes 10 premiers live à seulement  
            <span style="background:linear-gradient(90deg,#7c3aed,#2563eb);-webkit-background-clip:text;background-clip:text;color:#7c3aed;-webkit-text-fill-color:transparent;">1% de commission</span>,
            donc tu touches 100% de ce que tu vends ! 🔥
          </p> 
            </div>
          </div>

          

          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Je peux t’aider à <span style="font-weight:700;">créer ta boutique Paylive</span> et la personnaliser (logo, couleurs, bannières, photos…).
          </p>

          <div style="text-align:center;margin-top:22px;">
            <a href="https://paylive.cc/onboarding" style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:700;box-shadow:0 8px 18px rgba(37,99,235,0.25);">Créer ma boutique gratuite</a>
            <div style="margin-top:8px;font-size:13px;color:#64748b;">C’est rapide et gratuit</div>
            <div style="margin-top:12px;">
              <a href="https://www.tiktok.com/@paylive.cc" target="_blank" rel="noopener" style="display:inline-block;color:#2563eb;text-decoration:none;font-weight:700;">Suivre Paylive sur TikTok</a> 👉 
              <a href="https://www.tiktok.com/@paylive.cc" target="_blank" rel="noopener" style="display:inline-block;background:rgb(234, 40, 78);color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;box-shadow:0 6px 14px rgba(234, 40, 78, 0.25);">Suivre</a>
            </div>
          </div>

          ${
            hasShots
              ? `
          <div style="margin-top:24px;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">Quelques aperçus de l'interface</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              ${gridRowsHtml}
            </table>
          </div>
          `
              : ""
          }

          <p style="margin:22px 0 0 0;font-size:16px;line-height:1.6;">
            Je suis dispo quand tu veux pour une <span style="font-weight:700;">démo rapide</span> ou pour répondre à toutes tes questions.
          </p>

          <div style="margin-top:18px;padding:16px;border:1px dashed #c7d2fe;border-radius:10px;background:#f8fafc;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:6px;">Petit bonus :</div>
            <div style="color:#334155;">On a une équipe dédiée qui fait évoluer Paylive en continu, en fonction des besoins des vendeurs, pour que l’outil colle vraiment à <span style="font-weight:700;">ta façon de vendre</span>.</div>
          </div>

          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            N’hésite surtout pas à me répondre, je serai ravi de t’aider ❤️
          </p>

          <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:14px;font-size:14px;color:#475569;">
            Cordialement,<br />
            <span style="font-weight:700;">L’équipe Paylive.cc</span>
          </div>
        </div>

        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">
          © ${new Date().getFullYear()} Paylive — Tous droits réservés
        </div>
      </div>
    </body>
    </html>`;

    const text = `Bonjour\n\nJ’ai regardé plusieurs de tes lives récemment, et franchement tu gères super bien !\nSi je t’écris aujourd’hui, c’est parce que je suis convaincu que Paylive peut t’aider à booster tes ventes pendant tes lives, sans te compliquer la vie.\n\nAvec Paylive, tes clients:\n- tapent simplement la référence que tu annonces\n- choisissent leur mode de livraison\n- et paient en quelques secondes\n\nDe ton côté, tout est clean dans le dashboard: commandes, bordereaux, infos clients, codes promo, suivi…\n\n0€ d’abonnement, aucun frais caché — seulement 4% par vente.\n\nCréer ta boutique gratuite: https://paylive.cc/onboarding\nSuivre Paylive sur TikTok: https://www.tiktok.com/@paylive.cc\n\nJe suis dispo quand tu veux pour une démo rapide ou pour répondre à toutes tes questions.\n\nPetit bonus: On a une équipe dédiée qui fait évoluer Paylive en continu.\n\nCordialement,\nL’équipe Paylive.cc`;

    const fromEmail = process.env.SMTP_GMAIL_USER || "paylive.cc@gmail.com";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "paylive.png",
        content: fs.readFileSync(logoPath),
        cid: "paylive-logo",
        contentType: "image/png",
      });
    }
    existingShots.forEach((s) => {
      attachments.push({
        filename: s.filename,
        content: fs.readFileSync(s.path),
        cid: s.cid,
        contentType: "image/jpeg",
      });
    });

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
