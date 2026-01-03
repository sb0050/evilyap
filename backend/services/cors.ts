import { Request, Response } from "express";

export function applyCors(req: Request, res: Response) {
  const origin = req.headers.origin;

  if (
    typeof origin === "string" &&
    (origin.endsWith(".vercel.app") ||
      origin === "https://paylive.cc" ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Clerk-Frontend-Api, Clerk-Publishable-Key"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
}
