// Where the app finds sites. The default reads config/sites.json once at start-up (staticSiteProvider);
// a hosted service passes its own provider (database, cache) to createApp({ siteProvider }).
//
// Contract (all methods may be async):
//   get(siteId)          -> site object (same shape as a config/sites.json entry) or null
//   allowsOrigin(origin) -> true when some site lists this Origin in allowedOrigins (CORS preflight,
//                           errors before the site is known)
//   list()               -> site ids (optional; dev routes use the first one as default)

/**
 * @typedef {object} SiteProvider
 * @property {(siteId: string) => Promise<object|null> | object | null} get
 * @property {(origin: string) => Promise<boolean> | boolean} [allowsOrigin]
 * @property {() => Promise<string[]> | string[]} [list]
 */

/** Provider over a fixed map of sites (the shape of config/sites.json). */
export function staticSiteProvider(sites) {
  const map = { ...(sites || {}) };
  return {
    get: (siteId) => (Object.hasOwn(map, siteId) ? map[siteId] : null),
    allowsOrigin: (origin) => Object.values(map).some((s) => (s.allowedOrigins || []).includes(origin)),
    list: () => Object.keys(map),
  };
}
