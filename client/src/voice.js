// Voice commands and spoken search terms in English and Hindi.
const RULES = [
  [/emergency|help|\u0906\u092a\u093e\u0924|\u092e\u0926\u0926|\u0907\u092e\u0930\u091c\u0947\u0902\u0938\u0940/i, '/emergency'],
  [/ambulance|\u090f\u092e\u094d\u092c\u0941\u0932\u0947\u0902\u0938/i, '/ambulance'],
  [/blood|\u0916\u0942\u0928|\u0930\u0915\u094d\u0924/i, '/blood'],
  [/bed|\u092c\u093f\u0938\u094d\u0924\u0930/i, '/hospitals?beds=true'],
  [/hospital|\u0905\u0938\u094d\u092a\u0924\u093e\u0932/i, '/hospitals'],
  [/doctor|\u0921\u0949\u0915\u094d\u091f\u0930/i, '/doctors'],
  [/complaint|report|\u0936\u093f\u0915\u093e\u092f\u0924/i, '/complaints'],
];
const COMMAND_WORDS = /\b(find|search|show|look for|near me|nearby|near|around|in|at|the|hospital|hospitals|clinic|doctor|doctors|please|i need|i want)\b|\u0922\u0942\u0902\u0922\u094b|\u0916\u094b\u091c\u094b|\u092c\u0924\u093e\u0913|\u0928\u091c\u0926\u0940\u0915|\u092e\u0947\u0902|\u0915\u0947 \u092a\u093e\u0938|\u092e\u0941\u091d\u0947|\u091a\u093e\u0939\u093f\u090f/gi;
export const voiceRoute = (text = '') => RULES.find(([re]) => re.test(text))?.[1] ?? null;
export const voiceQuery = (text = '') => text.replace(COMMAND_WORDS, ' ').replace(/[.,!?\u0964]/g, ' ').replace(/\s+/g, ' ').trim();
