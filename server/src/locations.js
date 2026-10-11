// DEMO DATA: small sample of the hierarchy. Replace with an authorised dataset (e.g. LGD / Census codes) loaded into MongoDB.
export const TREE = { Asia: { India: { Rajasthan: { Jaipur: ['Tonk Road', 'Malviya Nagar', 'Mansarovar'], Kota: ['Talwandi', 'Vigyan Nagar', 'Mahaveer Nagar'] }, Delhi: { 'New Delhi': ['Connaught Place', 'Dwarka'] } } } };
export const INDIA_STATE_CAPITALS = {
  'Andhra Pradesh': 'Amaravati',
  'Arunachal Pradesh': 'Itanagar',
  Assam: 'Dispur',
  Bihar: 'Patna',
  Chhattisgarh: 'Raipur',
  Goa: 'Panaji',
  Gujarat: 'Gandhinagar',
  Haryana: 'Chandigarh',
  'Himachal Pradesh': 'Shimla',
  Jharkhand: 'Ranchi',
  Karnataka: 'Bengaluru',
  Kerala: 'Thiruvananthapuram',
  'Madhya Pradesh': 'Bhopal',
  Maharashtra: 'Mumbai',
  Manipur: 'Imphal',
  Meghalaya: 'Shillong',
  Mizoram: 'Aizawl',
  Nagaland: 'Kohima',
  Odisha: 'Bhubaneswar',
  Punjab: 'Chandigarh',
  Rajasthan: 'Jaipur',
  Sikkim: 'Gangtok',
  'Tamil Nadu': 'Chennai',
  Telangana: 'Hyderabad',
  Tripura: 'Agartala',
  'Uttar Pradesh': 'Lucknow',
  Uttarakhand: 'Dehradun',
  'West Bengal': 'Kolkata',
};
export const INDIA_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
export const children = (path = []) => { let n = TREE; for (const p of path) n = Array.isArray(n) ? null : n?.[p]; return Array.isArray(n) ? n : n ? Object.keys(n) : []; };
