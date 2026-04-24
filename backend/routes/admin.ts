import express from "express";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { clerkClient, getAuth } from "@clerk/express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

const STATUS_LABEL_TO_ID: Record<string, number> = {
  "A contacter": 1,
  "Contacté": 2,
  "Répondu": 3,
  "Interessé": 4,
  "Call / Démo prévu": 5,
  "En Onboarding": 6,
  "Perdu / Refusé": 7,
  "Actif": 8,
};

const normalizeStatusToId = (raw: unknown): number | null => {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 8) {
    return asNumber;
  }

  if (value in STATUS_LABEL_TO_ID) {
    return STATUS_LABEL_TO_ID[value];
  }

  return null;
};

const normalizeStoreForCompare = (raw: unknown): string =>
  String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const findLeadByStore = async (
  normalizedStore: string,
  excludedLeadId?: string,
): Promise<{ id: string } | null> => {
  const { data, error } = await supabase
    .from("leads")
    .select("id, store")
    .not("store", "is", null);

  if (error) {
    throw new Error(error.message || "Erreur vérification boutique lead");
  }

  const match = (data || []).find((row: any) => {
    const sameStore = normalizeStoreForCompare(row?.store) === normalizedStore;
    const sameLead = excludedLeadId
      ? String(row?.id || "").trim() === excludedLeadId
      : false;
    return sameStore && !sameLead;
  });

  if (!match) return null;
  return { id: String(match.id || "") };
};

router.post("/leads", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const {
      name,
      store,
      phone,
      email,
      webLink,
      quickNote,
      note,
      imageUrl,
      status,
    } = req.body || {};

    const leadName = String(name || "").trim();
    if (!leadName) {
      return res.status(400).json({ error: "Nom du prospect requis" });
    }

    const leadStatusId = normalizeStatusToId(status ?? 1);
    if (!leadStatusId) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    const normalizedStore = normalizeStoreForCompare(store);
    if (normalizedStore) {
      const existingLead = await findLeadByStore(normalizedStore);
      if (existingLead) {
        return res.status(409).json({ error: "Cette boutique existe deja" });
      }
    }

    const payload = {
      name: leadName,
      store: String(store || "").trim() || null,
      phone: String(phone || "").trim() || null,
      mail: String(email || "").trim().toLowerCase() || null,
      link: String(webLink || "").trim() || null,
      quick_note: String(quickNote || "").trim() || null,
      note: String(note || "").trim() || null,
      image_url: String(imageUrl || "").trim() || null,
      status: leadStatusId,
    };

    const { data, error } = await supabase
      .from("leads")
      .insert([payload])
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message || "Erreur insertion lead" });
    }

    return res.json({ success: true, lead: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
});

router.get("/leads", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message || "Erreur lecture leads" });
    }

    return res.json({ success: true, leads: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
});

