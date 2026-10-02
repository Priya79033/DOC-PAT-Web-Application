// Maps a spoken phrase (English or Hindi) to an app route. Returns null when nothing matches.
const RULES = [[/emergency|आपात|इमरजेंसी|मदद|help/i, '/emergency'], [/ambulance|एम्बुलेंस|एंबुलेंस/i, '/ambulance'], [/blood|खून|रक्त/i, '/blood'], [/bed|बिस्तर/i, '/hospitals?beds=true'], [/hospital|अस्पताल/i, '/hospitals'], [/doctor|डॉक्टर/i, '/doctors'], [/complaint|report|शिकायत/i, '/complaints']];
export const voiceRoute = (text = '') => RULES.find(([re]) => re.test(text))?.[1] ?? null;
