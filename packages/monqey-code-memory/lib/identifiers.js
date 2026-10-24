export const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw Error('Invalid memory identifier.');
  return value;
};
export const sessionIdentifier = value => {
  try { uuid(typeof value === 'string' && value.startsWith('session-') ? value.slice(8) : value); }
  catch { throw Error('Invalid session identifier.'); }
  return value;
};
