import express from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();

const awsRegion = process.env.AWS_REGION;
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const awsBucket = process.env.AWS_S3_BUCKET;
const cloudFrontUrl = (process.env.CLOUDFRONT_URL || "https://d1tmgyvizond6e.cloudfront.net").replace(/\/+$/, "");

if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey || !awsBucket) {
  console.error("AWS S3 environment variables are missing (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET)");
}

const s3Client = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId || "",
    secretAccessKey: awsSecretAccessKey || "",
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"));
  },
});

const getExtFromMime = (mime: string): string => {
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".jpg"; // default to .jpg
};

// POST /api/upload
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const slug = (req.body?.slug as string)?.trim();
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!slug) {
      return res.status(400).json({ error: "Slug requis" });
    }

    const ext = getExtFromMime(req.file.mimetype);
    const key = `images/${slug}${ext}`;

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

export default router;