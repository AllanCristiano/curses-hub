import { Transform } from 'class-transformer';

/** Remove espaços nas extremidades de strings. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Normaliza para minúsculas (e-mails, slugs). */
export const ToLowerCase = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
