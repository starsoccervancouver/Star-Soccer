// The existing shared plan remains the only store. Missing activities stays missing.
const legacyKeys = ['focus', 'warmup', 'technical', 'game', 'equipment', 'reflection'];
const blockKeys = ['title', 'duration', 'stage', 'instructions', 'equipment'];
const invalid = () => { const error = new Error('INVALID_PLAN'); error.code = 'INVALID_PLAN'; error.status = 400; throw error; };
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function validatePlanContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).some(key => ![...legacyKeys, 'activities'].includes(key))) invalid();
  for (const key of legacyKeys) if (Object.hasOwn(content, key) && !text(content[key], 2000)) invalid();
  if (Object.hasOwn(content, 'activities')) {
    if (!Array.isArray(content.activities) || content.activities.length > 16) invalid();
    for (const block of content.activities) {
      if (!block || typeof block !== 'object' || Array.isArray(block) || Object.keys(block).length !== blockKeys.length || Object.keys(block).some(key => !blockKeys.includes(key))) invalid();
      if (!text(block.title, 120) || !block.title.trim() || !Number.isInteger(block.duration) || block.duration < 1 || block.duration > 120 || !['warmup', 'technical', 'game', 'other'].includes(block.stage) || !text(block.instructions, 2000) || !text(block.equipment, 500)) invalid();
    }
  }
  return content;
}
