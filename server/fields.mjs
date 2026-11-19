// Canonical content fields used by the agent, the outbox and the compose API, and their mapping onto
// a particular CMS. The agent only ever sees canonical names; a site whose database uses other column
// names declares `fieldMap` in config/sites.json, e.g. { "name": "title_vi", "body": "content" }.
//
//   name              page name / H1
//   excerpt           short description (HTML or text)
//   body              main content (HTML). For products: price table / key info
//   body_extra        products: long article shown below the main content
//   faq               [{question, answer}]
//   meta_title        SEO title
//   meta_description  SEO description
//   meta_keywords     focus keyword first, then secondary keywords (comma separated)
//   slug              create only
//   category_id       create only (post category)
//   featured_image    create only (file name or URL of an uploaded image)

export const FIELDS = ['name', 'excerpt', 'body', 'body_extra', 'faq', 'meta_title', 'meta_description', 'meta_keywords',
  'slug', 'category_id', 'featured_image'];

/** Fields the agent may change, per page type. */
export const EDITABLE = {
  post: ['name', 'excerpt', 'body', 'meta_title', 'meta_description', 'meta_keywords'],
  product: ['excerpt', 'body', 'body_extra', 'faq', 'meta_title', 'meta_description', 'meta_keywords'],
  category: ['excerpt', 'body', 'faq', 'meta_title', 'meta_description', 'meta_keywords'],
};
export const CREATE_ONLY = ['slug', 'category_id', 'featured_image'];
export const HTML_FIELDS = ['excerpt', 'body', 'body_extra'];

const mapOf = (site) => (site?.fieldMap && typeof site.fieldMap === 'object' ? site.fieldMap : {});

/** Rename keys of an object from canonical names to the site's CMS names (unknown keys pass through). */
export function toCms(site, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const m = mapOf(site);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [m[k] || k, v]));
}

/** Rename keys from the site's CMS names back to canonical names (canonical keys pass through). */
export function fromCms(site, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const rev = Object.fromEntries(Object.entries(mapOf(site)).map(([k, v]) => [v, k]));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [rev[k] || k, v]));
}

/** One field name, canonical -> CMS. */
export const cmsName = (site, field) => mapOf(site)[field] || field;
/** One field name, CMS -> canonical. */
export const canonicalName = (site, field) => Object.keys(fromCms(site, { [field]: 1 }))[0];
