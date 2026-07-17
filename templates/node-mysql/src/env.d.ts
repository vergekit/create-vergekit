/// <reference types="astro/client" />
/// <reference types="node" />

declare namespace NodeJS {
  interface ProcessEnv {
    MYSQL_HOST?: string;
    MYSQL_PORT?: string;
    MYSQL_USER?: string;
    MYSQL_PASSWORD?: string;
    MYSQL_DATABASE?: string;
    EMAIL_PROVIDER?: string;
    EMAIL_FROM?: string;
    EMAIL_REPLY_TO?: string;
    RESEND_API_KEY?: string;
    MAILGUN_API_KEY?: string;
    MAILGUN_DOMAIN?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
  }
}

declare namespace App {
  interface Locals {
    user: import('@vergekit/core/auth').AppAuthUser | null;
    session: import('@vergekit/core/auth').AppAuthSession | null;
    isAuthenticated: boolean;
  }
}
