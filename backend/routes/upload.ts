import express from "express";
import multer from "multer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

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
    "AWS S3 environment variables are missing (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET)"
  );
}

const s3Client = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId || "",
    secretAccessKey: awsSecretAccessKey || "",
  },
});

// Supabase client (pour mise à jour du champ rib)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
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

const uploadDocs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB pour RIB
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Type de fichier non autorisé (PDF, JPG/JPEG, PNG)"));
  },
});

const getExtFromMime = (mime: string) => {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  return "";
};

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

    // Renomme le logo sans extension: images/<slug>
    const key = `images/${slug}`;

    const params = {
      Bucket: awsBucket!,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

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

// POST /api/upload/rib (documents)
router.post("/rib", uploadDocs.single("document"), async (req, res) => {
  try {
    const slug = (req.body?.slug as string)?.trim();
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!slug) {
      return res.status(400).json({ error: "Slug requis" });
    }

    const ext = getExtFromMime(req.file.mimetype);
    const baseName = `${slug}-rib`;
    const key = `documents/${baseName}`;

    const params = {
      Bucket: awsBucket!,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    const url = `${cloudFrontUrl}/${key}`;

    // Mettre à jour la colonne rib dans la table stores avec objet JSON {type:"link", url}
    const ribValue = { type: "link", url, iban: "", bic: "" };
    const { error: supError } = await supabase
      .from("stores")
      .update({ rib: ribValue })
      .eq("slug", slug);

    if (supError) {
      console.error("Erreur Supabase (update rib):", supError);
      return res
        .status(500)
        .json({ error: "RIB uploadé mais mise à jour DB échouée" });
    }

    return res.json({
      success: true,
      message: "RIB uploaded successfully",
      url,
      fileName: key,
    });
  } catch (error) {
    console.error("Upload RIB error:", error);
    return res.status(500).json({ error: "Upload RIB failed" });
  }
});

export default router;
