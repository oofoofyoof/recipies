const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const multer = require("multer");

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const dataDirectory = path.join(root, "data");
const uploadDirectory = path.join(root, "uploads");
const itemsFile = path.join(dataDirectory, "items.json");
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminPasswordDigest = crypto.createHash("sha256").update(adminPassword).digest();
const adminLoginConfigured = adminPassword.length >= 12;
const sessionDurationMs = 12 * 60 * 60 * 1000;
const sessions = new Map();
const failedLogins = new Map();
const allowedRarities = new Set(["mythical", "legendary"]);
const imageTypes = {
  "image/jpeg": { extension: "jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: "png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/gif": { extension: "gif", signature: (buffer) => buffer.subarray(0, 3).toString() === "GIF" },
  "image/webp": { extension: "webp", signature: (buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!Object.hasOwn(imageTypes, file.mimetype)) {
      const error = new Error("Images must be PNG, JPEG, GIF, or WebP.");
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

app.use(express.json({ limit: "5kb" }));
app.use(express.static(path.join(root, "public")));
app.use("/uploads", express.static(uploadDirectory, { fallthrough: false, index: false }));

let items = [];
let saveQueue = Promise.resolve();

function saveItem(item) {
  const save = saveQueue.then(async () => {
    const updatedItems = [item, ...items];
    const temporaryFile = `${itemsFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(updatedItems, null, 2));
    await fs.rename(temporaryFile, itemsFile);
    items = updatedItems;
  });
  saveQueue = save.catch(() => {});
  return save;
}

function sessionToken(request) {
  const cookies = request.headers.cookie?.split(";") || [];
  const cookie = cookies.map((value) => value.trim()).find((value) => value.startsWith("cosmix_admin="));
  return cookie ? cookie.slice("cosmix_admin=".length) : null;
}

function isAdmin(request) {
  const token = sessionToken(request);
  const expiresAt = token && sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(request, response, next) {
  if (!isAdmin(request)) {
    return response.status(401).json({ error: "Admin sign-in is required to add items." });
  }
  next();
}

app.get("/api/auth", (request, response) => {
  response.set("Cache-Control", "no-store");
  response.json({ isAdmin: isAdmin(request), configured: adminLoginConfigured });
});

app.post("/api/auth/login", (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!adminLoginConfigured) {
    return response.status(503).json({ error: "Admin login is not configured. Set ADMIN_PASSWORD to a password at least 12 characters long." });
  }

  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  let attempt = failedLogins.get(address);
  if (attempt?.lockedUntil > now) {
    return response.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  if (attempt && ((attempt.lockedUntil && attempt.lockedUntil <= now) || now - attempt.windowStarted >= 15 * 60 * 1000)) {
    failedLogins.delete(address);
    attempt = undefined;
  }

  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const passwordDigest = crypto.createHash("sha256").update(password).digest();
  if (!crypto.timingSafeEqual(passwordDigest, adminPasswordDigest)) {
    const failures = (attempt?.failures || 0) + 1;
    failedLogins.set(address, {
      failures,
      windowStarted: attempt?.windowStarted || now,
      lockedUntil: failures >= 5 ? now + 15 * 60 * 1000 : 0,
    });
    const status = failures >= 5 ? 429 : 401;
    const message = status === 429
      ? "Too many sign-in attempts. Try again in 15 minutes."
      : "That admin password is not correct.";
    return response.status(status).json({ error: message });
  }

  failedLogins.delete(address);
  for (const [existingToken, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(existingToken);
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, now + sessionDurationMs);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.set(
    "Set-Cookie",
    `cosmix_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secure}`,
  );
  response.json({ isAdmin: true });
});

app.post("/api/auth/logout", (request, response) => {
  const token = sessionToken(request);
  if (token) sessions.delete(token);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.set("Set-Cookie", `cosmix_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  response.status(204).end();
});

app.get("/api/items", (_request, response) => {
  response.json(items);
});

app.post("/api/items", requireAdmin, upload.single("image"), async (request, response, next) => {
  try {
    const body = request.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rarity = body.rarity;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const guide = typeof body.guide === "string" ? body.guide.trim() : "";

    if (!name || name.length > 100) {
      return response.status(400).json({ error: "Add an item name up to 100 characters long." });
    }
    if (!allowedRarities.has(rarity)) {
      return response.status(400).json({ error: "Choose Mythical or Legendary rarity." });
    }
    if (!description || description.length > 2000) {
      return response.status(400).json({ error: "Add a description up to 2,000 characters long." });
    }
    if (guide.length > 3000) {
      return response.status(400).json({ error: "Keep the recipe or guide under 3,000 characters." });
    }

    let imageUrl = null;
    if (request.file) {
      const imageType = imageTypes[request.file.mimetype];
      if (!imageType.signature(request.file.buffer)) {
        return response.status(400).json({ error: "That image file is not valid. Try a PNG, JPEG, GIF, or WebP." });
      }

      const filename = `${crypto.randomUUID()}.${imageType.extension}`;
      await fs.writeFile(path.join(uploadDirectory, filename), request.file.buffer, { flag: "wx" });
      imageUrl = `/uploads/${filename}`;
    }

    const item = {
      id: crypto.randomUUID(),
      name,
      rarity,
      description,
      guide,
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    try {
      await saveItem(item);
    } catch (error) {
      if (imageUrl) {
        try {
          await fs.unlink(path.join(uploadDirectory, path.basename(imageUrl)));
        } catch (cleanupError) {
          console.error("Could not remove the image for a failed recipe save:", cleanupError);
        }
      }
      throw error;
    }

    response.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Images must be 5 MB or smaller."
      : "Upload one image at a time.";
    return response.status(400).json({ error: message });
  }
  if (error.status === 400) {
    return response.status(400).json({ error: error.message });
  }
  if (error.status === 404) {
    return response.status(404).json({ error: "Not found." });
  }
  console.error(error);
  response.status(500).json({ error: "Something went wrong while saving the item." });
});

async function start() {
  await Promise.all([
    fs.mkdir(dataDirectory, { recursive: true }),
    fs.mkdir(uploadDirectory, { recursive: true }),
  ]);
  try {
    items = JSON.parse(await fs.readFile(itemsFile, "utf8"));
    if (!Array.isArray(items)) {
      throw new Error("Item data must be a JSON array.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await fs.writeFile(itemsFile, "[]\n");
  }

  app.listen(port, () => {
    console.log(`CosmixMC Recipes is running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Could not start the recipe site:", error);
  process.exitCode = 1;
});
