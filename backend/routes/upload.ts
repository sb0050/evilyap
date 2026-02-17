import express from "express";
import multer from "multer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { clerkClient, getAuth } from "@clerk/express";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

const router = express.Router();

// AWS S3 config
const awsRegion = process.env.AWS_REGION;
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const awsBucket = process.env.AWS_S3_BUCKET;

const normalizeCdnBase = (base?: string | null) => {
  if (!base) return "";
  return base.replace(/\/$/, "");
};
const cloudFrontUrl = normalizeCdnBase(process.env.CLOUDFRONT_URL);

if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey || !awsBucket) {
  console.error(
    "AWS S3 environment variables are missing (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET)",
  );
}

const s3Client = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId || "",
    secretAccessKey: awsSecretAccessKey || "",
  },
});

const cloudFrontClient = new CloudFrontClient({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId || "",
    secretAccessKey: awsSecretAccessKey || "",
  },
});

// Fonction pour invalider le cache CloudFront
async function invalidateCloudFrontCache(filePaths: any) {
  try {
    const params = {
      DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID, // Votre ID de distribution
      InvalidationBatch: {
        Paths: {
          Quantity: filePaths.length,
          Items: filePaths,
        },
        CallerReference: `invalidation-${Date.now()}`,
      },
    };

    const command = new CreateInvalidationCommand(params);
    const result = await cloudFrontClient.send(command);

    console.log("Invalidation créée:", result?.Invalidation?.Id);
    return result;
  } catch (error) {
    console.error("Erreur lors de l'invalidation:", error);
    throw error;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
}
const supabase = createClient(supabaseUrl!, supabaseKey!);

const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"));
  },
});

const uploadStockProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("Type de fichier non supporté"));
  },
});

// POST /api/upload (images)
router.post("/", uploadImages.single("image"), async (req, res) => {
  try {
    const slug = (req.body?.slug as string)?.trim();
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!slug) {
      return res.status(400).json({ error: "Slug requis" });
    }
    // Récupérer l'id du store à partir du slug
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store by slug):", storeErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!store) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    // Renommer le logo sans extension avec id immuable: images/<storeId>
    const key = `images/${(store as any).id}`;

    const params = {
      Bucket: awsBucket!,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      CacheControl: "no-cache, no-store, must-revalidate",
      Metadata: {
        "upload-date": new Date().toISOString(),
      },
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // Invalider automatiquement le cache CloudFront
    try {
      await invalidateCloudFrontCache([`/${key}`]);
      console.log(`Cache invalidé pour: /${key}`);
    } catch (invalidationError) {
      console.error("Erreur invalidation:", invalidationError);
      // Continuer même si l'invalidation échoue
    }

    const url = `${cloudFrontUrl}/${key}`;

    return res.json({
      success: true,
      message: "File uploaded successfully",
      url,
      fileName: key,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.post(
  "/stock-product",
  uploadStockProductImage.single("image"),
  async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth?.isAuthenticated || !auth.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const slug = String(req.body?.slug || "").trim();
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      if (!slug) {
        return res.status(400).json({ error: "Slug requis" });
      }

      const { data: store, error: storeErr } = await supabase
        .from("stores")
        .select("id, slug, clerk_id, owner_email")
        .eq("slug", slug)
        .maybeSingle();
      if (storeErr && (storeErr as any)?.code !== "PGRST116") {
        return res
          .status(500)
          .json({ error: "Erreur lors de la récupération de la boutique" });
      }
      if (!store) {
        return res.status(404).json({ error: "Boutique non trouvée" });
      }

      const user = await clerkClient.users.getUser(auth.userId);
      let authorized = Boolean(
        (store as any)?.clerk_id && (store as any).clerk_id === auth.userId,
      );
      if (!authorized) {
        try {
          const emails = (user.emailAddresses || [])
            .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
            .filter(Boolean);
          const ownerEmail = String((store as any)?.owner_email || "")
            .toLowerCase()
            .trim();
          if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
        } catch {}
      }
      if (!authorized) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const storeId = Number((store as any)?.id);
      if (!Number.isFinite(storeId) || storeId <= 0) {
        return res.status(500).json({ error: "store_id invalide" });
      }

      const ext =
        req.file.mimetype === "image/png"
          ? "png"
          : req.file.mimetype === "image/webp"
            ? "webp"
            : "jpg";
      const rawName = String(req.file.originalname || "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 60);
      const base = rawName ? rawName.replace(/\.[a-z0-9]+$/i, "") : "image";
      const key = `stock/${storeId}/${Date.now()}-${base}.${ext}`;

      const params = {
        Bucket: awsBucket!,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          "upload-date": new Date().toISOString(),
          store_id: String(storeId),
        },
      };

      const command = new PutObjectCommand(params);
      await s3Client.send(command);

      try {
        await invalidateCloudFrontCache([`/${key}`]);
      } catch {}

      const url = `${cloudFrontUrl}/${key}`;
      return res.json({ success: true, url, fileName: key });
    } catch (error: any) {
      const msg = error?.message || "Upload failed";
      return res.status(500).json({ error: msg });
    }
  },
);

export default router;
