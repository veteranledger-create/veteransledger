import { config } from "./app";

export const securityConfig = {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    // Explicit 2-year HSTS with preload readiness
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    // Restrict browser feature access
    permissionsPolicy: {
      policy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
        usb: [],
        fullscreen: ["self"],
        "display-capture": [],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Prevent clickjacking
    frameguard: { action: "deny" as const },
    // Force MIME type adherence — critical for SVG/script confusion
    noSniff: true,
    // XSS filter for older browsers
    xssFilter: true,
  },

  cors: {
    origin: config.cors.origin.split(",").map((o) => o.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  },

  session: {
    name: "vl_session",
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax" as const,
      maxAge: config.session.maxAge,
    },
  },

  rateLimit: {
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  },

  bcryptRounds: 12,
};
