// DEMO DATA: small sample of the hierarchy. Replace with an authorised dataset (e.g. LGD / Census codes) loaded into MongoDB.
export const TREE = { Asia: { India: { Rajasthan: { Jaipur: ['Tonk Road', 'Malviya Nagar', 'Mansarovar'], Kota: ['Talwandi', 'Vigyan Nagar', 'Mahaveer Nagar'] }, Delhi: { 'New Delhi': ['Connaught Place', 'Dwarka'] } } } };
export const children = (path = []) => { let n = TREE; for (const p of path) n = Array.isArray(n) ? null : n?.[p]; return Array.isArray(n) ? n : n ? Object.keys(n) : []; };
