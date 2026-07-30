import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { schema } from "@recepto/db";
import { validateCoreEnv } from "@recepto/shared/env";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/auth-schemas";

const env = validateCoreEnv(process.env);
const secureCookies = process.env.NODE_ENV === "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.SESSION_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60
  },
  cookies: {
    sessionToken: {
      name: secureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
        maxAge: 30 * 24 * 60 * 60
      }
    }
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(rawCredentials) {
        const parsed = loginSchema.safeParse(rawCredentials);

        if (!parsed.success) {
          return null;
        }

        const [user] = await db
          .select({
            id: schema.users.id,
            email: schema.users.email,
            name: schema.users.name,
            passwordHash: schema.users.passwordHash
          })
          .from(schema.users)
          .where(eq(schema.users.email, parsed.data.email))
          .limit(1);

        if (!user?.passwordHash) {
          return null;
        }

        const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash).catch(
          () => false
        );

        return validPassword
          ? { id: user.id, email: user.email, name: user.name }
          : null;
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true;
      }

      if (!user.email) {
        return false;
      }

      const email = user.email.toLowerCase();
      const [storedUser] = await db
        .insert(schema.users)
        .values({
          email,
          name: user.name?.trim() || email.split("@")[0] || "Recepto user",
          passwordHash: null
        })
        .onConflictDoUpdate({
          target: schema.users.email,
          set: {
            name: user.name?.trim() || email.split("@")[0] || "Recepto user",
            updatedAt: new Date()
          }
        })
        .returning({ id: schema.users.id });

      if (!storedUser) {
        return false;
      }

      user.id = storedUser.id;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      } else if (!token.userId && token.email) {
        const [storedUser] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, token.email))
          .limit(1);
        token.userId = storedUser?.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }

      return session;
    }
  }
});
