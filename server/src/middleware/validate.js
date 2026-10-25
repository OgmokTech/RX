import { HttpError } from '../utils/httpError.js';

/**
 * validate({ body, query, params }) with zod schemas.
 * Parsed (typed, coerced, stripped of unknown keys) values land on req.valid.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      return next(new HttpError(422, 'Check the highlighted fields', result.error.flatten().fieldErrors));
    }
    req.valid[part] = result.data;
  }
  next();
};
