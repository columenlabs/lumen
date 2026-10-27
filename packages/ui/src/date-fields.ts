// A trend's date candidates, in a file of its own so a widget that draws a trend reads it without
// the Edit widget's settings (and the drag library they load).
import type { ViewDomain } from './view-model';

const DATE_LIKE = /(^|_)(date|day|at|time|month|week|year)($|_)/i;
/** A trend's date candidates: text fields, the date-like ones first. */
export const dateFields = <T>(domain: ViewDomain<T>) => {
  // A rendered text field still reads its raw value (a report date drawn as Tue, Oct 20).
  const texts = domain.fields.filter((f) => f.format === 'text');
  return [
    ...texts.filter((f) => DATE_LIKE.test(f.key)),
    ...texts.filter((f) => !DATE_LIKE.test(f.key)),
  ];
};
