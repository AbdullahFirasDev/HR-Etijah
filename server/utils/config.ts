import type { TrustProxyMode } from '../lib/ip'
import { resolveAppEnv, validateServerConfig, type AppEnv, type ConfigReport } from '../lib/config-validate'

export interface ServerConfig {
  appEnv: AppEnv
  /** Running on Vercel (system variable VERCEL=1, set at build and run time). */
  onVercel: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
  sessionSecret: string
  sessionAbsoluteSeconds: number
  sessionIdleSeconds: number
  cookieSecure: boolean
  webauthnRpId: string
  webauthnRpName: string
  webauthnOrigins: string[]
  webauthnChallengeTtlSeconds: number
  trustProxyMode: TrustProxyMode
  trustedProxyCidrs: string[]
  clientIpHeader: string
  devLoopbackClientIp: string
  rateLimitStore: 'memory' | 'database'
  cronSecret: string
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
}

let cached: { config: ServerConfig, report: ConfigReport } | null = null
let reported = false

const list = (v: unknown) => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean)
const bool = (v: unknown) => v === true || v === 'true' || v === '1'

function load(): { config: ServerConfig, report: ConfigReport } {
  const rc = useRuntimeConfig()
  const config: ServerConfig = {
    appEnv: resolveAppEnv(String(rc.appEnv ?? ''), import.meta.dev),
    onVercel: process.env.VERCEL === '1',
    supabaseUrl: String(rc.supabaseUrl || '').trim().replace(/\/$/, ''),
    supabaseAnonKey: String(rc.supabaseAnonKey || '').trim(),
    supabaseServiceRoleKey: String(rc.supabaseServiceRoleKey || '').trim(),
    sessionSecret: String(rc.sessionSecret || '').trim(),
    sessionAbsoluteSeconds: Number(rc.sessionAbsoluteSeconds),
    sessionIdleSeconds: Number(rc.sessionIdleSeconds),
    cookieSecure: bool(rc.cookieSecure),
    webauthnRpId: String(rc.webauthnRpId || '').trim(),
    webauthnRpName: String(rc.webauthnRpName || 'Etijah HR'),
    webauthnOrigins: list(rc.webauthnOrigins),
    webauthnChallengeTtlSeconds: Math.min(300, Math.max(30, Number(rc.webauthnChallengeTtlSeconds) || 90)),
    trustProxyMode: String(rc.trustProxyMode || 'none').trim() as TrustProxyMode,
    trustedProxyCidrs: list(rc.trustedProxyCidrs),
    clientIpHeader: String(rc.clientIpHeader || '').trim(),
    devLoopbackClientIp: String(rc.devLoopbackClientIp || '').trim(),
    rateLimitStore: String(rc.rateLimitStore || 'memory').trim() as ServerConfig['rateLimitStore'],
    // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so that name is accepted too.
    cronSecret: String(rc.cronSecret || process.env.CRON_SECRET || '').trim(),
    vapidPublicKey: String(rc.public?.vapidPublicKey || '').trim(),
    vapidPrivateKey: String(rc.vapidPrivateKey || '').trim(),
    vapidSubject: String(rc.vapidSubject || 'mailto:admin@example.com'),
  }
  return { config, report: validateServerConfig(config, config.appEnv) }
}

/** Validate once and print a readable report naming every problem (never the values). */
export function checkServerConfig(): ConfigReport {
  cached ??= load()
  const { report } = cached
  if (!reported) {
    reported = true
    for (const w of report.warnings) {
      console.warn(`[config] warning: ${w.setting} ${w.message}`)
    }
    if (report.errors.length) {
      console.error([
        report.env === 'production'
          ? `[config] Server configuration is invalid (production). The server refuses to start until fixed${cached.config.onVercel ? ' (Vercel shows 500 FUNCTION_INVOCATION_FAILED)' : ''}:`
          : `[config] Server configuration is invalid (${report.env}). API requests will fail with 500 server_misconfigured until fixed:`,
        ...report.errors.map(e => `  - ${e.setting} ${e.message}`),
        // On Vercel the local template's values (http origins, insecure cookies…) are exactly what fails.
        cached.config.onVercel
          ? '  On Vercel set these in Project → Settings → Environment Variables (Production) as listed in .env.vercel.example — not the local .env values.'
          : '  See .env.example for every setting.',
      ].join('\n'))
    }
  }
  return report
}

/** Validated server configuration; throws a 500 `server_misconfigured` if it is invalid. */
export function serverConfig(): ServerConfig {
  const report = checkServerConfig()
  if (report.errors.length) {
    // Setting names (never values) are returned only outside production, to speed up local setup.
    throw createError({
      statusCode: 500,
      statusMessage: 'server_misconfigured',
      data: { code: 'server_misconfigured', ...(report.env !== 'production' ? { settings: [...new Set(report.errors.map(e => e.setting))] } : {}) },
    })
  }
  return cached!.config
}
