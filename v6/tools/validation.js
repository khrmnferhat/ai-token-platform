'use strict';

function typeOf(value) { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; return typeof value; }
function matchesType(value, expected) { return expected === 'integer' ? Number.isInteger(value) : expected === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeOf(value) === expected; }
function validateValue(value, schema = {}, path = 'input') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.type && !matchesType(value, schema.type)) return [`${path} must be ${schema.type}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path} is not allowed`];
  if (typeOf(value) === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return [`${path} is too short`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return [`${path} is too long`];
    if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(value)) return [`${path} has invalid format`]; } catch { return [`${path} schema is invalid`]; } }
  }
  if (typeOf(value) === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return [`${path} is too small`];
    if (schema.maximum !== undefined && value > schema.maximum) return [`${path} is too large`];
  }
  if (typeOf(value) === 'array' && Array.isArray(schema.items)) { const errors = []; value.forEach((item, index) => errors.push(...validateValue(item, schema.items, `${path}[${index}]`))); return errors; }
  if (typeOf(value) === 'object') {
    const properties = schema.properties || {};
    const errors = [];
    for (const required of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${path}.${required} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(value)) if (properties[key]) errors.push(...validateValue(child, properties[key], `${path}.${key}`));
    return errors;
  }
  return [];
}
function validateInput(input, schema) {
  if (typeOf(input) !== 'object') return { ok: false, errors: ['input must be an object'] };
  const errors = validateValue(input, schema || { type: 'object' });
  return { ok: errors.length === 0, errors };
}
module.exports = { validateInput, validateValue };
