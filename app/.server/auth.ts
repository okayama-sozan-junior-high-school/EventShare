import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { getConfig } from "./config";
import { createDb, schema } from "./db";
import { canSignUp } from "./school";

function createAuth() {
  const config = getConfig();
  return betterAuth({
    appName: "Event Share",
    baseURL: config.baseUrl,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [config.baseUrl],
    database: drizzleAdapter(createDb(), { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Auth endpoints are rate limited with the Workers Rate Limiting binding
    // (see routes/api.auth.$.ts); the built-in limiter is in-memory per isolate.
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    user: {
      additionalFields: {
        grade: { type: "string", required: false, input: false },
        bio: { type: "string", required: false, input: false },
        profileVisibility: {
          type: "string",
          required: false,
          input: false,
          defaultValue: "members",
        },
        schoolVerifiedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => {
            if (
              !canSignUp(
                newUser.email,
                config.signupMode,
                config.schoolEmailDomains,
              )
            ) {
              throw new APIError("FORBIDDEN", {
                message: "学校のメールアドレスで登録してください。",
              });
            }
            return { data: newUser };
          },
        },
      },
    },
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  instance ??= createAuth();
  return instance;
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;
export type SessionUser = AuthSession["user"];