const updateLeadHandler: express.RequestHandler = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const leadId = String(req.params.id || "").trim();
    if (!leadId) {
      return res.status(400).json({ error: "Lead id invalide" });
    }

    const body = req.body || {};
    const payload: Record<string, any> = {};

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = String(body.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Nom du prospect requis" });
      }
      payload.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, "store")) {
      const store = String(body.store || "").trim();
      if (!store) {
        return res.status(400).json({ error: "Boutique requise" });
      }
      const normalizedStore = normalizeStoreForCompare(store);
      const existingLead = await findLeadByStore(normalizedStore, leadId);
      if (existingLead) {
        return res.status(409).json({ error: "Cette boutique existe deja" });
      }
      payload.store = store;
    }
    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      payload.phone = String(body.phone || "").trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const nextEmail = String(body.email || "").trim().toLowerCase();
      payload.mail = nextEmail || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "webLink")) {
      payload.link = String(body.webLink || "").trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "quickNote")) {
      payload.quick_note = String(body.quickNote || "").trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "note")) {
      payload.note = String(body.note || "").trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "imageUrl")) {
      payload.image_url = String(body.imageUrl || "").trim() || null;
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "Aucun champ valide à mettre à jour" });
    }

    const { data, error } = await supabase
      .from("leads")
      .update(payload)
      .eq("id", leadId)
      .select("*")
      .single();
    if (error) {
      return res.status(500).json({ error: error.message || "Erreur maj lead" });
    }

    return res.json({ success: true, lead: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
};

router.patch("/leads/:id", updateLeadHandler);
router.put("/leads/:id", updateLeadHandler);

const deleteLeadHandler: express.RequestHandler = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const leadId = String(req.params.id || "").trim();
    if (!leadId) {
      return res.status(400).json({ error: "Lead id invalide" });
    }

    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (error) {
      return res.status(500).json({ error: error.message || "Erreur suppression lead" });
    }

    return res.json({ success: true, id: leadId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
};

router.delete("/leads/:id", deleteLeadHandler);

const updateLeadStatusHandler: express.RequestHandler = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const leadId = String(req.params.id || "").trim();
    if (!leadId) {
      return res.status(400).json({ error: "Lead id invalide" });
    }

    const leadStatusId = normalizeStatusToId(req.body?.status);
    if (!leadStatusId) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    const { data, error } = await supabase
      .from("leads")
      .update({ status: leadStatusId })
      .eq("id", leadId)
      .select("*")
      .single();
    if (error) {
      return res.status(500).json({ error: error.message || "Erreur maj status lead" });
    }

    return res.json({ success: true, lead: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur interne" });
  }
};

router.patch("/leads/:id/status", updateLeadStatusHandler);
router.put("/leads/:id/status", updateLeadStatusHandler);

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

    const subject = `${firstName}, marre des paniers abandonnés après tes ventes en live sur Facebook ?`;
    const greeting = `Bonjour ${firstName},`;

    const logoPath = path.resolve(process.cwd(), "public", "logo_bis.png");
    const hasLogo = fs.existsSync(logoPath);
    const adImageCandidates = [
      path.resolve(process.cwd(), "public", "ad_paylive.png"),
      path.resolve(process.cwd(), "..", "frontend", "public", "ad_paylive.png"),
    ];
    const adImagePath = adImageCandidates.find((p) => fs.existsSync(p)) || "";
    const hasAdImage = Boolean(adImagePath);

    const html = `<!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>PayLive</title>
    </head>
    <body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:#0f172a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.08);overflow:hidden;">
        <div style="background:linear-gradient(90deg,#7c3aed,#2563eb);padding:24px;text-align:center;">
          ${
            hasLogo
              ? `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer"><img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" /></a>`
              : `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div></a>`
          }
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">Marre des paniers abandonnés après tes ventes en live sur Facebook ?</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">${greeting}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Est-ce que tu rencontres ce genre de problèmes pendant ou après tes ventes en live sur Facebook ?
          </p>
          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">❌ commandes à noter</div>
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">❌ paiements à vérifier</div>
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">❌ colis à créer</div>
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">❌ clientes à relancer</div>
            <div style="font-weight:700;color:#0f172a;">❌ récap + lien de paiement à envoyer manuellement</div>
          </div>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Au final, tu passes plus de temps à gérer qu’à vendre.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            C’est exactement pour ça qu’on a créé PayLive.
          </p>
          <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">👉 PayLive automatise tout ce qui te fait perdre du temps :</div>
            <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.8;">
              <li>💳 Notification instantané au paiement </li>
              <li>📦 Livraison & bordereaux intégrés</li>
              <li>📋 Envoi automatique des paniers</li>
              <li>📊 Suivi de tes ventes et de ton stock</li>
            </ul>
          </div>
          <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
            Résultat : tu te concentres sur tes lives… et PayLive s’occupe du reste.
          </p>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;text-align:center;">
            👇 Clique sur le bouton ci-dessous pour voir comment ça marche 👇
          </p>
          <div style="margin-top:18px;text-align:center;">
            <a href="https://paylive.cc/needademo" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">Voir comment ça marche</a>
          </div>
          ${
            hasAdImage
              ? `<div style="margin-top:18px;">
            <a href="https://paylive.cc/needademo" target="_blank" rel="noopener noreferrer">
              <img src="cid:paylive-ad" alt="PayLive" style="width:100%;max-width:620px;border-radius:10px;border:1px solid #e5e7eb;display:block;" />
            </a>
          </div>`
              : `<div style="margin-top:18px;">
            <a href="https://paylive.cc/needademo" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#2563eb;text-decoration:underline;font-weight:600;">Découvrir PayLive</a>
          </div>`
          }

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

    const text = `${greeting}\n\nEst-ce que tu rencontres ce genre de problèmes pendant ou après tes ventes en live sur Facebook ?\n\n❌ commandes à noter\n❌ paiements à vérifier\n❌ colis à créer\n❌ clientes à relancer\n❌ récap + lien de paiement à envoyer manuellement\n\nAu final, tu passes plus de temps à gérer qu’à vendre.\n\nC’est exactement pour ça qu’on a créé PayLive.\n\n👉 PayLive automatise tout ce qui te fait perdre du temps :\n💳 Notification instantané au paiement\n📦 Livraison & bordereaux intégrés\n📋 Envoi automatique des paniers\n📊 Suivi de tes ventes et de ton stock\n\nRésultat : tu te concentres sur tes lives… et PayLive s’occupe du reste.\n\n 👇 Clique sur le bouton ci-dessous pour voir comment ça marche 👇: https://paylive.cc/needademo\n\nÀ très vite,\nL’équipe PayLive.cc`;

    const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "logo_bis.png",
        content: fs.readFileSync(logoPath),
        cid: "paylive-logo",
        contentType: "image/png",
      });
    }
    if (hasAdImage) {
      attachments.push({
        filename: "ad_paylive.png",
        content: fs.readFileSync(adImagePath),
        cid: "paylive-ad",
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
    const logoPath = path.resolve(process.cwd(), "public", "logo_bis.png");
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
              ? `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer"><img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" /></a>`
              : `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div></a>`
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

    const text = `${greeting}\n\nPour aller plus loin, je vous propose une démo rapide (10 min) pour vous montrer PayLive en action — directement sur vos cas d’usage.\n\nDeux petites choses pour qu’on cale ça :\n• Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?\n• Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?\n\nHâte de vous faire découvrir la solution !\n\nÀ très vite,\nL’équipe PayLive.cc`;

    const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "logo_bis.png",
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
    const demoLink = "https://paylive.cc/demo-vendeur";
    const storeLink = `https://paylive.cc/s/${slugSafe}`;
    const checkoutLink = `https://paylive.cc/c/${slugSafe}`;
    const logoPath = path.resolve(process.cwd(), "public", "logo_bis.png");
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
              ? `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer"><img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" /></a>`
              : `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div></a>`
          }
          <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">Retrouvez ci-dessous le tutoriel et le lien vers votre boutique 👇</div>
        </div>

        <div style="padding:28px 28px 8px 28px;">
          <div style="font-size:18px;line-height:1.5;">
            <span style="font-weight:700;">${greeting}</span>
          </div>
          <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
            Comme convenu, voici le lien vers notre tutoriel
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

    const text = `${greeting}\n\nComme convenu, voici le lien vers notre tutoriel\n\n👉 Cliquez ici pour accéder au tutoriel : ${demoLink}\n\nJ'ai également créé votre boutique personnalisée avec l'ensemble de vos articles, vous pouvez y accéder ici :\n\n🛍️ Lien vers votre boutique : ${storeLink}\n\nEt voici le lien à partager directement à vos clientes lors de vos prochains lives afin qu'elles puissent constituer leurs paniers et procéder au paiement :\n\n📲 Lien à partager en live : ${checkoutLink}\n\nN’hésitez pas à me contacter si vous avez des questions !\n\nÀ très vite,\nL’équipe PayLive.cc`;

    const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
    const attachments: any[] = [];
    if (hasLogo) {
      attachments.push({
        filename: "logo_bis.png",
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
